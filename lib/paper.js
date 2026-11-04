/**
 * PaperMC Fill v3 API client. The legacy api.papermc.io/v2 API is gone (HTTP
 * 410), so versions, builds and jar downloads all come from fill.papermc.io.
 */
import { ensure, fetchJson, ManagerError } from './util.js'

const FILL_BASE = 'https://fill.papermc.io/v3'
const CACHE_TTL_MS = 10 * 60 * 1000

/** In-memory response cache so the UI can poll without hammering the API. */
const cache = new Map()

async function cached(key, loader) {
  const hit = cache.get(key)
  if (hit !== undefined && Date.now() - hit.at < CACHE_TTL_MS) return hit.value
  const value = await loader()
  cache.set(key, { at: Date.now(), value })
  return value
}

/**
 * Every Paper version, newest first.
 * @returns {Promise<{versions: string[], latest: string}>}
 */
export async function paperVersions() {
  return cached('versions', async () => {
    const payload = await fetchJson(`${FILL_BASE}/projects/paper`)
    const groups = payload?.versions
    ensure(groups !== null && typeof groups === 'object', 'UPSTREAM', 'PaperMC 返回了无法识别的版本列表')
    const versions = []
    for (const group of Object.values(groups)) {
      if (!Array.isArray(group)) continue
      for (const version of group) {
        if (typeof version !== 'string') continue
        if (/-pre|-rc/.test(version)) continue
        if (!versions.includes(version)) versions.push(version)
      }
    }
    ensure(versions.length > 0, 'UPSTREAM', 'PaperMC 没有返回任何可用版本')
    return { versions, latest: versions[0] }
  })
}

/**
 * Builds for one version, newest first, stable channel first.
 * @returns {Promise<Array<{id: number, channel: string, time: string, download: {name: string, url: string, sha256?: string, size?: number}}>>}
 */
export async function paperBuilds(version) {
  return cached(`builds:${version}`, async () => {
    const list = await fetchJson(`${FILL_BASE}/projects/paper/versions/${encodeURIComponent(version)}/builds`, { timeoutMs: 60000 })
    ensure(Array.isArray(list) && list.length > 0, 'UPSTREAM', `PaperMC 没有 ${version} 的构建`)
    return list
      .map((build) => {
        const download = build?.downloads?.['server:default'] ?? Object.values(build?.downloads ?? {})[0]
        if (download === undefined || typeof download.url !== 'string') return null
        return {
          id: Number(build.id),
          channel: String(build.channel ?? 'UNKNOWN'),
          time: String(build.time ?? ''),
          download: {
            name: String(download.name ?? `paper-${version}-${build.id}.jar`),
            url: String(download.url),
            sha256: download.checksums?.sha256,
            size: Number(download.size ?? 0),
          },
        }
      })
      .filter(Boolean)
      .sort((left, right) => right.id - left.id)
  })
}

/** Prefer the newest STABLE build, falling back to the newest build. */
export async function resolvePaperDownload(version) {
  const builds = await paperBuilds(version)
  const stable = builds.find((build) => build.channel === 'STABLE')
  const chosen = stable ?? builds[0]
  return { version, build: chosen.id, channel: chosen.channel, time: chosen.time, ...chosen.download }
}

/** The filename a jar gets on disk. */
export function paperJarName() {
  return 'paper.jar'
}

/** Ensure a friendly error when PaperMC cannot be reached. */
export function paperNetworkHint(error) {
  if (error instanceof ManagerError) return error
  return new ManagerError('UPSTREAM', `无法连接 PaperMC 下载服务器：${error?.message ?? String(error)}`)
}
