/**
 * Java runtime discovery, version requirements and Adoptium (Temurin) JDK
 * installation.
 *
 * Paper's own requirements table drives `requiredJavaFor`:
 *   1.7.10–1.11 -> 8, 1.12–1.16.4 -> 11, 1.16.5 -> 16,
 *   1.17–1.19 -> 17, 1.20–1.21.11 -> 21, 26.1+ -> 25.
 */
import { spawn } from 'node:child_process'
import { readdir, realpath, rename, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { arch as osArch, homedir, platform as osPlatform } from 'node:os'
import { downloadToFile, ensure, ensureDir, ManagerError, readJson, removeQuietly, sizeOf, USER_AGENT, writeJsonAtomic } from './util.js'

/** Feature versions offered by the installer (all Adoptium LTS lines). */
export const INSTALLABLE_MAJORS = [25, 21, 17, 11, 8]

/** Paper's minimum Java for a Minecraft version. */
export function requiredJavaFor(mcVersion) {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(mcVersion ?? '').trim())
  if (match === null) return { major: 21, label: 'Java 21' }
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3] ?? '0')
  let required = 21
  if (major >= 26) required = 25
  else if (major === 1) {
    if (minor >= 20) required = 21
    else if (minor >= 17) required = 17
    else if (minor === 16 && patch === 5) required = 16
    else if (minor >= 12) required = 11
    else required = 8
  } else {
    required = 25
  }
  return { major: required, label: `Java ${required}` }
}

/** Parse the major version out of a `java -version` string. */
export function majorOf(versionText) {
  const text = String(versionText ?? '')
  const quoted = /version "([^"]+)"/.exec(text)
  const raw = quoted?.[1] ?? (/\b(\d+)(?:\.\d+)*\b/.exec(text)?.[1] ?? '')
  if (raw === '') return null
  const parts = raw.split(/[._+-]/)
  if (parts[0] === '1' && parts.length > 1) return Number(parts[1])
  const value = Number(parts[0])
  return Number.isFinite(value) ? value : null
}

/** Run `<java> -version` and describe the runtime. */
export function probeJava(filePath, { timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    let output = ''
    let child
    try {
      child = spawn(filePath, ['-version'], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ ok: false, path: filePath, error: String(error?.message ?? error) })
      return
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
    }, timeoutMs)
    const collect = (chunk) => {
      output += chunk.toString('utf8')
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, path: filePath, error: error.code === 'ENOENT' ? `未找到 ${filePath}` : String(error.message ?? error) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        resolve({ ok: false, path: filePath, error: output.trim().slice(0, 300) || `退出码 ${code}` })
        return
      }
      const version = /version "([^"]+)"/.exec(output)?.[1] ?? output.split(/\r?\n/)[0]?.trim() ?? ''
      const major = majorOf(output)
      resolve({
        ok: true,
        path: filePath,
        version,
        major,
        vendor: /corretto|amazon/i.test(output) ? 'Amazon Corretto' : /temurin|adoptium/i.test(output) ? 'Temurin' : /oracle/i.test(output) ? 'Oracle' : /openjdk/i.test(output) ? 'OpenJDK' : 'Java',
        raw: output.trim().slice(0, 600),
      })
    })
  })
}

/** Resolve a bare command name (java) to an absolute path when possible. */
async function resolveCommand(command) {
  if (command === '' || command.includes('/') || /^[A-Za-z]:\\/.test(command)) return command
  return new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'where' : 'which', [command], { stdio: ['ignore', 'pipe', 'ignore'] })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk.toString('utf8') })
    child.on('error', () => resolve(command))
    child.on('close', (code) => resolve(code === 0 && output.trim() !== '' ? output.split(/\r?\n/)[0].trim() : command))
  })
}

