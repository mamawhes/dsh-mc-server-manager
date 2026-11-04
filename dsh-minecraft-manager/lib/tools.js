/**
 * Model-facing tools. They share the Manager facade with the browser panel, so
 * anything the panel can do the agent can do in conversation, and vice versa.
 * Tool definitions use the plain ToolDefinition shape the built-in registry
 * accepts (name/description/parameters/output/execute), not a compiled helper.
 */
import { ManagerError } from './util.js'

const SERVER_ARG = {
  server: { type: 'string', description: '服务器 id，先用 mc_list_servers 获取' },
}

const SERVER_ID_OUTPUT = {
  schema: { type: 'object', properties: {}, additionalProperties: true },
  render(_args, value) { return [{ type: 'text', text: renderServerList(value) }] },
}

function text(lines) {
  return [{ type: 'text', text: Array.isArray(lines) ? lines.join('\n') : String(lines) }]
}

function okRender(lines) {
  return { schema: { type: 'object', properties: {}, additionalProperties: true }, render(_args, value) { return text(lines(value)) } }
}

function renderServerList(value) {
  const servers = Array.isArray(value?.servers) ? value.servers : []
  if (servers.length === 0) return '还没有 Minecraft 服务器。可以用 mc_create_server 新建一台。'
  return servers.map((server) => {
    const state = server.status?.state === 'running' ? '运行中' : server.status?.state === 'starting' ? '启动中' : '已停止'
    return `- ${server.name}（id: ${server.id}）· Paper ${server.mcVersion} · ${server.memoryMb} MiB · ${state}${server.eulaAccepted ? '' : ' · 未接受 EULA'}`
  }).join('\n')
}

/**
 * Detach a value into lossless JSON: drop undefined/function properties,
 * convert Date to ISO strings, and refuse cycles. The DSH tool registry rejects
 * any canonical value that would not survive a JSON round trip unchanged.
 */
function losslessJson(value, ancestors = new WeakSet()) {
  if (value === null) return null
  const type = typeof value
  if (type === 'string' || type === 'boolean') return value
  if (type === 'number') return Number.isFinite(value) ? value : null
  if (type !== 'object') return undefined
  if (ancestors.has(value)) return undefined
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const array = value.map((entry) => losslessJson(entry, ancestors))
      return array.map((entry) => (entry === undefined ? null : entry))
    }
    if (value instanceof Date) return value.toISOString()
    const record = {}
    for (const [key, entry] of Object.entries(value)) {
      const detached = losslessJson(entry, ancestors)
      if (detached !== undefined) record[key] = detached
    }
    return record
  } finally {
    ancestors.delete(value)
  }
}

/**
 * Build every tool definition for one manager instance.
 * @param {import('./manager.js').Manager} manager
 * @returns {Array<object>}
 */
