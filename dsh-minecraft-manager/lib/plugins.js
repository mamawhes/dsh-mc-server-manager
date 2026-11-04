/**
 * Plugin directory management: list jars (reading plugin.yml from the jar so
 * the UI shows the real plugin name), install from a URL, enable, disable and
 * remove. Paper simply ignores jars whose name does not end in `.jar`, so a
 * disabled plugin is renamed to `<name>.jar.disabled`.
 */
import { readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { downloadToFile, ensure, ensureDir, ManagerError, readJson, removeQuietly, sizeOf, writeJsonAtomic } from './util.js'

const META_FILE = '.dsh-manager.json'

/** Read a small text entry out of a zip/jar without external tools. */
export function readZipEntry(buffer, wantedName) {
  const end = findEndOfCentralDirectory(buffer)
  if (end < 0) return null
  const entryCount = buffer.readUInt16LE(end + 10)
  const centralOffset = buffer.readUInt32LE(end + 16)
  let offset = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length) return null
    if (buffer.readUInt32LE(offset) !== 0x02014b50) return null
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    if (name.toLowerCase() === wantedName.toLowerCase()) {
      return extractEntry(buffer, localOffset, method, compressedSize)
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  return null
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 65557)
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset
  }
  return -1
}

function extractEntry(buffer, localOffset, method, expectedSize) {
  if (buffer.readUInt32LE(localOffset) !== 0x04034b50) return null
  const nameLength = buffer.readUInt16LE(localOffset + 26)
  const extraLength = buffer.readUInt16LE(localOffset + 28)
  const start = localOffset + 30 + nameLength + extraLength
  const data = buffer.subarray(start, start + (expectedSize > 0 ? expectedSize : undefined))
  if (method === 0) return data
  if (method === 8) return inflateRawSync(data)
  return null
}

/** Parse the handful of top-level scalars we need from a Bukkit plugin.yml. */
function parseSimpleYaml(text) {
  const result = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line)
    if (match === null) continue
    let value = match[2].trim()
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1).replace(/\\"/g, '"')
    else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) value = value.slice(1, -1).replace(/''/g, "'")
    result[match[1]] = value
  }
  return result
}

/** Read name/version/main/api-version from a jar, or nulls when unavailable. */
export async function readPluginMeta(file) {
  let buffer
  try {
    const { readFile } = await import('node:fs/promises')
    buffer = await readFile(file)
  } catch {
    return {}
  }
  let text = readZipEntry(buffer, 'plugin.yml')
  if (text === null) text = readZipEntry(buffer, 'paper-plugin.yml')
  if (text === null) return {}
  const parsed = parseSimpleYaml(text.toString('utf8'))
  return {
    name: parsed.name,
    version: parsed.version,
    main: parsed.main,
    apiVersion: parsed['api-version'],
    description: parsed.description,
  }
}

function isJar(file) {
  return file.toLowerCase().endsWith('.jar')
}

function isDisabled(file) {
  return file.toLowerCase().endsWith('.jar.disabled')
}

function baseNameOf(file) {
  return isDisabled(file) ? file.slice(0, -'.disabled'.length) : file
}

/** Read the slug bookkeeping file that maps installed jars to Modrinth slugs. */
async function readMeta(dir) {
  const meta = await readJson(join(dir, META_FILE), {})
  return meta !== null && typeof meta === 'object' ? meta : {}
}

async function writeMeta(dir, meta) {
  await writeJsonAtomic(join(dir, META_FILE), meta)
}

/** List every plugin jar in a server's plugins directory. */
export async function listPlugins(pluginsDir) {
  await ensureDir(pluginsDir)
  const entries = await readdir(pluginsDir, { withFileTypes: true }).catch(() => [])
  const meta = await readMeta(pluginsDir)
  const plugins = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const file = entry.name
    if (!isJar(file) && !isDisabled(file)) continue
    const enabled = isJar(file)
    const path = join(pluginsDir, file)
    const info = await readPluginMeta(path)
    const slug = meta[baseNameOf(file)]?.slug
    plugins.push({
      file,
      base: baseNameOf(file),
      enabled,
      size: await sizeOf(path),
      name: info.name ?? baseNameOf(file).replace(/\.jar$/i, ''),
      version: info.version ?? '',
      apiVersion: info.apiVersion ?? '',
      ...(typeof slug === 'string' && slug !== '' ? { slug } : {}),
    })
  }
  plugins.sort((left, right) => left.name.localeCompare(right.name))
  return plugins
}

