/**
 * On-disk server registry. Every managed server is one directory under
 * `<root>/servers/<id>/`; its `server.json` holds the display metadata while
 * the directory itself is the Paper working directory (paper.jar, plugins,
 * world folders, logs, backups).
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ensure, ensureDir, makeServerId, ManagerError, readJson, removeQuietly, safeSegment, writeJsonAtomic } from './util.js'

export const SERVER_FILE = 'server.json'

export class ServerStore {
  constructor(root, log) {
    this.root = root
    this.log = log
    this.servers = new Map()
  }

  get serversDir() {
    return join(this.root, 'servers')
  }

  /** Load every server directory on disk. */
  async init() {
    await ensureDir(this.serversDir)
    const entries = await readdir(this.serversDir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const id = entry.name
      const record = await readJson(join(this.serversDir, id, SERVER_FILE), null)
      if (record === null || record.id !== id) {
        this.log?.('warn', `minecraft: 忽略没有有效 ${SERVER_FILE} 的服务器目录 ${id}`)
        continue
      }
      this.servers.set(id, normalizeRecord(record, join(this.serversDir, id)))
    }
    return [...this.servers.values()]
  }

  list() {
    return [...this.servers.values()].sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))
  }

  get(id) {
    ensure(typeof id === 'string' && id.length > 0, 'INVALID_INPUT', '缺少服务器 id')
    ensure(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id), 'INVALID_INPUT', '服务器 id 不合法')
    const record = this.servers.get(id)
    if (record === undefined) throw new ManagerError('NOT_FOUND', `服务器不存在：${id}`)
    return record
  }

  dirOf(id) {
    return join(this.serversDir, this.get(id).id)
  }

  /** Create the directory and metadata for a new server; the jar is downloaded by the caller. */
  async create({ name, mcVersion, memoryMb, acceptEula, notes }) {
    const id = makeServerId(name)
    const dir = join(this.serversDir, id)
    await ensureDir(dir)
    await ensureDir(join(dir, 'plugins'))
    await ensureDir(join(dir, 'backups'))
    const record = {
      id,
      name: String(name).trim().slice(0, 64),
      mcVersion,
      memoryMb,
      acceptEula: acceptEula === true,
      createdAt: new Date().toISOString(),
      notes: typeof notes === 'string' ? notes.slice(0, 500) : undefined,
    }
    await writeJsonAtomic(join(dir, SERVER_FILE), record)
    this.servers.set(id, normalizeRecord(record, dir))
    return this.servers.get(id)
  }

  /** Persist a changed record. */
  async update(id, patch) {
    const current = this.get(id)
    const next = normalizeRecord({ ...stripRuntime(current), ...patch }, current.dir)
    await writeJsonAtomic(join(current.dir, SERVER_FILE), stripRuntime(next))
    this.servers.set(id, next)
    return next
  }

  /** Remove a server directory from disk. Callers must stop it first. */
  async remove(id) {
    const record = this.get(id)
    await removeQuietly(record.dir)
    this.servers.delete(id)
    return record
  }

  /** Rename without changing the directory. */
  async rename(id, name) {
    ensure(typeof name === 'string' && name.trim().length > 0, 'INVALID_INPUT', '服务器名称不能为空')
    return this.update(id, { name: name.trim().slice(0, 64) })
  }

  /** Re-read one directory's metadata, e.g. after an external edit. */
  async refresh(id) {
    const record = this.get(id)
    const loaded = await readJson(join(record.dir, SERVER_FILE), null)
    if (loaded !== null && loaded.id === id) this.servers.set(id, normalizeRecord(loaded, record.dir))
    return this.servers.get(id)
  }
}

/** Keep only persisted fields (runtime state is never serialized). */
function stripRuntime(record) {
  const { dir, ...rest } = record
  return rest
}

function normalizeRecord(record, dir) {
  return {
    id: record.id,
    name: typeof record.name === 'string' && record.name.trim() !== '' ? record.name : record.id,
    mcVersion: typeof record.mcVersion === 'string' ? record.mcVersion : '未知',
    memoryMb: Number.isFinite(record.memoryMb) ? record.memoryMb : 2048,
    acceptEula: record.acceptEula === true,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
    ...(typeof record.notes === 'string' ? { notes: record.notes } : {}),
    javaPath: typeof record.javaPath === 'string' && record.javaPath !== '' ? record.javaPath : null,
    javaMajor: Number.isFinite(Number(record.javaMajor)) ? Number(record.javaMajor) : null,
    javaVersion: typeof record.javaVersion === 'string' ? record.javaVersion : null,
    dir,
  }
}

/** Validate a server display name before creating. */
export function checkServerName(name) {
  ensure(typeof name === 'string' && name.trim().length > 0, 'INVALID_INPUT', '服务器名称不能为空')
  ensure(name.trim().length <= 48, 'INVALID_INPUT', '服务器名称最多 48 个字符')
  return name.trim()
}

/** Validate a Minecraft version selector. */
export function checkVersion(version) {
  ensure(typeof version === 'string' && /^\d+\.\d+(\.\d+)?(-[A-Za-z0-9.]+)?$/.test(version.trim()), 'INVALID_INPUT', 'Minecraft 版本格式不正确')
  return version.trim()
}

/** Validate memory bounds (MiB). */
export function checkMemory(memoryMb) {
  const value = Number(memoryMb)
  ensure(Number.isFinite(value) && value >= 512 && value <= 65536, 'INVALID_INPUT', '内存必须在 512 MiB 到 65536 MiB 之间')
  return Math.round(value)
}

/** Accept a Minecraft gamerule name. */
export function checkRuleName(name) {
  return safeSegment(String(name).replace(/^minecraft:/, ''), 'gamerule 名称')
}
