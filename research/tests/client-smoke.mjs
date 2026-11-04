import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pluginDir = join(here, '..', '..', 'dsh-minecraft-manager')
const reactDir = process.env.MCM_REACT_DIR ?? '/tmp/mcm-test'
const require = createRequire(join(reactDir, 'package.json'))
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const source = readFileSync(join(pluginDir, 'lib', 'client.js'), 'utf8')
let captured = null
globalThis.window = { __ModuleLoader__: { load: (mod) => { captured = mod } } }
new Function('window', source)(globalThis.window)
if (captured === null) throw new Error('module loader did not run')
if (captured.id !== 'dsh-minecraft-manager') throw new Error(`bad id ${captured.id}`)

const reqMock = (id) => {
  if (id === 'react') return React
  throw new Error(`unexpected require(${id})`)
}
const exports = captured.factory(reqMock)
console.log('exports:', Object.keys(exports).join(', '))
if (typeof exports.apply !== 'function') throw new Error('apply missing')
if (!Array.isArray(exports.inject)) throw new Error('inject missing')

// Fake slots system: inject() runs the declarer, register() records the entry.
const registrations = []
const ctx = {
  slots: {
    inject(name, declare) { declare() },
    register(options, component) { registrations.push({ options, component }); return () => {} },
  },
  get() { return undefined },
}
exports.apply(ctx)
console.log('registrations:', registrations.map((r) => `${r.options.name}:${r.options.id ?? r.options.key}`).join(', '))
if (registrations.length !== 2) throw new Error(`expected 2 slot registrations, got ${registrations.length}`)
const panel = registrations.find((r) => r.options.name === 'sidebar.panellist')
const main = registrations.find((r) => r.options.name === 'main')
if (panel.options.id !== main.options.key) throw new Error('panel id / main key mismatch')
if (panel.options.label !== 'MC 服务器') throw new Error('label mismatch')

const h = React.createElement
const render = (label, element) => {
  try {
    const html = renderToStaticMarkup(element)
    console.log(`${label}: ok (${html.length} chars)`)
    return html
  } catch (error) {
    console.error(`${label}: FAILED`)
    console.error(error)
    process.exitCode = 1
    return ''
  }
}

render('PanelIcon', h(panel.component, { size: 20 }))
const agent = { send: async () => ({ kind: 'sent' }) }
render('Panel', h(main.component, { agent }))
render('Panel(empty)', h(exports.__components.Panel, { agent }))

const server = {
  id: 'survival-abc123', name: '生存服', mcVersion: '26.1.2', memoryMb: 2048,
  createdAt: new Date().toISOString(), dir: '/Users/x/.dsh/minecraft/servers/survival-abc123',
  eulaAccepted: true, status: { state: 'running', running: true, pid: 4321, startedAt: Date.now(), uptimeMs: 65000, lastExit: null, lastError: null },
  properties: { motd: 'hi', 'max-players': '20', 'online-mode': 'true', difficulty: 'normal' },
  plugins: [{ file: 'LuckPerms-Bukkit-5.5.71.jar', base: 'LuckPerms-Bukkit-5.5.71.jar', enabled: true, size: 1024000, name: 'LuckPerms', version: '5.5.71' }],
  worlds: [{ name: 'world', size: 2048000, version: '26.1.2', lastModified: new Date().toISOString(), levelName: 'world' }],
  backups: [{ name: 'world-20261103-104715.zip', size: 1024000, createdAt: new Date().toISOString() }],
}
const meta = { gamerules: [{ key: 'keepInventory', label: '死亡保留物品', type: 'bool' }, { key: 'randomTickSpeed', label: '随机刻速度', type: 'int' }] }

render('OverviewTab', h(exports.__components.OverviewTab, { detail: server, players: { online: 1, max: 20, names: ['Steve'] }, refreshPlayers: () => {}, running: true, busy: null, deleteServer: () => {}, agent, notify: () => {} }))
render('ConsoleTab', h(exports.__components.ConsoleTab, { id: server.id, running: true, notify: () => {}, detail: server }))
render('PluginsTab', h(exports.__components.PluginsTab, { id: server.id, detail: server, running: true, notify: () => {}, reload: async () => {}, act: async () => true }))
render('WorldsTab', h(exports.__components.WorldsTab, { id: server.id, detail: server, running: true, notify: () => {}, reload: async () => {}, act: async () => true }))
render('SettingsTab', h(exports.__components.SettingsTab, { id: server.id, detail: server, running: true, notify: () => {}, reload: async () => {} }))
render('SettingsTab(stopped)', h(exports.__components.SettingsTab, { id: server.id, detail: { ...server, status: { state: 'stopped', running: false } }, running: false, notify: () => {}, reload: async () => {} }))
render('GamerulesTab', h(exports.__components.GamerulesTab, { id: server.id, detail: server, running: true, meta, notify: () => {} }))
render('GamerulesTab(stopped)', h(exports.__components.GamerulesTab, { id: server.id, detail: server, running: false, meta, notify: () => {} }))

render('JavaTab', h(exports.__components.JavaTab, { id: server.id, detail: { ...server, requiredJava: { major: 25 }, javaPath: null, javaMajor: null, javaVersion: null }, notify: () => {}, reload: async () => {} }))
render('CreateServerDialog', h(exports.__components.CreateServerDialog, { meta: { defaultMemoryMb: 2048 }, versions: { versions: ['26.1.2', '26.3'], recommended: '26.1.2', offline: false }, onClose: () => {}, onCreated: () => {}, notify: () => {} }))
render('CreateServerDialog(offline)', h(exports.__components.CreateServerDialog, { meta: null, versions: { versions: [], recommended: '26.1.2', offline: true, error: 'offline' }, onClose: () => {}, onCreated: () => {}, notify: () => {} }))
render('DeleteServerDialog', h(exports.__components.DeleteServerDialog, { server, onClose: () => {}, onDelete: async () => {} }))

console.log(process.exitCode === 1 ? 'SMOKE FAILED' : 'SMOKE OK')
