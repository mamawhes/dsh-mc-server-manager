/**
 * World (save) management: list world directories, create timestamped zip
 * backups and restore or delete them. Backups are written with the platform
 * `zip`/`unzip` tools because Node has no zip writer; both are present on
 * macOS and standard Linux images.
 */
import { spawn } from 'node:child_process'
import { readdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { ensure, ensureDir, ManagerError, readJson, removeQuietly, sizeOf, timestamp, writeJsonAtomic } from './util.js'
import { readLevelDat } from './nbt.js'

const MANIFEST = 'mc-manager-manifest.json'

/** Recursive directory size, excluding anything matched by `skip`. */
async function dirSize(dir, skip = () => false) {
  let total = 0
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (skip(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) total += await dirSize(path, skip)
    else if (entry.isFile()) total += await sizeOf(path)
  }
  return total
}

/** Run a command and capture its output; throws a {@link ManagerError} on failure. */
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString('utf8') })
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8') })
    child.on('error', (error) => {
      if (error.code === 'ENOENT') reject(new ManagerError('ZIP_MISSING', `找不到 ${command} 命令；无法创建/恢复 zip 备份`))
      else reject(error)
    })
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new ManagerError('BACKUP_FAILED', `${command} 退出码 ${code}${stderr ? `：${stderr.slice(-800)}` : ''}`))
    })
  })
}

function isDirectoryWorld(name) {
  return /^[A-Za-z0-9._-]+$/.test(name)
}

/**
 * List world directories (folders containing level.dat) and sibling dimension
 * folders such as `world_nether` / `world_the_end` that belong to a base world.
 */
export async function listWorlds(serverDir) {
  const entries = await readdir(serverDir, { withFileTypes: true }).catch(() => [])
  const worlds = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    if (entry.name === 'plugins' || entry.name === 'logs' || entry.name === 'backups' || entry.name === 'cache' || entry.name === 'libraries' || entry.name === 'versions') continue
    const dir = join(serverDir, entry.name)
    const level = await readLevelDat(dir)
    if (level === null) continue
    const info = await stat(dir).catch(() => null)
    worlds.push({
      name: entry.name,
      size: await dirSize(dir, (name) => name === 'session.lock'),
      lastModified: info?.mtime?.toISOString() ?? null,
      levelName: level.levelName ?? entry.name,
      version: level.version ?? '',
    })
  }
  worlds.sort((left, right) => left.name.localeCompare(right.name))
  return worlds
}

/** Dimension folder names that belong to a base world. */
export async function relatedWorldDirs(serverDir, base) {
  const entries = await readdir(serverDir, { withFileTypes: true }).catch(() => [])
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name === base || name.startsWith(`${base}_`))
    .filter((name) => isDirectoryWorld(name))
  ensure(names.includes(base), 'NOT_FOUND', `世界目录不存在：${base}`)
  return names
}

/** Zip the base world and its dimension folders into backups/. */
export async function createBackup(serverDir, base) {
  ensure(isDirectoryWorld(base), 'INVALID_INPUT', '世界名称不合法')
  const dirs = await relatedWorldDirs(serverDir, base)
  const backupsDir = join(serverDir, 'backups')
  await ensureDir(backupsDir)
  const name = `${base}-${timestamp()}.zip`
  const target = join(backupsDir, name)
  // zip -j stores only the basename, so the manifest must already be named
  // MC_MANIFEST inside its own staging directory.
  const manifestDir = join(backupsDir, `.manifest-${Date.now()}`)
  const manifestPath = join(manifestDir, MANIFEST)
  const manifest = {
    format: 1,
    base,
    dirs,
    createdAt: new Date().toISOString(),
  }
  await ensureDir(manifestDir)
  await writeJsonAtomic(manifestPath, manifest)
  const args = ['-r', '-q', target, ...dirs, '-x', '*/session.lock', '*session.lock']
  try {
    await run('zip', args, { cwd: serverDir })
    await run('zip', ['-j', '-q', target, manifestPath], { cwd: serverDir })
  } finally {
    await removeQuietly(manifestDir)
  }
  return { name, size: await sizeOf(target), dirs, createdAt: manifest.createdAt }
}

/** List backup zips, newest first. */
export async function listBackups(serverDir) {
  const backupsDir = join(serverDir, 'backups')
  const entries = await readdir(backupsDir, { withFileTypes: true }).catch(() => [])
  const backups = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.zip')) continue
    const path = join(backupsDir, entry.name)
    const info = await stat(path).catch(() => null)
    if (info === null) continue
    backups.push({ name: entry.name, size: info.size, createdAt: info.mtime.toISOString() })
  }
  backups.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.name.localeCompare(left.name))
  return backups
}

/**
 * Restore a backup over the current world folders. The server must be stopped.
 * The replaced folders are kept under backups/rollback-<stamp>/.
 */
export async function restoreBackup(serverDir, backupName) {
  ensure(/^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/.test(backupName), 'INVALID_INPUT', '备份文件名不合法')
  const source = join(serverDir, 'backups', backupName)
  ensure((await sizeOf(source)) > 0, 'NOT_FOUND', `备份不存在：${backupName}`)
  const stamp = timestamp()
  const temp = join(serverDir, 'backups', `.restore-${stamp}`)
  await removeQuietly(temp)
  await ensureDir(temp)
  try {
    await run('unzip', ['-o', '-q', source, '-d', temp])
    const manifest = await readJson(join(temp, MANIFEST), null)
    ensure(manifest !== null && Array.isArray(manifest.dirs) && typeof manifest.base === 'string', 'BACKUP_FAILED', '备份缺少清单文件，无法安全恢复')
    for (const name of manifest.dirs) ensure(isDirectoryWorld(name), 'BACKUP_FAILED', `备份中的目录名不合法：${name}`)
    const rollbackDir = join(serverDir, 'backups', `rollback-${stamp}`)
    const moved = []
    for (const name of manifest.dirs) {
      const current = join(serverDir, name)
      if ((await sizeOf(join(current, 'level.dat'))) > 0) {
        await ensureDir(rollbackDir)
        await rename(current, join(rollbackDir, name)).catch(async (error) => {
          if (error.code !== 'ENOENT') throw error
        })
        moved.push(name)
      }
    }
    for (const name of manifest.dirs) {
      const extracted = join(temp, name)
      ensure((await sizeOf(join(extracted, 'level.dat'))) > 0, 'BACKUP_FAILED', `备份中的世界 ${name} 不完整`)
      await rename(extracted, join(serverDir, name))
    }
    return { backup: backupName, restored: manifest.dirs, rollback: moved.length > 0 ? `backups/rollback-${stamp}` : undefined }
  } finally {
    await removeQuietly(temp)
  }
}

/** Delete a backup zip. */
export async function deleteBackup(serverDir, backupName) {
  ensure(/^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/.test(backupName), 'INVALID_INPUT', '备份文件名不合法')
  const path = join(serverDir, 'backups', backupName)
  ensure((await sizeOf(path)) > 0, 'NOT_FOUND', `备份不存在：${backupName}`)
  await removeQuietly(path)
  return { name: backupName }
}