/** Read a directory's child names, tolerating missing directories. */
async function children(dir) {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** Candidate java executables from PATH-adjacent conventions and managed installs. */
export async function collectCandidates({ root, configCommand }) {
  const candidates = []
  const push = (path) => {
    if (typeof path === 'string' && path.trim() !== '') candidates.push(path)
  }
  const command = await resolveCommand(configCommand || 'java')
  push(command)
  if (process.env.JAVA_HOME) push(join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'))

  // Managed runtimes installed by this plugin.
  for (const entry of await children(join(root, 'java'))) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) push(join(root, 'java', entry.name, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'))
  }

  if (osPlatform() === 'darwin') {
    for (const base of ['/Library/Java/JavaVirtualMachines', join(homedir(), 'Library/Java/JavaVirtualMachines')]) {
      for (const entry of await children(base)) {
        if (entry.isDirectory()) push(join(base, entry.name, 'Contents', 'Home', 'bin', 'java'))
      }
    }
  }

  // Homebrew / linux distro JDKs.
  for (const base of ['/opt/homebrew/opt', '/usr/local/opt']) {
    for (const entry of await children(base)) {
      if (entry.isDirectory() && entry.name.startsWith('openjdk')) push(join(base, entry.name, 'bin', 'java'))
    }
  }
  for (const base of ['/opt/homebrew/Cellar', '/usr/local/Cellar']) {
    for (const entry of await children(base)) {
      if (!entry.isDirectory() || !entry.name.startsWith('openjdk')) continue
      const versions = await children(join(base, entry.name))
      for (const version of versions) {
        if (version.isDirectory()) push(join(base, entry.name, version.name, 'bin', 'java'))
      }
    }
  }
  for (const entry of await children('/usr/lib/jvm')) {
    if (entry.isDirectory()) push(join('/usr/lib/jvm', entry.name, 'bin', 'java'))
  }

  // Common user-level managers.
  for (const base of [join(homedir(), '.sdkman', 'candidates', 'java'), join(homedir(), '.jdks'), join(homedir(), '.gradle', 'jdks')]) {
    for (const entry of await children(base)) {
      if (!entry.isDirectory()) continue
      if (entry.name === 'current') push(join(base, entry.name, 'bin', 'java'))
      else push(join(base, entry.name, 'bin', 'java'))
      const inner = join(base, entry.name, 'Contents', 'Home', 'bin', 'java')
      push(inner)
    }
  }
  // Windows installs and Scoop/Chocolatey conventions.
  if (process.platform === 'win32') {
    for (const base of ['C:\\Program Files\\Java', 'C:\\Program Files\\Eclipse Adoptium']) {
      for (const entry of await children(base)) {
        if (entry.isDirectory()) push(join(base, entry.name, 'bin', 'java.exe'))
      }
    }
  }

  // Keep only existing files and unique real paths.
  const unique = new Map()
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate)
      if (!info.isFile()) continue
      const real = await realpath(candidate).catch(() => candidate)
      if (!unique.has(real)) unique.set(real, candidate)
    } catch {
      /* missing candidate */
    }
  }
  return [...unique.values()]
}

let cache = { key: '', at: 0, runtimes: [] }

/**
 * Probe every candidate runtime. Results are cached for 20 seconds.
 * @returns {Promise<Array<{path: string, version: string, major: number, vendor: string, managed: boolean}>>}
 */
export async function listRuntimes({ root, configCommand, force = false }) {
  const key = `${root}\u0000${configCommand}`
  if (!force && cache.key === key && Date.now() - cache.at < 20000) return cache.runtimes
  const candidates = await collectCandidates({ root, configCommand })
  const managedDir = join(root, 'java')
  const runtimes = []
  const queue = [...candidates]
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (;;) {
      const candidate = queue.shift()
      if (candidate === undefined) return
      const probe = await probeJava(candidate)
      if (!probe.ok || probe.major === null) continue
      const managed = probe.path.startsWith(`${managedDir}/`) || probe.path.startsWith(`${managedDir}\\`)
      runtimes.push({
        path: probe.path,
        version: probe.version,
        major: probe.major,
        vendor: probe.vendor,
        managed,
      })
    }
  })
  await Promise.all(workers)
  runtimes.sort((left, right) => right.major - left.major || Number(right.managed) - Number(left.managed) || left.path.localeCompare(right.path))
  cache = { key, at: Date.now(), runtimes }
  return runtimes
}

/** Forget cached probes after an install or selection change. */
export function invalidateJavaCache() {
  cache = { key: '', at: 0, runtimes: [] }
}

