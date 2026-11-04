/**
 * Modrinth API client used for plugin jars. Paper itself comes from PaperMC;
 * plugins (LuckPerms, EssentialsX and any slug a user names) come from
 * Modrinth, whose API needs no key for public projects.
 */
import { ensure, fetchJson, ManagerError } from './util.js'

const MODRINTH_BASE = 'https://api.modrinth.com/v2'
const LOADERS = ['paper', 'spigot', 'bukkit']
const CACHE_TTL_MS = 10 * 60 * 1000
const cache = new Map()

/** Plugins installed into a fresh server unless the user opts out. */
export const DEFAULT_PLUGINS = [
  { slug: 'luckperms', name: 'LuckPerms' },
  { slug: 'essentialsx', name: 'EssentialsX' },
]

/** Modrinth slugs are lower-case project slugs. */
export function checkSlug(slug) {
  const text = String(slug ?? '').trim().toLowerCase()
  ensure(/^[a-z0-9][a-z0-9-]{0,63}$/.test(text), 'INVALID_INPUT', 'Modrinth slug 只能包含小写字母、数字和连字符')
  return text
}

async function cached(key, loader) {
  const hit = cache.get(key)
  if (hit !== undefined && Date.now() - hit.at < CACHE_TTL_MS) return hit.value
  const value = await loader()
  cache.set(key, { at: Date.now(), value })
  return value
}

/** Project metadata (title, icon, supported versions). */
export async function modrinthProject(slug) {
  const key = checkSlug(slug)
  return cached(`project:${key}`, async () => {
    try {
      return await fetchJson(`${MODRINTH_BASE}/project/${key}`)
    } catch (error) {
      if (error instanceof ManagerError && /HTTP 404/.test(error.message)) {
        throw new ManagerError('NOT_FOUND', `Modrinth 上找不到项目：${key}`)
      }
      throw error
    }
  })
}

/** Every version of a project, newest first. */
export async function modrinthVersions(slug) {
  const key = checkSlug(slug)
  return cached(`versions:${key}`, async () => {
    try {
      const list = await fetchJson(`${MODRINTH_BASE}/project/${key}/version`, { timeoutMs: 45000 })
      ensure(Array.isArray(list), 'UPSTREAM', 'Modrinth 返回了无法识别的版本列表')
      return list
    } catch (error) {
      if (error instanceof ManagerError && /HTTP 404/.test(error.message)) {
        throw new ManagerError('NOT_FOUND', `Modrinth 上找不到项目：${key}`)
      }
      throw error
    }
  })
}

/**
 * Pick a downloadable jar for a Minecraft version.
 * First asks Modrinth to filter by game version and server loaders; when that
 * yields nothing (a very new game version the plugin has not declared yet),
 * falls back to the newest release and reports `compatible: false`.
 *
 * @returns {Promise<{slug: string, title: string, filename: string, url: string, versionNumber: string, gameVersions: string[], compatible: boolean}>}
 */
export async function resolveModrinthJar(slug, { gameVersion } = {}) {
  const key = checkSlug(slug)
  const project = await modrinthProject(key)
  const filtered = await tryFiltered(key, gameVersion)
  const list = filtered.length > 0 ? filtered : await modrinthVersions(key)
  ensure(list.length > 0, 'NOT_FOUND', `Modrinth 项目 ${key} 没有可下载的版本`)
  const chosen = pickVersion(list, gameVersion)
  ensure(chosen !== null, 'NOT_FOUND', `Modrinth 项目 ${key} 没有包含 jar 文件的版本`)
  const file = pickFile(chosen)
  ensure(file !== null, 'NOT_FOUND', `Modrinth 项目 ${key} 的最新版本没有 jar 文件`)
  return {
    slug: key,
    title: typeof project.title === 'string' ? project.title : key,
    filename: file.filename,
    url: file.url,
    versionNumber: String(chosen.version_number ?? ''),
    gameVersions: Array.isArray(chosen.game_versions) ? chosen.game_versions : [],
    compatible: gameVersion === undefined ? true : (Array.isArray(chosen.game_versions) ? chosen.game_versions : []).includes(gameVersion),
  }
}

async function tryFiltered(slug, gameVersion) {
  if (gameVersion === undefined || gameVersion === '') return []
  try {
    const query = new URLSearchParams({
      game_versions: JSON.stringify([gameVersion]),
      loaders: JSON.stringify(LOADERS),
    })
    const list = await fetchJson(`${MODRINTH_BASE}/project/${slug}/version?${query.toString()}`, { timeoutMs: 45000 })
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function pickVersion(list, gameVersion) {
  const usable = list.filter((version) => Array.isArray(version.files) && pickFile(version) !== null)
  if (usable.length === 0) return null
  if (gameVersion !== undefined && gameVersion !== '') {
    const exact = usable.find((version) => Array.isArray(version.game_versions) && version.game_versions.includes(gameVersion))
    if (exact !== undefined) return exact
  }
  const release = usable.find((version) => version.version_type === 'release')
  return release ?? usable[0]
}

function pickFile(version) {
  const files = Array.isArray(version.files) ? version.files : []
  const jar = files.filter((file) => typeof file.filename === 'string' && file.filename.toLowerCase().endsWith('.jar'))
  if (jar.length === 0) return null
  return jar.find((file) => file.primary === true) ?? jar[0]
}

/** Newest game versions EssentialsX declares support for (used to pick a default Paper version). */
export async function newestCompatibleGameVersions() {
  const list = await modrinthVersions('essentialsx')
  const versions = new Set()
  for (const release of list) {
    if (!Array.isArray(release.game_versions)) continue
    for (const version of release.game_versions) versions.add(version)
  }
  return versions
}
