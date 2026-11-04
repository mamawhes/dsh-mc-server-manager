import { chmodSync, readFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pluginDir = join(here, '..', '..')
const fakeJava = join(here, 'fake-java')
const workDir = process.env.MCM_TEST_DIR ?? '/tmp/mcm-test'
chmodSync(fakeJava, 0o755)

const ROOT = join(workDir, 'data')
const STATE = join(workDir, 'fake-state')
await rm(ROOT, { recursive: true, force: true })
await rm(STATE, { recursive: true, force: true })
await mkdir(STATE, { recursive: true })
process.env.MC_FAKE_STATE = STATE

const { requiredJavaFor } = await import(pathToFileURL(join(pluginDir, 'lib', 'java.js')).href)
const { Manager } = await import(pathToFileURL(join(pluginDir, 'lib', 'manager.js')).href)
const { createApiHandler } = await import(pathToFileURL(join(pluginDir, 'lib', 'api.js')).href)
const { createTools } = await import(pathToFileURL(join(pluginDir, 'lib', 'tools.js')).href)

const log = (level, message) => console.log(`[${level}] ${message}`)
const manager = new Manager({
  root: ROOT,
  config: {
    javaCommand: fakeJava,
    javaArgs: [],
    defaultMemoryMb: 1024,
    fallbackVersions: ['26.1.2'],
  },
  logger: log,
})
await manager.init()

let failures = 0
const check = (label, condition, detail) => {
  if (condition) console.log(`PASS ${label}`)
  else { failures += 1; console.error(`FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`) }
}

// ── versions / meta ────────────────────────────────────────────────────────
const versions = await manager.versions()
check('versions.offline=false', versions.offline === false, versions)
check('versions.recommended=26.1.2', versions.recommended === '26.1.2', versions.recommended)
const meta = await manager.meta()
check('meta.gamerules', Array.isArray(meta.gamerules) && meta.gamerules.length > 10)
check('meta.java.ok', meta.java.ok === true, meta.java)

// ── create server (real Paper + default plugins) ───────────────────────────
console.log('creating server (downloads paper + LuckPerms + EssentialsX)…')
const created = await manager.createServer({ name: '生存服', version: '26.1.2', memoryMb: 1024, acceptEula: true, installDefaults: true })
const id = created.server.id
check('create server id', typeof id === 'string' && id.length > 0, created)
check('create paper build', Number(created.paper.build) > 0, created.paper)
check('create warnings (may be empty)', Array.isArray(created.warnings), created.warnings)
console.log('warnings:', created.warnings)

const detail = await manager.server(id)
check('server detail properties', detail.properties.motd !== undefined, detail.properties)
check('EULA accepted', detail.eulaAccepted === true)
const pluginNames = detail.plugins.map((p) => p.name)
console.log('plugins:', detail.plugins.map((p) => `${p.name}@${p.version} [${p.file}]`))
check('LuckPerms installed', pluginNames.some((name) => /luckperms/i.test(name)), pluginNames)
check('EssentialsX installed', detail.plugins.some((p) => /essentials/i.test(p.name) || /essentials/i.test(p.file)), pluginNames)

// ── fake world + level.dat (NBT) ───────────────────────────────────────────
function nbtString(name, value) {
  const nameBuf = Buffer.from(name, 'utf8')
  const valueBuf = Buffer.from(value, 'utf8')
  const head = Buffer.alloc(3)
  head.writeUInt8(8, 0)
  head.writeUInt16BE(nameBuf.length, 1)
  const between = Buffer.alloc(2)
  between.writeUInt16BE(valueBuf.length, 0)
  return Buffer.concat([head, nameBuf, between, valueBuf])
}
function nbtCompound(name, children) {
  const nameBuf = Buffer.from(name, 'utf8')
  const head = Buffer.alloc(3)
  head.writeUInt8(10, 0)
  head.writeUInt16BE(nameBuf.length, 1)
  return Buffer.concat([head, nameBuf, ...children, Buffer.from([0])])
}
function nbtRoot(children) {
  return nbtCompound('', children)
}
const levelData = nbtRoot([
  nbtCompound('Data', [
    nbtString('LevelName', 'world'),
    nbtCompound('GameRules', [
      nbtString('keepInventory', 'true'),
      nbtString('randomTickSpeed', '3'),
      nbtString('doDaylightCycle', 'false'),
    ]),
    nbtCompound('Version', [nbtString('Name', '26.1.2')]),
  ]),
])
const serverDir = manager.store.get(id).dir
await mkdir(join(serverDir, 'world'), { recursive: true })
await writeFile(join(serverDir, 'world', 'level.dat'), gzipSync(levelData))
await mkdir(join(serverDir, 'world_nether'), { recursive: true })
await writeFile(join(serverDir, 'world_nether', 'level.dat'), gzipSync(nbtRoot([nbtCompound('Data', [nbtString('LevelName', 'world_nether')])])))

const worlds = await manager.worlds(id)
check('worlds listed', worlds.worlds.some((w) => w.name === 'world'), worlds.worlds)
const stoppedRules = await manager.gamerules(id, { rules: 'keepInventory,randomTickSpeed,doDaylightCycle' })
check('gamerules from level.dat', stoppedRules.source === 'level.dat' && stoppedRules.values.keepInventory === true && stoppedRules.values.randomTickSpeed === 3, stoppedRules)

// ── properties ─────────────────────────────────────────────────────────────
const propResult = await manager.setProperties(id, { motd: '测试服务器', 'max-players': 8, 'view-distance': 6 })
check('properties written', propResult.properties.motd === '测试服务器' && propResult.properties['max-players'] === '8', propResult.properties)
let propError = null
try { await manager.setProperties(id, { 'max-players': 'abc' }) } catch (error) { propError = error }
check('invalid int rejected', propError?.code === 'INVALID_INPUT', propError?.message)

// ── plugins toggle/remove ─────────────────────────────────────────────────
const luck = detail.plugins.find((p) => /luckperms/i.test(p.name))
await manager.togglePlugin(id, { file: luck.file, enabled: false })
let afterToggle = (await manager.plugins(id)).plugins.find((p) => p.file.startsWith(luck.base))
check('plugin disabled', afterToggle.enabled === false && afterToggle.file.endsWith('.disabled'), afterToggle)
await manager.togglePlugin(id, { file: afterToggle.file, enabled: true })
afterToggle = (await manager.plugins(id)).plugins.find((p) => p.file === luck.file)
check('plugin enabled again', afterToggle.enabled === true, afterToggle)

// ── java environment ──────────────────────────────────────────────────────
check('requiredJava(26.1.2)=25', requiredJavaFor('26.1.2').major === 25)
check('requiredJava(1.21.11)=21', requiredJavaFor('1.21.11').major === 21)
check('requiredJava(1.19.4)=17', requiredJavaFor('1.19.4').major === 17)
check('requiredJava(1.16.5)=16', requiredJavaFor('1.16.5').major === 16)
check('requiredJava(1.12.2)=11', requiredJavaFor('1.12.2').major === 11)
check('requiredJava(1.8.8)=8', requiredJavaFor('1.8.8').major === 8)
const javaInfo = await manager.javaInfo()
check('java runtime discovered', javaInfo.runtimes.some((runtime) => runtime.path === fakeJava && runtime.major === 25), javaInfo.runtimes)
check('java default empty', javaInfo.defaultPath === null, javaInfo.defaultPath)
if (process.env.MCM_TEST_JAVA_INSTALL === '1') {
  console.log('installing JDK 25 through the manager (Corretto CDN)…')
  const installed = await manager.installJavaVersion(25)
  check('java install major=25', installed.installed.major === 25, installed)
  check('java install default set', manager.settings.defaultJavaPath === installed.installed.path, manager.settings.defaultJavaPath)
  const installedProbe = await manager.javaInfo()
  check('installed java discovered', installedProbe.runtimes.some((runtime) => runtime.path === installed.installed.path && runtime.managed), installedProbe.runtimes)
}

const fakeJava21 = join(workDir, 'fake-java21')
await writeFile(fakeJava21, readFileSync(fakeJava, 'utf8').replace('25.0.5', '21.0.9').replace('build 25.0.5+8', 'build 21.0.9+10'))
chmodSync(fakeJava21, 0o755)
await manager.setServerJava(id, fakeJava21)
let lowJavaError = null
try { await manager.startServer(id) } catch (error) { lowJavaError = error }
check('start rejects too-low Java', lowJavaError?.code === 'JAVA_VERSION', lowJavaError?.message)
check('server java pinned', manager.store.get(id).javaMajor === 21, manager.store.get(id).javaPath)
await manager.setServerJava(id, fakeJava)
check('server java re-pinned', manager.store.get(id).javaMajor === 25, manager.store.get(id).javaPath)

// ── start/stop with fake java ─────────────────────────────────────────────
await manager.startServer(id)
const running = await (async () => {
  for (let i = 0; i < 50; i += 1) {
    const status = manager.status(id).status
    if (status.state === 'running') return status
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return manager.status(id).status
})()
check('server running after Done line', running.state === 'running', running)
check('pid present', Number(running.pid) > 0, running)

const players = await manager.players(id)
check('players parsed', players.online === 1 && players.max === 20 && players.names.includes('Steve'), players)

const liveRules = await manager.gamerules(id, { rules: 'keepInventory,randomTickSpeed' })
check('gamerules via console', liveRules.source === 'console' && liveRules.values.randomTickSpeed === 3, liveRules)

const setRule = await manager.setGamerule(id, { rule: 'randomTickSpeed', value: 7 })
check('gamerule set + read back', Number(setRule.value) === 7, setRule)

const cmd = await manager.command(id, 'list')
check('console command captured', (cmd.output ?? []).some((line) => line.includes('players online')), cmd)

// ── backup while running ──────────────────────────────────────────────────
const backup = await manager.backupWorld(id, { world: 'world' })
check('backup created', typeof backup.backup.name === 'string' && backup.backup.size > 0, backup)
check('backup includes nether', backup.backup.dirs.includes('world_nether'), backup.backup.dirs)
const backups = await manager.worlds(id)
check('backup listed', backups.backups.some((b) => b.name === backup.backup.name), backups.backups)

// ── stop + restore + delete backup ────────────────────────────────────────
await manager.stopServer(id)
check('server stopped', manager.status(id).status.state === 'stopped', manager.status(id).status)

const restore = await manager.restoreBackup(id, { backup: backup.backup.name })
check('restore succeeded', restore.restored.includes('world'), restore)
await manager.deleteBackup(id, { backup: backup.backup.name })
check('backup deleted', (await manager.worlds(id)).backups.length === 0)

// ── tools ─────────────────────────────────────────────────────────────────
const tools = createTools(manager)
check('tool count', tools.length >= 15, tools.length)
const listTool = tools.find((tool) => tool.name === 'mc_list_servers')
const listValue = await listTool.execute({})
check('tool list servers', listValue.servers.some((server) => server.id === id), listValue)
const rendered = listTool.output.render({}, listValue)
check('tool render text', Array.isArray(rendered) && rendered[0].type === 'text' && rendered[0].text.includes('生存服'), rendered)
const propsTool = tools.find((tool) => tool.name === 'mc_get_properties')
const propsValue = await propsTool.execute({ server: id })
check('tool properties', propsValue.properties.motd === '测试服务器', propsValue.properties)

// ── HTTP API ──────────────────────────────────────────────────────────────
const handler = createApiHandler(manager, log)
const httpServer = createServer((request, response) => { handler(request, response) })
await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
const port = httpServer.address().port
const base = `http://127.0.0.1:${port}/mc/api`

const apiGet = async (path, init) => {
  const response = await fetch(base + path, init)
  const body = await response.json()
  return { status: response.status, body }
}

check('api meta', (await apiGet('/meta')).body.root === ROOT, await apiGet('/meta'))
check('api servers', (await apiGet('/servers')).body.servers.length === 1)
check('api detail', (await apiGet(`/servers/${id}`)).body.properties.motd === '测试服务器')
const putProps = await apiGet(`/servers/${id}/properties`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ properties: { 'max-players': 12 } }) })
check('api put properties', putProps.status === 200 && putProps.body.properties['max-players'] === '12', putProps.body)
const startRes = await apiGet(`/servers/${id}/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
check('api start', startRes.status === 200 && startRes.body.status.state !== 'stopped', startRes.body)
for (let i = 0; i < 50; i += 1) {
  if ((await apiGet(`/servers/${id}/status`)).body.status.state === 'running') break
  await new Promise((resolve) => setTimeout(resolve, 100))
}
// manager.startServer was run again by the API but the runtime returns early if already running
const consoleRes = await apiGet(`/servers/${id}/console?cursor=0`)
check('api console', Array.isArray(consoleRes.body.lines) && consoleRes.body.lines.length > 0, { lines: consoleRes.body.lines?.length })
const playersRes = await apiGet(`/servers/${id}/players`)
check('api players', playersRes.body.online === 1, playersRes.body)
const grRes = await apiGet(`/servers/${id}/gamerules?rules=keepInventory,randomTickSpeed`)
check('api gamerules', grRes.body.values.keepInventory === true, grRes.body)
const grSet = await apiGet(`/servers/${id}/gamerules`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rule: 'keepInventory', value: false }) })
check('api set gamerule', grSet.body.value === false, grSet.body)
const stopRes = await apiGet(`/servers/${id}/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
check('api stop', stopRes.status === 200 && stopRes.body.status.state === 'stopped', stopRes.body)

const evil = await fetch(base + '/servers', { headers: { origin: 'https://evil.example' } })
check('api rejects cross-origin', evil.status === 403, evil.status)
const missing = await apiGet('/servers/does-not-exist')
check('api 404 unknown server', missing.status === 404 && missing.body.error.code === 'NOT_FOUND', missing)

const delRes = await apiGet(`/servers/${id}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmName: '生存服' }) })
check('api delete server', delRes.status === 200, delRes.body)
check('server removed', (await manager.listServers()).length === 0)

await new Promise((resolve) => httpServer.close(resolve))
await manager.dispose()
console.log(failures === 0 ? 'HOST TEST OK' : `HOST TEST FAILED (${failures})`)
process.exit(failures === 0 ? 0 : 1)