/** Pick a runtime satisfying `requiredMajor`: exact match first, then the lowest sufficient. */
export function pickRuntime(runtimes, requiredMajor) {
  const usable = runtimes.filter((runtime) => Number(runtime.major) >= requiredMajor)
  if (usable.length === 0) return null
  const exact = usable.find((runtime) => Number(runtime.major) === requiredMajor)
  if (exact !== undefined) return exact
  return usable.reduce((best, runtime) => (Number(runtime.major) < Number(best.major) ? runtime : best))
}

function javaPlatform() {
  const rawArch = osArch()
  const arch = rawArch === 'arm64' ? 'aarch64' : rawArch === 'x64' ? 'x64' : rawArch
  if (osPlatform() === 'darwin') return { family: 'mac', correttoOs: 'macos', arch, ext: 'tar.gz' }
  if (osPlatform() === 'win32') return { family: 'windows', correttoOs: 'windows', arch, ext: 'zip' }
  return { family: 'linux', correttoOs: 'linux', arch, ext: 'tar.gz' }
}

/** Run a system command, rejecting with stderr on failure. */
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
    child.on('error', (error) => reject(new ManagerError('JAVA_INSTALL_FAILED', `无法运行 ${command}：${error.message}`)))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new ManagerError('JAVA_INSTALL_FAILED', `${command} 退出码 ${code}${stderr ? `：${stderr.slice(-500)}` : ''}`))
    })
  })
}

/** Find the JDK home (a directory containing bin/java) below `dir`. */
async function findJavaHome(dir, depth = 0) {
  const binary = join(dir, 'bin', osPlatform() === 'win32' ? 'java.exe' : 'java')
  if (existsSync(binary)) return dir
  if (depth >= 4) return null
  for (const entry of await children(dir)) {
    if (!entry.isDirectory()) continue
    const found = await findJavaHome(join(dir, entry.name), depth + 1)
    if (found !== null) return found
  }
  return null
}

/** Amazon Corretto CDN: predictable URL per feature/arch/os, usually the fastest route. */
async function resolveCorretto(feature, platform) {
  return {
    provider: 'Amazon Corretto',
    prefix: 'corretto',
    name: `amazon-corretto-${feature}-${platform.arch}-${platform.correttoOs}-jdk.${platform.ext}`,
    url: `https://corretto.aws/downloads/latest/amazon-corretto-${feature}-${platform.arch}-${platform.correttoOs}-jdk.${platform.ext}`,
    size: 0,
  }
}

/** Eclipse Temurin via the Adoptium API (asset download may go through GitHub). */
async function resolveAdoptium(feature, platform) {
  const os = platform.family === 'mac' ? 'mac' : platform.correttoOs
  const url = `https://api.adoptium.net/v3/assets/latest/${feature}/hotspot?architecture=${encodeURIComponent(platform.arch)}&image_type=jdk&os=${encodeURIComponent(os)}&vendor=eclipse`
  const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new ManagerError('JAVA_INSTALL_FAILED', `Adoptium API 返回 HTTP ${response.status}`)
  const assets = await response.json()
  ensure(Array.isArray(assets) && assets.length > 0, 'JAVA_INSTALL_FAILED', `Adoptium 没有 Java ${feature} 的 ${os}/${platform.arch} 安装包`)
  const asset = assets.find((item) => item?.binary?.package?.link !== undefined) ?? assets[0]
  const pkg = asset.binary.package
  ensure(typeof pkg?.link === 'string', 'JAVA_INSTALL_FAILED', 'Adoptium 返回的安装包缺少下载地址')
  return {
    provider: 'Eclipse Temurin',
    prefix: 'temurin',
    name: String(pkg.name ?? `temurin-${feature}.${platform.ext}`),
    url: pkg.link,
    size: Number(pkg.size ?? 0),
  }
}

const PROVIDERS = [
  { id: 'corretto', resolve: resolveCorretto },
  { id: 'adoptium', resolve: resolveAdoptium },
]

