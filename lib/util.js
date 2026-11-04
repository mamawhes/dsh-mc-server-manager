/**
 * Small shared helpers for the Minecraft manager host half. Node built-ins only:
 * the package is loaded from the DSH profile, so it must not require any
 * dependency that is not resolvable from there.
 */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** Maximum accepted download size for a jar (paper or plugin). */
export const MAX_JAR_BYTES = 200 * 1024 * 1024

/** Stable user agent: PaperMC and Modrinth both ask for one. */
export const USER_AGENT = 'dsh-minecraft-manager/0.1.0 (DeepSeek Harness plugin)'

/** Error carrying a machine-readable code understood by the API and tools. */
export class ManagerError extends Error {
  constructor(code, message, details) {
    super(message)
    this.name = 'ManagerError'
    this.code = code
    this.details = details
  }
}

/** Throw a {@link ManagerError} unless the condition holds. */
export function ensure(condition, code, message, details) {
  if (!condition) throw new ManagerError(code, message, details)
}

/** Normalize a user-supplied identifier: no separators, no dot segments. */
export function safeSegment(value, label = 'name') {
  const text = String(value ?? '').trim()
  ensure(text.length > 0 && text.length <= 64, 'INVALID_INPUT', `${label} must be 1-64 characters`)
  ensure(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text), 'INVALID_INPUT', `${label} may only contain letters, digits, dot, underscore and dash`)
  return text
}

/** Filesystem-safe slug for a new server id (the display name is stored separately). */
export function makeServerId(name) {
  const slug = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'server'
  const suffix = Math.random().toString(36).slice(2, 8)
  return `${slug}-${suffix}`
}

/** Timestamp suitable for backup file names: 20261103-104715. */
export function timestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/** Ensure a directory exists. */
export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true })
  return dir
}

/** Read a JSON file, returning a fallback for a missing file. */
export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw error
  }
}

/** Write JSON through a temporary sibling file, then rename into place. */
export async function writeJsonAtomic(file, value) {
  await ensureDir(dirname(file))
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temp, file)
}

/** Write text through a temporary sibling file, then rename into place. */
export async function writeTextAtomic(file, text) {
  await ensureDir(dirname(file))
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, text, 'utf8')
  await rename(temp, file)
}

/** Remove a file or directory without failing when it is already gone. */
export async function removeQuietly(target) {
  await rm(target, { recursive: true, force: true })
}

/** File size in bytes, or 0 when missing. */
export async function sizeOf(file) {
  try {
    return (await stat(file)).size
  } catch {
    return 0
  }
}

/** Human-readable byte size. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

/** SHA-256 hex digest of a file. */
export async function sha256File(file) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), hash)
  return hash.digest('hex')
}

/** JSON fetch with UA, timeout and optional retry. */
export async function fetchJson(url, { timeoutMs = 30000, headers = {}, retries = 1 } = {}) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new ManagerError('UPSTREAM', `GET ${url} -> HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`)
      }
      return await response.json()
    } catch (error) {
      lastError = error
      if (error instanceof ManagerError && error.code === 'UPSTREAM' && !/HTTP 5\d\d/.test(error.message)) break
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
    }
  }
  throw new ManagerError('UPSTREAM', `请求失败：${lastError?.message ?? String(lastError)}`, { url })
}

/**
 * Stream a URL into a file. Follows redirects, enforces the size cap, verifies
 * an optional SHA-256 and writes atomically.
 * @returns {{path: string, bytes: number, sha256: string}}
 */
export async function downloadToFile(url, destination, { sha256, maxBytes = MAX_JAR_BYTES, signal, timeoutMs = 10 * 60 * 1000 } = {}) {
  const temp = `${destination}.${process.pid}.${Date.now()}.download`
  await ensureDir(dirname(destination))
  const signals = [AbortSignal.timeout(timeoutMs)]
  if (signal !== undefined) signals.push(signal)
  const combined = AbortSignal.any(signals)
  let bytes = 0
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT },
      redirect: 'follow',
      signal: combined,
    })
    if (!response.ok || response.body === null) {
      throw new ManagerError('DOWNLOAD_FAILED', `下载失败：HTTP ${response.status}（${url}）`)
    }
    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (contentLength > maxBytes) throw new ManagerError('DOWNLOAD_FAILED', `文件过大：${formatBytes(contentLength)}`)
    const hash = createHash('sha256')
    const output = createWriteStream(temp)
    const source = Readable.fromWeb(response.body)
    await pipeline(source, async function* (stream) {
      for await (const chunk of stream) {
        bytes += chunk.length
        if (bytes > maxBytes) throw new ManagerError('DOWNLOAD_FAILED', `文件超过上限 ${formatBytes(maxBytes)}`)
        hash.update(chunk)
        yield chunk
      }
    }, output)
    const digest = hash.digest('hex')
    if (typeof sha256 === 'string' && sha256.length > 0 && digest.toLowerCase() !== sha256.toLowerCase()) {
      throw new ManagerError('DOWNLOAD_FAILED', '下载文件的 SHA-256 校验不匹配')
    }
    await rename(temp, destination)
    return { path: destination, bytes, sha256: digest }
  } catch (error) {
    await removeQuietly(temp)
    if (error instanceof ManagerError) throw error
    throw new ManagerError('DOWNLOAD_FAILED', `下载失败：${error?.message ?? String(error)}`, { url })
  }
}

/** Delay helper. */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Wait until `probe` returns true or the timeout elapses.
 * @returns true when the probe succeeded.
 */
export async function waitFor(probe, { timeoutMs = 5000, intervalMs = 100, signal } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (signal?.aborted) return false
    if (await probe()) return true
    if (Date.now() >= deadline) return false
    await sleep(intervalMs)
  }
}

/** Resolve a path relative to a server directory and keep it inside that directory. */
export function resolveInside(base, ...parts) {
  const target = join(base, ...parts)
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  ensure(target === base || target.startsWith(normalizedBase), 'INVALID_INPUT', '路径越界')
  return target
}
