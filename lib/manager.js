/**
 * Manager facade: the single implementation shared by the HTTP routes (for the
 * browser panel) and the agent tools. Keeps server records, processes, plugin
 * files, world backups and configuration edits consistent.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  checkMemory,
  checkServerName,
  checkVersion,
  ServerStore,
} from './store.js'
import { checkJava, readEula, RuntimePool } from './runtime.js'
import {
  INSTALLABLE_MAJORS,
  installJava,
  invalidateJavaCache,
  listRuntimes,
  pickRuntime,
  probeJava,
  readSettings,
  requiredJavaFor,
  writeSettings,
} from './java.js'
import { paperVersions, resolvePaperDownload } from './paper.js'
import { DEFAULT_PLUGINS, newestCompatibleGameVersions, resolveModrinthJar } from './modrinth.js'
import { hasPlugin, installPluginJar, listPlugins, removePlugin, setPluginEnabled } from './plugins.js'
import {
  GAMERULE_BY_KEY,
  GAMERULE_CATALOG,
  gameruleValue,
  parseGameruleReply,
  readProperties,
  updateProperties,
  writeDefaultProperties,
} from './properties.js'
import { createBackup, deleteBackup, listBackups, listWorlds, restoreBackup } from './backup.js'
import { readLevelDat } from './nbt.js'
import { downloadToFile, ensure, ensureDir, ManagerError, sizeOf, writeTextAtomic } from './util.js'

export class Manager {
  constructor({ root, config, logger }) {
    this.root = root
    this.config = config
    this.logger = logger
    this.store = new ServerStore(root, (level, message) => logger?.(level, message))
    this.settings = { defaultJavaPath: null }
    this.runtime = new RuntimePool({
      javaCommand: config.javaCommand,
      extraArgs: config.javaArgs,
      log: (level, message) => logger?.(level, message),
    })
  }

  async init() {
    await ensureDir(this.root)
    this.settings = await readSettings(this.root)
    const servers = await this.store.init()
    this.logger?.('info', `minecraft: 数据目录 ${this.root}，已加载 ${servers.length} 台服务器`)
  }

  async dispose() {
    await this.runtime.disposeAll()
  }

  // ── meta / versions ────────────────────────────────────────────────────

  async meta() {
    const java = await checkJava(this.config.javaCommand)
    let javaRuntimes = []
    try {
      javaRuntimes = await listRuntimes({ root: this.root, configCommand: this.config.javaCommand })
    } catch {
      /* discovery is best effort */
    }
    return {
      root: this.root,
      java,
      javaRuntimes,
      defaultJavaPath: this.settings.defaultJavaPath,
      javaInstallable: INSTALLABLE_MAJORS,
      platform: { os: process.platform, arch: process.arch },
      defaults: DEFAULT_PLUGINS,
      defaultMemoryMb: this.config.defaultMemoryMb,
      javaArgs: this.config.javaArgs,
      gamerules: GAMERULE_CATALOG,
    }
  }

  /** Paper versions plus a recommended default both default plugins support. */
  async versions() {
    try {
      const { versions, latest } = await paperVersions()
      let recommended = latest
      try {
        const supported = await newestCompatibleGameVersions()
        recommended = versions.find((version) => supported.has(version)) ?? latest
      } catch {
        /* Modrinth unavailable: still offer Paper versions */
      }
      return { versions: versions.slice(0, 120), latest, recommended, offline: false }
    } catch (error) {
      this.logger?.('warn', `minecraft: 读取 Paper 版本失败：${String(error)}`)
      return {
        versions: this.config.fallbackVersions,
        latest: this.config.fallbackVersions[0] ?? '26.1.2',
        recommended: this.config.fallbackVersions[0] ?? '26.1.2',
        offline: true,
        error: errorMessage(error),
      }
    }
  }

  // ── servers ────────────────────────────────────────────────────────────

  listServers() {
    return this.store.list().map((record) => this.describe(record))
  }

  describe(record) {
    return {
      ...record,
      status: this.runtime.status(record.id),
      eulaAccepted: record.acceptEula === true,
      requiredJava: requiredJavaFor(record.mcVersion),
    }
  }

  async server(id) {
    const record = this.store.get(id)
    const { properties } = await readProperties(record.dir)
    return {
      ...this.describe(record),
      properties,
      plugins: await listPlugins(join(record.dir, 'plugins')),
      worlds: await listWorlds(record.dir),
      backups: await listBackups(record.dir),
      eulaAccepted: (await readEula(record.dir)) || record.acceptEula === true,
    }
  }

  async createServer({ name, version, memoryMb, acceptEula, installDefaults = true, motd, javaPath }) {
    const cleanName = checkServerName(name)
    const memory = checkMemory(memoryMb ?? this.config.defaultMemoryMb)
    const chosenVersion = version === undefined || version === '' ? (await this.versions()).recommended : checkVersion(version)
    let pinnedJava = null
    if (typeof javaPath === 'string' && javaPath.trim() !== '') {
      const probe = await probeJava(javaPath.trim())
      ensure(probe.ok, 'JAVA_MISSING', `指定的 Java 不可用：${probe.error ?? javaPath}`)
      pinnedJava = { path: probe.path, major: probe.major, version: probe.version }
    }

    // Resolve the download before creating any files so a metadata-only server
    // never appears when PaperMC is unreachable.
    const paper = await resolvePaperDownload(chosenVersion)
    const record = await this.store.create({
      name: cleanName,
      mcVersion: chosenVersion,
      memoryMb: memory,
      acceptEula: acceptEula === true,
      ...(pinnedJava === null ? {} : { javaPath: pinnedJava.path, javaMajor: pinnedJava.major, javaVersion: pinnedJava.version }),
    })
    try {
      const target = join(record.dir, 'paper.jar')
      await downloadToFile(paper.url, target, { sha256: paper.sha256 })
      await writeDefaultProperties(record.dir, { motd: motd ?? `${cleanName} · managed by DSH` })
      if (acceptEula === true) await this.setEula(record.id, true)
    } catch (error) {
      await this.store.remove(record.id).catch(() => {})
      throw error
    }
    const warnings = []
    if (installDefaults !== false) {
      const result = await this.installDefaults(record)
      warnings.push(...result.warnings)
    }
    return {
      server: this.describe(this.store.get(record.id)),
      paper: { version: chosenVersion, build: paper.build, channel: paper.channel },
      warnings,
    }
  }

  async deleteServer(id, { confirmName } = {}) {
    const record = this.store.get(id)
    ensure(this.runtime.status(id).running === false, 'SERVER_RUNNING', '请先停止服务器，再删除它')
    if (confirmName !== undefined) {
      ensure(String(confirmName) === record.name, 'CONFIRM_MISMATCH', '确认名称与服务器名称不一致')
    }
    await this.store.remove(id)
    return { id, name: record.name }
  }

  async renameServer(id, name) {
    const record = await this.store.rename(id, name)
    return this.describe(record)
  }

  async setEula(id, accept) {
    const record = this.store.get(id)
    const text = accept === true ? 'eula=true\n' : 'eula=false\n'
    await writeTextAtomic(join(record.dir, 'eula.txt'), text)
    await this.store.update(id, { acceptEula: accept === true })
    return { id, eulaAccepted: accept === true }
  }

  // ── Java environment ───────────────────────────────────────────────────

  /** Every detectable Java runtime plus the default-Java preference. */
  async javaInfo() {
    const runtimes = await listRuntimes({ root: this.root, configCommand: this.config.javaCommand })
    return {
      runtimes,
      defaultPath: this.settings.defaultJavaPath,
      installable: INSTALLABLE_MAJORS,
      platform: { os: process.platform, arch: process.arch },
    }
  }

  /** Download and install a Temurin JDK under <root>/java. */
  async installJavaVersion(version) {
    const installed = await installJava({
      root: this.root,
      version,
      onProgress: (message) => this.logger?.('info', `minecraft: ${message}`),
    })
    if (this.settings.defaultJavaPath === null) {
      this.settings.defaultJavaPath = installed.path
      await writeSettings(this.root, this.settings)
    }
    return { installed, defaultPath: this.settings.defaultJavaPath }
  }

  /** Set the profile-wide default Java used by servers without an explicit pick. */
  async selectDefaultJava(path) {
    const text = String(path ?? '').trim()
    ensure(text !== '', 'INVALID_INPUT', '缺少 Java 路径')
    const probe = await probeJava(text)
    ensure(probe.ok, 'JAVA_MISSING', `这个 Java 不可用：${probe.error ?? text}`)
    ensure(Number.isFinite(probe.major) && probe.major > 0, 'JAVA_MISSING', '无法识别 Java 版本')
    this.settings.defaultJavaPath = probe.path
    await writeSettings(this.root, this.settings)
    invalidateJavaCache()
    return { defaultJavaPath: probe.path, version: probe.version, major: probe.major, vendor: probe.vendor }
  }

  /** Pin (or clear, with path=null) the Java runtime one server uses. */
  async setServerJava(id, path) {
    const record = this.store.get(id)
    if (path === null || path === undefined || path === '' || path === 'auto') {
      const updated = await this.store.update(id, { javaPath: null, javaMajor: null, javaVersion: null })
      return { server: this.describe(updated), auto: true }
    }
    const probe = await probeJava(String(path).trim())
    ensure(probe.ok, 'JAVA_MISSING', `这个 Java 不可用：${probe.error ?? path}`)
    const updated = await this.store.update(id, { javaPath: probe.path, javaMajor: probe.major, javaVersion: probe.version })
    return { server: this.describe(updated), runtime: { path: probe.path, version: probe.version, major: probe.major, vendor: probe.vendor } }
  }

  /** Quick Java facts for a server without probing anything. */
  javaSummary(id) {
    const record = this.store.get(id)
    return {
      javaPath: record.javaPath,
      javaMajor: record.javaMajor,
      javaVersion: record.javaVersion,
      required: requiredJavaFor(record.mcVersion).major,
    }
  }

  /**
   * Choose the runtime used to start a server: explicit per-server pick, then
   * the default preference, then any detected runtime that satisfies Paper's
   * minimum for this Minecraft version.
   */
  async resolveJava(record) {
    const required = requiredJavaFor(record.mcVersion)
    if (record.javaPath !== null && record.javaPath !== undefined) {
      const probe = await probeJava(record.javaPath)
      if (!probe.ok) throw new ManagerError('JAVA_MISSING', `服务器选定的 Java 不可用（${record.javaPath}）：${probe.error ?? '无法运行'}`)
      ensure(
        Number(probe.major) >= required.major,
        'JAVA_VERSION',
        `该服务器（Paper ${record.mcVersion}）需要 ${required.label}+，但选定的 Java 是 ${probe.major}。请在「Java 环境」页安装或选择合适版本。`,
      )
      return { runtime: probe, source: 'server', required }
    }
    if (this.settings.defaultJavaPath !== null) {
      const probe = await probeJava(this.settings.defaultJavaPath)
      if (probe.ok && Number(probe.major) >= required.major) return { runtime: probe, source: 'default', required }
    }
    const runtimes = await listRuntimes({ root: this.root, configCommand: this.config.javaCommand })
    const picked = pickRuntime(runtimes, required.major)
    if (picked !== null) return { runtime: picked, source: 'auto', required }
    const configProbe = await probeJava(this.config.javaCommand)
    if (configProbe.ok && Number(configProbe.major) >= required.major) return { runtime: configProbe, source: 'config', required }
    const detected = runtimes.length === 0 ? '未检测到任何 Java' : runtimes.map((runtime) => `Java ${runtime.major}（${runtime.path}）`).join('、')
    throw new ManagerError(
      'JAVA_REQUIRED',
      `该服务器（Paper ${record.mcVersion}）需要 ${required.label}+。当前检测到：${detected}。请到面板「Java 环境」页安装 JDK ${required.major}，或选择满足要求的运行时。`,
    )
  }

  // ── process control ────────────────────────────────────────────────────

  async startServer(id) {
    const record = this.store.get(id)
    const eula = (await readEula(record.dir)) || record.acceptEula === true
    if (!eula) throw new ManagerError('EULA_REQUIRED', '还没有接受 Minecraft EULA：请先勾选同意 EULA 再启动')
    if (this.runtime.status(id).running) return { status: this.runtime.status(id), java: this.javaSummary(id) }
    const resolved = await this.resolveJava(record)
    await this.runtime.start(record, {
      eulaAccepted: true,
      memoryMb: record.memoryMb,
      javaCommand: resolved.runtime.path,
    })
    return {
      status: this.runtime.status(id),
      java: {
        path: resolved.runtime.path,
        version: resolved.runtime.version,
        major: resolved.runtime.major,
        source: resolved.source,
        required: resolved.required.major,
      },
    }
  }

  async stopServer(id) {
    this.store.get(id)
    await this.runtime.stop(id)
    return { status: this.runtime.status(id) }
  }

  async restartServer(id) {
    this.store.get(id)
    await this.runtime.stop(id)
    return this.startServer(id)
  }

  status(id) {
    const record = this.store.get(id)
    return { ...this.describe(record) }
  }

  consoleSince(id, cursor) {
    this.store.get(id)
    return this.runtime.consoleSince(id, cursor)
  }

  async command(id, command, { timeoutMs = 1500 } = {}) {
    this.store.get(id)
    ensure(this.runtime.status(id).running, 'SERVER_STOPPED', '服务器未运行，命令只能发送给运行中的服务器')
    const lines = await this.runtime.commandAndWait(id, command, { timeoutMs })
    return {
      command: String(command),
      output: lines.map((line) => line.text),
      status: this.runtime.status(id),
    }
  }

  async players(id) {
    this.store.get(id)
    if (!this.runtime.status(id).running) return { online: 0, max: 0, names: [], running: false }
    const lines = await this.runtime.commandAndWait(id, 'list', {
      timeoutMs: 2500,
      matcher: (text) => /players online/i.test(text),
    })
    for (const line of lines) {
      const match = /There are (\d+) of a max of (\d+) players online:?\s*(.*)$/i.exec(line.text)
      if (match !== null) {
        const names = match[3].split(',').map((name) => name.trim()).filter(Boolean)
        return { online: Number(match[1]), max: Number(match[2]), names, running: true }
      }
    }
    return { online: 0, max: 0, names: [], running: true }
  }

  // ── properties ─────────────────────────────────────────────────────────

  async properties(id) {
    const record = this.store.get(id)
    const { properties } = await readProperties(record.dir)
    return { properties, running: this.runtime.status(id).running }
  }

  async setProperties(id, patch) {
    const record = this.store.get(id)
    ensure(patch !== null && typeof patch === 'object' && !Array.isArray(patch), 'INVALID_INPUT', 'properties 必须是对象')
    const { properties } = await updateProperties(record.dir, patch)
    const running = this.runtime.status(id).running
    const requiresRestart = running && Object.keys(patch).length > 0
    return {
      properties,
      running,
      note: requiresRestart ? 'server.properties 修改在重启服务器后生效' : undefined,
    }
  }

  // ── gamerules ──────────────────────────────────────────────────────────

  async gamerules(id, { rules, world } = {}) {
    const record = this.store.get(id)
    const requested = normalizeRules(rules)
    const running = this.runtime.status(id).running
    if (running) {
      const names = requested ?? GAMERULE_CATALOG.map((entry) => entry.key)
      const startSeq = this.runtime.consoleSince(id, 0).cursor
      for (const name of names) {
        try {
          this.runtime.send(id, `gamerule ${name}`)
        } catch {
          break
        }
      }
      const values = {}
      const deadline = Date.now() + 6000
      while (Object.keys(values).length < names.length && Date.now() < deadline) {
        const { lines } = this.runtime.consoleSince(id, startSeq)
        for (const line of lines) {
          for (const name of names) {
            if (values[name] !== undefined) continue
            const parsed = parseGameruleReply(line.text, name)
            if (parsed !== null) values[name] = parsed
          }
        }
        if (Object.keys(values).length >= names.length) break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      return { source: 'console', world: world ?? (await this.primaryWorld(record)).name, values, missing: names.filter((name) => values[name] === undefined) }
    }
    const target = world ?? (await this.primaryWorld(record)).name
    const level = await readLevelDat(join(record.dir, target))
    const values = level?.gamerules ?? {}
    if (requested !== null) {
      for (const name of Object.keys(values)) if (!requested.includes(name)) delete values[name]
      for (const name of requested) if (values[name] === undefined) values[name] = null
    }
    return { source: 'level.dat', world: target, values, running: false }
  }

  async setGamerule(id, { rule, value, world }) {
    const record = this.store.get(id)
    const name = String(rule ?? '').trim().replace(/^minecraft:/, '')
    ensure(/^[A-Za-z][A-Za-z0-9]*$/.test(name), 'INVALID_INPUT', 'gamerule 名称不合法')
    const entry = GAMERULE_BY_KEY.get(name)
    const text = gameruleValue(name, value, entry?.type)
    ensure(this.runtime.status(id).running, 'SERVER_STOPPED', '服务器未运行：请在服务器运行后修改 gamerule，或先启动服务器')
    const lines = await this.runtime.commandAndWait(id, `gamerule ${name} ${text}`, {
      timeoutMs: 2500,
      matcher: (line) => /Gamerule|Unknown|unknown|error/i.test(line),
    })
    const output = lines.map((line) => line.text)
    const readBack = await this.gamerules(id, { rules: [name], world })
    return { rule: name, value: readBack.values[name] ?? text, output, world: readBack.world }
  }

  async primaryWorld(record) {
    const { properties } = await readProperties(record.dir)
    const name = properties['level-name'] || 'world'
    return { name }
  }

  // ── plugins ────────────────────────────────────────────────────────────

  async plugins(id) {
    const record = this.store.get(id)
    return {
      plugins: await listPlugins(join(record.dir, 'plugins')),
      running: this.runtime.status(id).running,
      defaults: DEFAULT_PLUGINS,
    }
  }

  async installPlugin(id, { kind = 'url', url, slug, name, version }) {
    const record = this.store.get(id)
    const pluginsDir = join(record.dir, 'plugins')
    const warnings = []
    if (kind === 'defaults') {
      const result = await this.installDefaults(record)
      return { installed: result.installed, warnings: result.warnings, running: this.runtime.status(id).running }
    }
    if (kind === 'slug') {
      ensure(typeof slug === 'string' && slug.trim() !== '', 'INVALID_INPUT', '缺少 Modrinth slug')
      const resolved = await resolveModrinthJar(slug, { gameVersion: record.mcVersion })
      if (!resolved.compatible) warnings.push(`${resolved.title} 最新版本未声明支持 Minecraft ${record.mcVersion}，可能在启动时被跳过`)
      const installed = await installPluginJar(pluginsDir, {
        url: resolved.url,
        filename: resolved.filename,
        slug: resolved.slug,
        name: resolved.title,
        version: resolved.versionNumber,
      })
      return { installed: [{ ...installed, warning: warnings[0] }], warnings, running: this.runtime.status(id).running, needsRestart: true }
    }
    ensure(typeof url === 'string' && /^https?:\/\//i.test(url), 'INVALID_INPUT', '缺少插件下载 URL')
    const installed = await installPluginJar(pluginsDir, { url, name, version })
    return { installed: [installed], warnings, running: this.runtime.status(id).running, needsRestart: true }
  }

  /** Install LuckPerms + EssentialsX when missing. Never fails the whole server creation. */
  async installDefaults(record) {
    const pluginsDir = join(record.dir, 'plugins')
    const installed = []
    const warnings = []
    for (const plugin of DEFAULT_PLUGINS) {
      try {
        if (await hasPlugin(pluginsDir, { slug: plugin.slug, name: plugin.name })) {
          installed.push({ slug: plugin.slug, name: plugin.name, skipped: true })
          continue
        }
        const resolved = await resolveModrinthJar(plugin.slug, { gameVersion: record.mcVersion })
        if (!resolved.compatible) warnings.push(`${resolved.title} 最新版本未声明支持 Minecraft ${record.mcVersion}，启动时可能不会被加载`)
        const result = await installPluginJar(pluginsDir, {
          url: resolved.url,
          filename: resolved.filename,
          slug: resolved.slug,
          name: resolved.title,
          version: resolved.versionNumber,
        })
        installed.push({ ...result, name: resolved.title })
      } catch (error) {
        warnings.push(`安装 ${plugin.name} 失败：${errorMessage(error)}`)
      }
    }
    return { installed, warnings }
  }

  async togglePlugin(id, { file, enabled }) {
    const record = this.store.get(id)
    const result = await setPluginEnabled(join(record.dir, 'plugins'), file, enabled === true)
    return { ...result, running: this.runtime.status(id).running, needsRestart: this.runtime.status(id).running }
  }

  async removePlugin(id, { file }) {
    const record = this.store.get(id)
    const result = await removePlugin(join(record.dir, 'plugins'), file)
    return { ...result, running: this.runtime.status(id).running, needsRestart: this.runtime.status(id).running }
  }

  // ── worlds / backups ───────────────────────────────────────────────────

  async worlds(id) {
    const record = this.store.get(id)
    return { worlds: await listWorlds(record.dir), backups: await listBackups(record.dir) }
  }

  async backupWorld(id, { world } = {}) {
    const record = this.store.get(id)
    const primary = world ?? (await this.primaryWorld(record)).name
    const running = this.runtime.status(id).running
    if (running) {
      try {
        await this.runtime.commandAndWait(id, 'save-off', { timeoutMs: 1000 })
        await this.runtime.commandAndWait(id, 'save-all flush', {
          timeoutMs: 15000,
          matcher: (line) => /Saved the game/i.test(line) || /Saved the world/i.test(line),
        })
      } catch (error) {
        this.logger?.('warn', `minecraft: 保存世界失败，继续备份：${errorMessage(error)}`)
      }
    }
    try {
      const backup = await createBackup(record.dir, primary)
      return { backup, running, note: running ? '备份期间已临时关闭自动保存，完成后已恢复' : undefined }
    } finally {
      if (running) {
        try {
          await this.runtime.commandAndWait(id, 'save-on', { timeoutMs: 1000 })
        } catch {
          /* best effort */
        }
      }
    }
  }

  async restoreBackup(id, { backup }) {
    const record = this.store.get(id)
    ensure(typeof backup === 'string' && backup !== '', 'INVALID_INPUT', '缺少备份文件名')
    ensure(this.runtime.status(id).running === false, 'SERVER_RUNNING', '恢复存档前请先停止服务器')
    const result = await restoreBackup(record.dir, backup)
    return result
  }

  async deleteBackup(id, { backup }) {
    const record = this.store.get(id)
    return deleteBackup(record.dir, backup)
  }

  // ── misc ───────────────────────────────────────────────────────────────

  /** Paths and sizes shown in the panel's overview card. */
  async diskUsage(id) {
    const record = this.store.get(id)
    const jar = await sizeOf(join(record.dir, 'paper.jar'))
    return { dir: record.dir, jarBytes: jar }
  }

  /** Read the `logs/latest.log` tail for a stopped server. */
  async latestLog(id) {
    const record = this.store.get(id)
    try {
      const text = await readFile(join(record.dir, 'logs', 'latest.log'), 'utf8')
      return { lines: text.split(/\r?\n/).slice(-300) }
    } catch (error) {
      if (error.code === 'ENOENT') return { lines: [] }
      throw error
    }
  }
}

function normalizeRules(rules) {
  if (rules === undefined) return null
  const list = Array.isArray(rules) ? rules : String(rules).split(',')
  const names = list.map((rule) => String(rule).trim()).filter((rule) => rule !== '')
  return names.length === 0 ? null : names.filter((name) => /^[A-Za-z][A-Za-z0-9]*$/.test(name))
}

function errorMessage(error) {
  return error instanceof ManagerError ? error.message : String(error?.message ?? error)
}