/** Whether a plugin with this Bukkit name (or slug record) is already installed. */
export async function hasPlugin(pluginsDir, { name, slug }) {
  const plugins = await listPlugins(pluginsDir)
  return plugins.some((plugin) => {
    if (slug !== undefined && plugin.slug === slug) return true
    if (name === undefined) return false
    const normalized = String(name).toLowerCase().replace(/[^a-z0-9]/g, '')
    const pluginName = String(plugin.name).toLowerCase().replace(/[^a-z0-9]/g, '')
    const base = plugin.base.toLowerCase().replace(/[^a-z0-9]/g, '')
    return pluginName === normalized || base.startsWith(normalized)
  })
}

/** Build a free target filename inside plugins/ (never overwrite an existing jar). */
async function freeFilename(pluginsDir, filename) {
  const clean = basename(filename).replace(/[^A-Za-z0-9._ -]/g, '_')
  ensure(clean.toLowerCase().endsWith('.jar'), 'INVALID_INPUT', '插件文件必须是 .jar')
  const exists = async (name) => (await sizeOf(join(pluginsDir, name))) > 0
  if (!(await exists(clean))) return clean
  const stem = clean.slice(0, -4)
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${stem}-${index}.jar`
    if (!(await exists(candidate))) return candidate
  }
  throw new ManagerError('CONFLICT', '插件目录中同名文件过多')
}

/**
 * Download a jar into the plugins directory.
 * @returns {Promise<{file: string, slug?: string, name: string, version: string}>}
 */
export async function installPluginJar(pluginsDir, { url, filename, slug, name, version, signal }) {
  ensure(typeof url === 'string' && /^https?:\/\//i.test(url), 'INVALID_INPUT', '插件下载地址必须是 http(s) URL')
  await ensureDir(pluginsDir)
  const targetName = await freeFilename(pluginsDir, filename ?? urlFilename(url) ?? 'plugin.jar')
  const target = join(pluginsDir, targetName)
  await downloadToFile(url, target, { signal, maxBytes: 150 * 1024 * 1024 })
  const meta = await readMeta(pluginsDir)
  if (slug !== undefined) meta[targetName] = { slug, name, version, url, installedAt: new Date().toISOString() }
  else meta[targetName] = { name, version, url, installedAt: new Date().toISOString() }
  await writeMeta(pluginsDir, meta)
  const info = await readPluginMeta(target)
  return { file: targetName, slug, name: info.name ?? name ?? targetName, version: info.version ?? version ?? '' }
}

function urlFilename(url) {
  try {
    const path = new URL(url).pathname
    const name = path.split('/').pop() ?? ''
    return name.toLowerCase().endsWith('.jar') ? decodeURIComponent(name) : undefined
  } catch {
    return undefined
  }
}

/** Rename `<jar>` to `<jar>.disabled`, or back. */
export async function setPluginEnabled(pluginsDir, file, enabled) {
  const name = basename(String(file))
  ensure(isJar(name) || isDisabled(name), 'INVALID_INPUT', '只接受插件 jar 文件')
  const current = join(pluginsDir, name)
  ensure((await sizeOf(current)) > 0, 'NOT_FOUND', `插件不存在：${name}`)
  if (enabled === true && isDisabled(name)) {
    const target = join(pluginsDir, baseNameOf(name))
    await renameFile(current, target)
    return { file: baseNameOf(name), enabled: true }
  }
  if (enabled === false && isJar(name)) {
    const target = join(pluginsDir, `${name}.disabled`)
    await renameFile(current, target)
    return { file: `${name}.disabled`, enabled: false }
  }
  return { file: name, enabled: isJar(name) }
}

async function renameFile(from, to) {
  const { rename } = await import('node:fs/promises')
  await rename(from, to)
}

/** Delete a plugin jar (enabled or disabled). */
export async function removePlugin(pluginsDir, file) {
  const name = basename(String(file))
  ensure(isJar(name) || isDisabled(name), 'INVALID_INPUT', '只接受插件 jar 文件')
  const path = join(pluginsDir, name)
  ensure((await sizeOf(path)) > 0, 'NOT_FOUND', `插件不存在：${name}`)
  await removeQuietly(path)
  const meta = await readMeta(pluginsDir)
  delete meta[name]
  delete meta[baseNameOf(name)]
  await writeMeta(pluginsDir, meta)
  return { file: name }
}
