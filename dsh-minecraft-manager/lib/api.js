/**
 * HTTP surface for the browser panel, mounted on the host web server at
 * `/mc/api`. Every route is same-origin (the panel runs on the DSH page); the
 * web server itself does not authenticate custom routes, so we reject
 * cross-site Origins and keep the data local.
 */
import { ManagerError } from './util.js'
import { probeJava } from './java.js'

const PREFIX = '/mc/api'
const MAX_BODY = 1024 * 1024

/** Reject browser requests whose Origin is not a loopback page. */
function originTrusted(req) {
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    const { hostname } = new URL(origin)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
  } catch {
    return false
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } })
}

async function readJson(req, limit = MAX_BODY) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > limit) throw new ManagerError('INVALID_INPUT', '请求体过大')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new ManagerError('INVALID_INPUT', '请求体不是合法 JSON')
  }
}

const STATUS_BY_CODE = {
  INVALID_INPUT: 400,
  CONFIRM_MISMATCH: 400,
  EULA_REQUIRED: 400,
  JAR_MISSING: 400,
  JAVA_MISSING: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SERVER_RUNNING: 409,
  SERVER_STOPPED: 409,
  UPSTREAM: 502,
  DOWNLOAD_FAILED: 502,
  ZIP_MISSING: 500,
  BACKUP_FAILED: 500,
  JAVA_REQUIRED: 400,
  JAVA_VERSION: 400,
  JAVA_INSTALL_FAILED: 502,
}

function statusOf(error) {
  if (error instanceof ManagerError) return STATUS_BY_CODE[error.code] ?? 500
  if (error?.code === 'ENOENT') return 404
  return 500
}

