/**
 * Host half of the Minecraft server manager.
 *
 * A cordis plugin (loaded from the profile through cordis.patch.yml) that owns
 * the server registry, Java processes, plugin jars, world backups and the HTTP
 * routes the browser panel talks to, plus the model-facing mc_* tools.
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { Manager } from './manager.js'
import { createApiHandler, PREFIX } from './api.js'
import { createTools } from './tools.js'

export const name = 'minecraft-manager'

/** The web routes need the host HTTP server; everything else is optional. */
export const inject = ['webServer']

const DEFAULT_CONFIG = {
  root: '',
  javaCommand: 'java',
  javaArgs: [],
  defaultMemoryMb: 2048,
  fallbackVersions: ['26.1.2', '1.21.11', '1.21.8', '1.21.4', '1.20.6'],
}

/** Expand a leading ~ and resolve relative roots against the process cwd. */
function resolveRoot(configured) {
  const explicit = typeof configured === 'string' ? configured.trim() : ''
  const fromEnv = (process.env.DSH_MC_ROOT ?? '').trim()
  let root = explicit !== '' ? explicit : fromEnv !== '' ? fromEnv : join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'minecraft')
  if (root === '~') root = homedir()
  else if (root.startsWith('~/')) root = join(homedir(), root.slice(2))
  return resolve(root)
}

/** Accept either a string ("-XX:+UseG1GC -Xms2G") or an array of java arguments. */
function parseJavaArgs(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter((item) => item.trim() !== '')
  if (typeof value === 'string') return value.split(/\s+/).filter((item) => item.trim() !== '')
  return []
}

function logThrough(ctx) {
  return (level, message) => {
    const logger = ctx.logger
    const fn = logger?.[level]
    if (typeof fn === 'function') fn.call(logger, message)
    else if (level === 'error') console.error(message)
  }
}

export function apply(ctx, rawConfig) {
  const config = { ...DEFAULT_CONFIG, ...(rawConfig ?? {}) }
  config.javaArgs = parseJavaArgs(config.javaArgs)
  config.defaultMemoryMb = Number(config.defaultMemoryMb) > 0 ? Number(config.defaultMemoryMb) : DEFAULT_CONFIG.defaultMemoryMb
  const root = resolveRoot(config.root)
  const manager = new Manager({ root, config, logger: logThrough(ctx) })

  // Plugin teardown (HMR replacement or app shutdown) stops every child process.
  ctx.effect(() => () => {
    manager.dispose().catch((error) => logThrough(ctx)('warn', `minecraft: 清理服务器进程失败：${String(error)}`))
  }, 'minecraft: server processes')

  // Ready the registry before routes answer; a missing directory is created here.
  const ready = manager.init().catch((error) => {
    logThrough(ctx)('error', `minecraft: 初始化失败：${error?.stack ?? String(error)}`)
    throw error
  })

  const api = createApiHandler(manager, logThrough(ctx))
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: PREFIX,
      handler: (req, res) => {
        // Wait for the registry on the first request instead of blocking activation.
        ready.then(() => api(req, res)).catch((error) => {
          if (!res.headersSent) {
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: { code: 'INTERNAL', message: String(error?.message ?? error) } }))
          } else {
            res.destroy()
          }
        })
      },
    }), 'minecraft: api routes')
  })

  ctx.inject(['tools'], (toolsCtx) => {
    const definitions = createTools(manager)
    const disposers = definitions.map((definition) => {
      try {
        return toolsCtx.tools.register(definition)
      } catch (error) {
        logThrough(ctx)('warn', `minecraft: 注册工具 ${definition.name} 失败：${String(error?.message ?? error)}`)
        return undefined
      }
    })
    toolsCtx.effect(() => () => {
      for (const dispose of disposers) {
        try {
          dispose?.()
        } catch {
          /* already disposed with the fiber */
        }
      }
    }, 'minecraft: model tools')
    logThrough(ctx)('info', `minecraft: 已注册 ${definitions.length} 个 mc_* 工具`)
  })

  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.effect(() => promptCtx.systemPrompt.section({
      name: 'tool:minecraft',
      order: 1500,
      text: [
        'Minecraft server management: the mc_* tools manage Paper servers on this machine through ~/.dsh/minecraft.',
        'Call mc_list_servers before any server-specific action. Never set acceptEula=true unless the user explicitly agrees to the Minecraft EULA.',
        'Java requirements follow Paper: 1.20–1.21.11 needs Java 21, 26.1+ needs Java 25. If mc_start_server reports JAVA_REQUIRED/JAVA_VERSION, inspect mc_list_java_runtimes, install a suitable JDK with mc_install_java, then pin it with mc_set_server_java or rely on auto-selection.',
        'Plugins and server.properties changes take effect after a restart; back up a world before restoring or deleting anything.',
        'Prefer mc_console_command for live in-game rules and mc_set_properties for server.properties.',
      ].join(' '),
    }), 'minecraft: prompt section')
  })

  ready.then(() => logThrough(ctx)('info', `minecraft: 服务器管理已就绪（${root}）`))
}