/** Unpack a downloaded JDK archive and verify the resulting binary. */
async function unpackJava({ dir, archive, feature, platform, prefix }) {
  const staging = join(dir, `.staging-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
  await ensureDir(staging)
  try {
    if (archive.toLowerCase().endsWith('.zip')) await run('unzip', ['-o', '-q', archive, '-d', staging])
    else await run('tar', ['-xzf', archive, '-C', staging])
    const home = await findJavaHome(staging)
    ensure(home !== null, 'JAVA_INSTALL_FAILED', '解压后找不到 JDK 的 bin/java')
    const target = join(dir, `${prefix}-${feature}-${platform.arch}`)
    const binary = join(target, 'bin', osPlatform() === 'win32' ? 'java.exe' : 'java')
    if (existsSync(target)) {
      const existing = await probeJava(binary)
      if (existing.ok && Number(existing.major) === feature) {
        return { path: binary, version: existing.version, major: existing.major, vendor: existing.vendor, managed: true }
      }
      await removeQuietly(target)
    }
    await rename(home, target)
    const probe = await probeJava(binary)
    ensure(probe.ok, 'JAVA_INSTALL_FAILED', `安装后的 JDK 无法运行：${probe.error ?? '未知错误'}`)
    ensure(Number(probe.major) === feature, 'JAVA_INSTALL_FAILED', `安装版本与请求不符：期望 Java ${feature}，实际 Java ${probe.major}`)
    return { path: binary, version: probe.version, major: probe.major, vendor: probe.vendor, managed: true }
  } finally {
    await removeQuietly(staging)
  }
}

/**
 * Download and install a JDK into `<root>/java/`. Tries Amazon Corretto first
 * (its CDN is fast and not rate-limited), then Eclipse Temurin through the
 * Adoptium API. The archive is verified by running the installed binary.
 * @returns {Promise<{path: string, version: string, major: number, vendor: string, managed: boolean}>}
 */
export async function installJava({ root, version, signal, onProgress }) {
  const feature = Number(version)
  ensure(INSTALLABLE_MAJORS.includes(feature), 'INVALID_INPUT', `只支持安装 Java ${INSTALLABLE_MAJORS.join(' / ')}`)
  const platform = javaPlatform()
  const dir = join(root, 'java')
  const downloads = join(dir, '.downloads')
  await ensureDir(downloads)
  const failures = []
  for (const provider of PROVIDERS) {
    let spec
    try {
      onProgress?.(`查询 ${provider.id === 'corretto' ? 'Amazon Corretto' : 'Eclipse Temurin'} 的 Java ${feature}…`)
      spec = await provider.resolve(feature, platform)
    } catch (error) {
      failures.push(`${provider.id}: ${error?.message ?? error}`)
      continue
    }
    const archive = join(downloads, String(spec.name).replace(/[^A-Za-z0-9._+-]/g, '_'))
    try {
      const existingSize = await sizeOf(archive)
      if (existingSize <= 0 || (spec.size > 0 && existingSize !== spec.size)) {
        onProgress?.(`从 ${spec.provider} 下载 ${spec.name}${spec.size > 0 ? `（约 ${Math.round(spec.size / 1024 / 1024)} MB）` : ''}…`)
        await downloadToFile(spec.url, archive, { maxBytes: 600 * 1024 * 1024, timeoutMs: 5 * 60 * 1000, signal })
      }
      onProgress?.(`解压 ${spec.name}…`)
      const runtime = await unpackJava({ dir, archive, feature, platform, prefix: spec.prefix })
      await removeQuietly(archive)
      invalidateJavaCache()
      onProgress?.(`Java ${runtime.version} 已安装（${spec.provider}）`)
      return runtime
    } catch (error) {
      failures.push(`${spec.provider}: ${error?.message ?? error}`)
    }
  }
  throw new ManagerError('JAVA_INSTALL_FAILED', `Java ${feature} 安装失败。${failures.join('；')}`)
}

/** Default-Java preference persisted in `<root>/settings.json`. */
export async function readSettings(root) {
  try {
    const value = await readJson(join(root, 'settings.json'), {})
    return { defaultJavaPath: typeof value.defaultJavaPath === 'string' && value.defaultJavaPath !== '' ? value.defaultJavaPath : null }
  } catch {
    return { defaultJavaPath: null }
  }
}

/** Persist the default-Java preference. */
export async function writeSettings(root, settings) {
  await writeJsonAtomic(join(root, 'settings.json'), { defaultJavaPath: settings.defaultJavaPath ?? null })
}