/**
 * Create the request handler bound to one Manager.
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createApiHandler(manager, logger) {
  return async function handler(req, res) {
    try {
      if (!originTrusted(req)) return sendError(res, 403, 'FORBIDDEN', '拒绝跨站请求')
      const url = new URL(req.url ?? '/', 'http://localhost')
      const pathname = url.pathname
      if (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)) return sendError(res, 404, 'NOT_FOUND', '未知接口')
      const rest = pathname.slice(PREFIX.length).split('/').filter(Boolean).map((part) => decodeURIComponent(part))
      await dispatch(manager, req, res, url, rest)
    } catch (error) {
      const status = statusOf(error)
      const code = error instanceof ManagerError ? error.code : 'INTERNAL'
      if (status >= 500) logger?.('warn', `minecraft-api: ${req.method} ${req.url} 失败：${error?.stack ?? error}`)
      sendError(res, status, code, error?.message ?? String(error))
    }
  }
}

async function dispatch(manager, req, res, url, rest) {
  const method = req.method ?? 'GET'

  // GET /mc/api/meta
  if (rest.length === 1 && rest[0] === 'meta') return sendJson(res, 200, await manager.meta())

  // GET /mc/api/versions
  if (rest.length === 1 && rest[0] === 'versions') {
    allow(method, 'GET')
    return sendJson(res, 200, await manager.versions())
  }

  // /mc/api/java
  if (rest.length >= 1 && rest[0] === 'java') {
    if (rest.length === 1) {
      allow(method, 'GET')
      return sendJson(res, 200, await manager.javaInfo())
    }
    if (rest.length === 2 && rest[1] === 'install') {
      allow(method, 'POST')
      const body = await readJson(req)
      return sendJson(res, 200, await manager.installJavaVersion(body?.version))
    }
    if (rest.length === 2 && rest[1] === 'select') {
      allow(method, 'POST')
      const body = await readJson(req)
      return sendJson(res, 200, await manager.selectDefaultJava(body?.path))
    }
    if (rest.length === 2 && rest[1] === 'probe') {
      allow(method, 'POST')
      const body = await readJson(req)
      const probe = await probeJava(String(body?.path ?? '').trim())
      return sendJson(res, 200, probe)
    }
    throw notFound()
  }

  // /mc/api/servers
  if (rest.length === 1 && rest[0] === 'servers') {
    if (method === 'GET') return sendJson(res, 200, { servers: manager.listServers() })
    if (method === 'POST') {
      const body = await readJson(req)
      return sendJson(res, 200, await manager.createServer(body))
    }
    throw methodNotAllowed()
  }

  if (rest[0] !== 'servers' || rest.length < 2) throw notFound()
  const id = rest[1]

  // /mc/api/servers/:id
  if (rest.length === 2) {
    if (method === 'GET') return sendJson(res, 200, await manager.server(id))
    if (method === 'DELETE') {
      const body = method === 'DELETE' ? await readJson(req).catch(() => ({})) : {}
      return sendJson(res, 200, await manager.deleteServer(id, { confirmName: body?.confirmName }))
    }
    throw methodNotAllowed()
  }

  const action = rest[2]

  if (rest.length === 3) {
    switch (action) {
      case 'status':
        allow(method, 'GET')
        return sendJson(res, 200, await manager.status(id))
      case 'start':
        allow(method, 'POST')
        return sendJson(res, 200, await manager.startServer(id))
      case 'stop':
        allow(method, 'POST')
        return sendJson(res, 200, await manager.stopServer(id))
      case 'restart':
        allow(method, 'POST')
        return sendJson(res, 200, await manager.restartServer(id))
      case 'eula': {
        allow(method, 'POST')
        const body = await readJson(req)
        return sendJson(res, 200, await manager.setEula(id, body?.accept === true))
      }
      case 'java': {
        allow(method, 'POST')
        const body = await readJson(req)
        return sendJson(res, 200, await manager.setServerJava(id, body?.path ?? null))
      }
      case 'command': {
        allow(method, 'POST')
        const body = await readJson(req)
        if (typeof body?.command !== 'string' || body.command.trim() === '') throw new ManagerError('INVALID_INPUT', '缺少 command')
        return sendJson(res, 200, await manager.command(id, body.command))
      }
      case 'players':
        allow(method, 'GET')
        return sendJson(res, 200, await manager.players(id))
      case 'console': {
        allow(method, 'GET')
        const cursor = Number(url.searchParams.get('cursor') ?? 0)
        return sendJson(res, 200, manager.consoleSince(id, cursor))
      }
      case 'latest-log':
        allow(method, 'GET')
        return sendJson(res, 200, await manager.latestLog(id))
      case 'properties':
        if (method === 'GET') return sendJson(res, 200, await manager.properties(id))
        if (method === 'PUT' || method === 'POST') {
          const body = await readJson(req)
          return sendJson(res, 200, await manager.setProperties(id, body?.properties ?? body))
        }
        throw methodNotAllowed()
      case 'gamerules':
        if (method === 'GET') {
          const rules = url.searchParams.get('rules') ?? undefined
          const world = url.searchParams.get('world') ?? undefined
          return sendJson(res, 200, await manager.gamerules(id, { rules, world }))
        }
        if (method === 'POST') {
          const body = await readJson(req)
          return sendJson(res, 200, await manager.setGamerule(id, body))
        }
        throw methodNotAllowed()
      case 'plugins':
        if (method === 'GET') return sendJson(res, 200, await manager.plugins(id))
        if (method === 'POST') {
          const body = await readJson(req)
          return sendJson(res, 200, await manager.installPlugin(id, body))
        }
        throw methodNotAllowed()
      case 'plugins-toggle':
        allow(method, 'POST')
        return sendJson(res, 200, await manager.togglePlugin(id, await readJson(req)))
      case 'worlds':
        allow(method, 'GET')
        return sendJson(res, 200, await manager.worlds(id))
      case 'backups':
        if (method === 'GET') return sendJson(res, 200, { backups: (await manager.worlds(id)).backups })
        if (method === 'POST') {
          const body = await readJson(req)
          return sendJson(res, 200, await manager.backupWorld(id, { world: body?.world }))
        }
        throw methodNotAllowed()
      case 'disk':
        allow(method, 'GET')
        return sendJson(res, 200, await manager.diskUsage(id))
      default:
        throw notFound()
    }
  }

  // /mc/api/servers/:id/plugins/<file>  (DELETE)
  if (rest.length === 4 && action === 'plugins') {
    if (method === 'DELETE') {
      const file = rest[3]
      return sendJson(res, 200, await manager.removePlugin(id, { file }))
    }
    throw methodNotAllowed()
  }

  // /mc/api/servers/:id/backups/<name>  (DELETE) or /restore
  if (rest.length === 4 && action === 'backups') {
    const name = rest[3]
    if (method === 'DELETE') return sendJson(res, 200, await manager.deleteBackup(id, { backup: name }))
    throw methodNotAllowed()
  }
  if (rest.length === 5 && action === 'backups' && rest[4] === 'restore') {
    allow(method, 'POST')
    return sendJson(res, 200, await manager.restoreBackup(id, { backup: rest[3] }))
  }

  throw notFound()
}

function allow(method, expected) {
  if (method !== expected) throw methodNotAllowed()
}

function notFound() {
  return new ManagerError('NOT_FOUND', '接口不存在')
}

function methodNotAllowed() {
  return new ManagerError('INVALID_INPUT', '请求方法不允许')
}

export { PREFIX }