export function createTools(manager) {
  /** Small helper: run a manager call and turn ManagerError into a readable failure. */
  const run = async (task) => {
    try {
      return await task()
    } catch (error) {
      if (error instanceof ManagerError) throw new Error(`[${error.code}] ${error.message}`)
      throw error
    }
  }

  return [
    {
      name: 'mc_list_servers',
      description: '列出本机由 DSH 管理的全部 Minecraft Paper 服务器：id、名称、版本、内存、运行状态、是否已接受 EULA。做任何服务器操作前先调用它确认 server id。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: { type: 'object', properties: {}, additionalProperties: true },
        render(_args, value) { return text(renderServerList(value)) },
      },
      timeoutMs: 30000,
      async execute() {
        return { servers: manager.listServers() }
      },
    },
    {
      name: 'mc_list_java_runtimes',
      description: '列出本机检测到的所有 Java 运行时（版本、厂商、路径、是否由插件安装），以及默认 Java。给 server 参数时会同时给出该服务器 Paper 版本要求的最低 Java 和当前选择。启动服务器前可用它确认 Java 是否满足要求。',
      parameters: {
        type: 'object',
        properties: {
          server: { type: 'string', description: '可选：服务器 id，用来对照该服务器的 Java 要求' },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', properties: {}, additionalProperties: true },
        render(_args, value) {
          const lines = []
          if (value.server !== undefined) {
            const server = value.server
            lines.push(`服务器「${server.name}」（Paper ${server.mcVersion}）需要 Java ${server.requiredJava?.major ?? '?'}+；当前：${server.javaPath !== null ? `Java ${server.javaMajor}（${server.javaPath}）` : '自动选择'}`)
          }
          lines.push(`默认 Java：${value.defaultPath ?? '未设置（按服务器版本自动选择）'}`)
          const runtimes = value.runtimes ?? []
          if (runtimes.length === 0) lines.push('', '没有检测到任何 Java 运行时。可以用 mc_install_java 安装 Adoptium Temurin JDK。')
          else {
            lines.push('', '检测到的 Java 运行时：')
            for (const runtime of runtimes) {
              lines.push(`- Java ${runtime.major} · ${runtime.vendor} · ${runtime.path}${runtime.managed ? ' · 插件安装' : ''}`)
            }
          }
          return text(lines)
        },
      },
      timeoutMs: 60000,
      async execute(args) {
        const info = await manager.javaInfo()
        if (typeof args?.server === 'string' && args.server !== '') {
          const record = manager.store.get(args.server)
          return { ...info, server: manager.describe(record) }
        }
        return info
      },
    },
    {
      name: 'mc_install_java',
      description: '下载并安装一个 JDK 到 ~/.dsh/minecraft/java（优先 Amazon Corretto CDN，失败回退 Eclipse Temurin/Adoptium），自动解压并验证版本。Paper 1.20–1.21.11 需要 Java 21，Paper 26.1+ 需要 Java 25；如果机器上没有合适 Java，先用本工具安装。下载量约 130–200 MB，可能需要几分钟。',
      parameters: {
        type: 'object',
        properties: {
          version: { type: 'integer', enum: [25, 21, 17, 11, 8], description: '要安装的 Java 主版本（Adoptium LTS）：26.1+ Paper 用 25，1.20–1.21.11 用 21' },
        },
        required: ['version'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', properties: {}, additionalProperties: true },
        render(_args, value) {
          const installed = value.installed ?? {}
          const lines = [`已安装 Java ${installed.major}（${installed.version}）→ ${installed.path}`]
          if (value.defaultPath !== undefined) lines.push(`默认 Java：${value.defaultPath}`)
          return text(lines)
        },
      },
      timeoutMs: 30 * 60 * 1000,
      async execute(args) {
        return run(() => manager.installJavaVersion(args?.version))
      },
    },
    {
      name: 'mc_set_server_java',
      description: '为某台服务器指定 Java 运行时，或传 "auto"（或省略 path）清除选择、改回自动挑选满足 Paper 版本要求的 Java。指定的路径必须可执行且版本不低于服务器要求，否则启动会被拒绝。',
      parameters: {
        type: 'object',
        properties: {
          ...SERVER_ARG,
          path: { type: 'string', description: 'Java 可执行文件绝对路径；省略或 "auto" 表示自动选择' },
        },
        required: ['server'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', properties: {}, additionalProperties: true },
        render(_args, value) {
          if (value.auto === true) return text(`服务器 ${value.server?.name ?? ''} 已改为自动选择 Java（启动时按 Paper 版本要求挑选）`)
          const runtime = value.runtime ?? {}
          return text(`服务器 ${value.server?.name ?? ''} 将使用 Java ${runtime.major}（${runtime.version}）→ ${runtime.path}`)
        },
      },
      timeoutMs: 30000,
      async execute(args) {
        return run(() => manager.setServerJava(args.server, args.path ?? null))
      },
    },
    {
      name: 'mc_create_server',
      description: '新建一台 Paper 服务器：自动从 PaperMC 下载服务端 jar、写入默认 server.properties，并默认安装 LuckPerms 与 EssentialsX 两个插件。创建不代表接受 Minecraft EULA——只有用户明确同意 EULA 时才把 acceptEula 设为 true；否则保持 false，让用户在面板里确认。服务器创建在 ~/.dsh/minecraft 下，不会写入当前工作区。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '服务器显示名，例如「朋友服」' },
          version: { type: 'string', description: 'Minecraft/Paper 版本，例如 26.1.2；省略时使用同时被 LuckPerms 和 EssentialsX 支持的推荐版本' },
          memoryMb: { type: 'integer', description: 'Java 堆内存（MiB），默认 2048' },
          acceptEula: { type: 'boolean', description: '仅在用户明确同意 Minecraft EULA 时为 true' },
          installDefaults: { type: 'boolean', description: '是否安装默认插件 LuckPerms + EssentialsX，默认 true' },
          javaPath: { type: 'string', description: '可选：指定 Java 可执行文件路径；省略时启动时自动挑选' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', properties: {}, additionalProperties: true },
        render(_args, value) {
          const lines = [`已创建服务器「${value.server?.name}」（id: ${value.server?.id}），Paper ${value.paper?.version} build ${value.paper?.build}。`]
          for (const warning of value.warnings ?? []) lines.push(`注意：${warning}`)
          if (!value.server?.eulaAccepted) lines.push('尚未接受 EULA：用户确认后请在面板勾选，或调用 mc_accept_eula。')
          return text(lines)
        },
      },
      timeoutMs: 15 * 60 * 1000,
      async execute(args) {
        return run(() => manager.createServer(args ?? {}))
      },
    },
    {
      name: 'mc_accept_eula',
      description: '设置一台服务器的 eula.txt。只有用户明确表示同意 Minecraft EULA（https://aka.ms/MinecraftEULA）时才调用 accept=true；不同意则保持 false。这是法律协议，不要替用户做主。',
      parameters: {
        type: 'object',
        properties: {
          ...SERVER_ARG,
          accept: { type: 'boolean', description: 'true 表示用户已明确同意 EULA' },
        },
        required: ['server', 'accept'],
        additionalProperties: false,
      },
      output: okRender((value) => `服务器 ${value.id} 的 EULA 状态：${value.eulaAccepted ? '已接受' : '未接受'}`),
      timeoutMs: 30000,
      async execute(args) {
        return run(() => manager.setEula(args.server, args.accept === true))
      },
    },
    {
      name: 'mc_start_server',
      description: '启动一台已接受 EULA 且已有 paper.jar 的服务器。启动是异步的：进程拉起后立即返回，用 mc_server_status 查看是否真正进入运行状态（日志出现 Done 即完成）。启动前会自动挑选满足该 Paper 版本要求的 Java（26.1+ 需要 Java 25，1.20–1.21.11 需要 Java 21）；没有合适 Java 时用 mc_list_java_runtimes / mc_install_java 处理。',
      parameters: { type: 'object', properties: { ...SERVER_ARG }, required: ['server'], additionalProperties: false },
      output: okRender((value) => {
        const lines = [`启动请求已发送，当前状态：${value.status?.state ?? 'unknown'}${value.status?.pid ? `（pid ${value.status.pid}）` : ''}`]
        if (value.java !== undefined) lines.push(`Java ${value.java.major}（${value.java.version}）· ${value.java.source} · 要求 Java ${value.java.required}+`)
        return lines
      }),
      timeoutMs: 120000,
      async execute(args) {
        return run(() => manager.startServer(args.server))
      },
    },
    {
      name: 'mc_stop_server',
      description: '优雅关闭服务器：向控制台发送 stop，等待最多 30 秒，超时后依次 SIGTERM/SIGKILL。返回最终状态与退出码。',
      parameters: { type: 'object', properties: { ...SERVER_ARG }, required: ['server'], additionalProperties: false },
      output: okRender((value) => `服务器已停止。退出码：${value.status?.lastExit?.code ?? '未知'}，信号：${value.status?.lastExit?.signal ?? '无'}`),
      timeoutMs: 120000,
      async execute(args) {
        return run(() => manager.stopServer(args.server))
      },
    },
    {
      name: 'mc_server_status',
      description: '查看一台服务器的运行状态、在线玩家、最近控制台输出，以及进程是否存活。用于确认启动是否完成、排查启动失败。',
      parameters: { type: 'object', properties: { ...SERVER_ARG }, required: ['server'], additionalProperties: false },
      output: {
        schema: { type: 'object', properties: {}, additionalProperties: true },
        render(_args, value) {
          const status = value.status ?? {}
          const players = value.players ?? {}
          const lines = [
            `服务器：${value.name}（${value.id}）`,
            `状态：${status.state}${status.pid ? ` · pid ${status.pid}` : ''}${status.lastExit ? ` · 上次退出 code=${status.lastExit.code}` : ''}`,
            `玩家：${players.online ?? 0}/${players.max ?? 0}${players.names?.length ? `（${players.names.join(', ')}）` : ''}`,
          ]
          if (status.lastError) lines.push(`错误：${status.lastError}`)
          if (value.console?.length) {
            lines.push('', '最近输出：')
            for (const line of value.console.slice(-40)) lines.push(`  ${line.text}`)
          }
          return text(lines)
        },
      },
      timeoutMs: 30000,
      async execute(args) {
        const record = manager.store.get(args.server)
        const status = manager.runtime.status(record.id)
        let players = { online: 0, max: 0, names: [], running: false }
        if (status.running) {
          players = await manager.players(record.id).catch(() => players)
        }
        const console = manager.runtime.consoleSince(record.id, Math.max(0, manager.runtime.consoleSince(record.id, 0).cursor - 80)).lines
        return { ...manager.describe(record), players, console }
      },
    },
    {
      name: 'mc_console_command',
      description: '向运行中的服务器控制台发送一条命令（等同于在服务器控制台输入，例如 list、gamemode、whitelist、save-all、gamerule、plugins），并返回该命令之后 1.5 秒内的控制台输出。不要用它启动/停止服务器。',
      parameters: {
        type: 'object',
        properties: {
          ...SERVER_ARG,
          command: { type: 'string', description: '不含前导斜杠的控制台命令，例如 list 或 gamerule keepInventory true' },
        },
        required: ['server', 'command'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', properties: {}, additionalProperties: true },
        render(args, value) {
          const lines = [`> ${args.command}`]
          for (const line of value.output ?? []) lines.push(line)
          if ((value.output ?? []).length === 0) lines.push('（没有捕获到输出）')
          return text(lines)
        },
      },
      timeoutMs: 30000,
      async execute(args) {
        return run(() => manager.command(args.server, args.command))
      },
    },
    {
      name: 'mc_get_properties',
      description: '读取服务器的 server.properties（MOTD、端口、最大玩家数、难度、正版验证、视距等）。',
      parameters: { type: 'object', properties: { ...SERVER_ARG }, required: ['server'], additionalProperties: false },
      output: {
        schema: { type: 'object', properties: {}, additionalProperties: true },
        render(_args, value) {
          const lines = [`server.properties（${value.running ? '服务器运行中，修改后需重启' : '服务器已停止'}）`]
          for (const [key, val] of Object.entries(value.properties ?? {})) lines.push(`${key}=${val}`)
          return text(lines)
        },
      },
      timeoutMs: 30000,
      async execute(args) {
        return run(() => manager.properties(args.server))
      },
    },
    {
      name: 'mc_set_properties',
      description: '修改 server.properties 中的若干键（例如 motd、max-players、online-mode、difficulty、view-distance）。只传要改的键，会保留其他配置。服务器运行中修改会在重启后生效。',
      parameters: {
        type: 'object',
        properties: {
          ...SERVER_ARG,
          properties: { type: 'object', description: '要修改的键值对，例如 {"motd":"我的服务器","max-players":20}', additionalProperties: { type: ['string', 'number', 'boolean'] } },
        },
        required: ['server', 'properties'],
        additionalProperties: false,
      },
      output: okRender((value) => {
        const lines = ['已写入 server.properties。']
        if (value.note) lines.push(value.note)
        return lines
      }),
      timeoutMs: 30000,
      async execute(args) {
        return run(() => manager.setProperties(args.server, args.properties ?? {}))
      },
    },
    {
      name: 'mc_get_gamerules',
      description: '读取世界游戏规则（gamerule）：keepInventory、mobGriefing、doDaylightCycle、randomTickSpeed 等。服务器运行时通过控制台查询，停止时从 level.dat 读取。省略 rules 时返回常用规则。',
      parameters: {
        type: 'object',
        properties: {
          ...SERVER_ARG,
          world: { type: 'string', description: '世界名，默认取 server.properties 的 level-name' },
          rules: { type: 'string', description: '逗号分隔的规则名，例如 keepInventory,mobGriefing' },
        },
        required: ['server'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', properties: {}, additionalProperties: true },
        render(_args, value) {
          const lines = [`世界 ${value.world} 的 gamerule（来源：${value.source}）：`]
          for (const [rule, val] of Object.entries(value.values ?? {})) lines.push(`${rule}=${val === null ? '（未知）' : val}`)
          if (value.missing?.length) lines.push('未读到：' + value.missing.join(', '))
          return text(lines)
        },
      },
      timeoutMs: 30000,
      async execute(args) {
        return run(() => manager.gamerules(args.server, { world: args.world, rules: args.rules }))
      },
    },
    {
      name: 'mc_set_gamerule',
      description: '修改一条世界游戏规则（gamerule），需要服务器正在运行（通过控制台执行并回读确认）。例如 {rule:"keepInventory", value:true}。',
      parameters: {
        type: 'object',
        properties: {
          ...SERVER_ARG,
          rule: { type: 'string', description: '规则名，例如 keepInventory' },
          value: { type: ['string', 'number', 'boolean'], description: '新值，例如 true 或 3' },
          world: { type: 'string', description: '世界名，可省略' },
        },
        required: ['server', 'rule', 'value'],
        additionalProperties: false,
      },
      output: okRender((value) => `已设置 ${value.rule}=${value.value}（世界 ${value.world}）`),
      timeoutMs: 30000,
      async execute(args) {
        return run(() => manager.setGamerule(args.server, { rule: args.rule, value: args.value, world: args.world }))
      },
    },
    {
      name: 'mc_list_plugins',
      description: '列出服务器 plugins 目录中的插件：文件名、真实插件名/版本、是否启用（.jar.disabled 表示已禁用）、文件大小。',
      parameters: { type: 'object', properties: { ...SERVER_ARG }, required: ['server'], additionalProperties: false },
      output: {
        schema: { type: 'object', properties: {}, additionalProperties: true },
        render(_args, value) {
          const plugins = value.plugins ?? []
          if (plugins.length === 0) return text('plugins 目录为空。可以用 mc_install_plugin 安装插件。')
          const lines = plugins.map((plugin) => `- ${plugin.name}${plugin.version ? ` ${plugin.version}` : ''} · ${plugin.file} · ${plugin.enabled ? '启用' : '已禁用'} · ${formatSize(plugin.size)}`)
          return text(lines)
        },
      },
      timeoutMs: 30000,
      async execute(args) {
        return run(() => manager.plugins(args.server))
      },
    },
    {
      name: 'mc_install_plugin',
      description: '安装 Paper 插件：给 url 从直链安装 jar，给 slug 从 Modrinth 按服务器版本解析最新兼容版本，或给 defaults=true 安装默认插件 LuckPerms + EssentialsX（已装则跳过）。插件在服务器重启后才会加载。',
      parameters: {
        type: 'object',
        properties: {
          ...SERVER_ARG,
          url: { type: 'string', description: 'jar 直链 URL' },
          slug: { type: 'string', description: 'Modrinth 项目 slug，例如 luckperms、essentialsx、vault' },
          defaults: { type: 'boolean', description: 'true 表示安装默认插件 LuckPerms + EssentialsX' },
        },
        required: ['server'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', properties: {}, additionalProperties: true },
        render(_args, value) {
          const installed = value.installed ?? []
          const lines = installed.map((plugin) => `${plugin.skipped ? '已存在，跳过' : '已安装'}：${plugin.name}${plugin.version ? ` ${plugin.version}` : ''}${plugin.file ? ` → ${plugin.file}` : ''}`)
          for (const warning of value.warnings ?? []) lines.push(`注意：${warning}`)
          if (value.needsRestart) lines.push('重启服务器后插件才会加载。')
          return text(lines.length === 0 ? '没有安装任何插件。' : lines)
        },
      },
      timeoutMs: 10 * 60 * 1000,
      async execute(args) {
        const kind = args.defaults === true ? 'defaults' : args.slug !== undefined ? 'slug' : 'url'
        return run(() => manager.installPlugin(args.server, { kind, url: args.url, slug: args.slug }))
      },
    },
    {
      name: 'mc_toggle_plugin',
      description: '启用或禁用一个插件 jar：禁用会把 foo.jar 改名为 foo.jar.disabled，启用则改回。需要重启服务器生效。',
      parameters: {
        type: 'object',
        properties: {
          ...SERVER_ARG,
          file: { type: 'string', description: '插件文件名，例如 LuckPerms-Bukkit-5.5.71.jar' },
          enabled: { type: 'boolean', description: 'true 启用 / false 禁用' },
        },
        required: ['server', 'file', 'enabled'],
        additionalProperties: false,
      },
      output: okRender((value) => `插件 ${value.file} 已${value.enabled ? '启用' : '禁用'}${value.needsRestart ? '，重启服务器后生效' : ''}`),
      timeoutMs: 30000,
      async execute(args) {
        return run(() => manager.togglePlugin(args.server, { file: args.file, enabled: args.enabled === true }))
      },
    },
    {
      name: 'mc_remove_plugin',
      description: '删除 plugins 目录中的一个插件 jar（启用或禁用状态都可）。不可恢复，必要时先把 jar 备份。需要重启服务器生效。',
      parameters: {
        type: 'object',
        properties: {
          ...SERVER_ARG,
          file: { type: 'string', description: '插件文件名，例如 EssentialsX-2.22.0.jar' },
        },
        required: ['server', 'file'],
        additionalProperties: false,
      },
      output: okRender((value) => `已删除插件 ${value.file}${value.needsRestart ? '，重启服务器后生效' : ''}`),
      timeoutMs: 30000,
      async execute(args) {
        return run(() => manager.removePlugin(args.server, { file: args.file }))
      },
    },
    {
      name: 'mc_list_worlds',
      description: '列出服务器存档世界与已有备份：世界名、大小、Minecraft 版本、最后修改时间；备份名、大小、创建时间。',
      parameters: { type: 'object', properties: { ...SERVER_ARG }, required: ['server'], additionalProperties: false },
      output: {
        schema: { type: 'object', properties: {}, additionalProperties: true },
        render(_args, value) {
          const worlds = value.worlds ?? []
          const backups = value.backups ?? []
          const lines = [worlds.length === 0 ? '还没有世界存档（首次启动后生成）。' : '世界：']
          for (const world of worlds) {
            lines.push(`- ${world.name} · ${world.version || '未知版本'} · ${formatSize(world.size)} · 修改于 ${world.lastModified ?? '未知'}`)
          }
          lines.push('', backups.length === 0 ? '还没有备份。' : '备份：')
          for (const backup of backups) lines.push(`- ${backup.name} · ${formatSize(backup.size)} · ${backup.createdAt}`)
          return text(lines)
        },
      },
      timeoutMs: 30000,
      async execute(args) {
        return run(() => manager.worlds(args.server))
      },
    },
    {
      name: 'mc_backup_world',
      description: '把世界（含 world_nether / world_the_end 等同前缀维度目录）打包为 backups/ 下的 zip。服务器运行时先 save-off + save-all flush 再打包，完成后恢复 save-on。省略 world 时备份 server.properties 中 level-name 指向的主世界。',
      parameters: {
        type: 'object',
        properties: {
          ...SERVER_ARG,
          world: { type: 'string', description: '要备份的世界目录名，默认主世界' },
        },
        required: ['server'],
        additionalProperties: false,
      },
      output: okRender((value) => {
        const lines = [`已创建备份 ${value.backup?.name}（${formatSize(value.backup?.size ?? 0)}，包含 ${value.backup?.dirs?.join(', ') ?? ''}）`]
        if (value.note) lines.push(value.note)
        return lines
      }),
      timeoutMs: 10 * 60 * 1000,
      async execute(args) {
        return run(() => manager.backupWorld(args.server, { world: args.world }))
      },
    },
    {
      name: 'mc_restore_world',
      description: '用 backups/ 中的 zip 覆盖当前世界存档。要求服务器已停止；当前世界会先移动到 backups/rollback-<时间戳>/ 作为回滚点。恢复前建议先备份当前世界。',
      parameters: {
        type: 'object',
        properties: {
          ...SERVER_ARG,
          backup: { type: 'string', description: '备份文件名，例如 world-20261103-104715.zip' },
        },
        required: ['server', 'backup'],
        additionalProperties: false,
      },
      output: okRender((value) => `已从 ${value.backup} 恢复世界：${value.restored?.join(', ')}${value.rollback ? `；原世界保留在 ${value.rollback}` : ''}`),
      timeoutMs: 10 * 60 * 1000,
      async execute(args) {
        return run(() => manager.restoreBackup(args.server, { backup: args.backup }))
      },
    },
    {
      name: 'mc_delete_backup',
      description: '删除 backups/ 中的一个 zip 备份。不可恢复。',
      parameters: {
        type: 'object',
        properties: {
          ...SERVER_ARG,
          backup: { type: 'string', description: '备份文件名' },
        },
        required: ['server', 'backup'],
        additionalProperties: false,
      },
      output: okRender((value) => `已删除备份 ${value.name}`),
      timeoutMs: 30000,
      async execute(args) {
        return run(() => manager.deleteBackup(args.server, { backup: args.backup }))
      },
    },
  ].map((definition) => ({
    ...definition,
    async execute(args, exec) {
      return losslessJson(await definition.execute(args, exec))
    },
  }))
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}
