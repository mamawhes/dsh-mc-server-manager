/**
 * server.properties editing and the gamerule catalog used by the panel.
 * server.properties is a flat `key=value` file; edits update matching lines in
 * place, keep unrelated lines and comments, and append unknown new keys.
 */
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { ensure, ManagerError, writeTextAtomic } from './util.js'

/** Common server.properties fields the panel groups and labels. */
export const PROPERTY_FIELDS = [
  { key: 'motd', label: '服务器标语 (MOTD)', type: 'string' },
  { key: 'server-port', label: '端口', type: 'int' },
  { key: 'max-players', label: '最大玩家数', type: 'int' },
  { key: 'online-mode', label: '正版验证', type: 'bool' },
  { key: 'white-list', label: '白名单', type: 'bool' },
  { key: 'enforce-whitelist', label: '强制白名单', type: 'bool' },
  { key: 'difficulty', label: '难度', type: 'enum', options: ['peaceful', 'easy', 'normal', 'hard'] },
  { key: 'gamemode', label: '默认游戏模式', type: 'enum', options: ['survival', 'creative', 'adventure', 'spectator'] },
  { key: 'force-gamemode', label: '强制游戏模式', type: 'bool' },
  { key: 'pvp', label: '允许 PvP', type: 'bool' },
  { key: 'hardcore', label: '极限模式', type: 'bool' },
  { key: 'level-name', label: '世界名', type: 'string' },
  { key: 'level-seed', label: '世界种子', type: 'string' },
  { key: 'level-type', label: '世界类型', type: 'string' },
  { key: 'view-distance', label: '视距', type: 'int' },
  { key: 'simulation-distance', label: '模拟距离', type: 'int' },
  { key: 'spawn-protection', label: '出生点保护半径', type: 'int' },
  { key: 'allow-flight', label: '允许飞行', type: 'bool' },
  { key: 'allow-nether', label: '允许下界', type: 'bool' },
  { key: 'enable-command-block', label: '启用命令方块', type: 'bool' },
  { key: 'spawn-monsters', label: '生成怪物', type: 'bool' },
  { key: 'generate-structures', label: '生成结构', type: 'bool' },
  { key: 'enable-status', label: '服务器列表状态', type: 'bool' },
  { key: 'hide-online-players', label: '隐藏在线玩家', type: 'bool' },
  { key: 'network-compression-threshold', label: '网络压缩阈值', type: 'int' },
  { key: 'player-idle-timeout', label: '挂机踢出（分钟）', type: 'int' },
  { key: 'op-permission-level', label: 'OP 权限等级', type: 'int' },
  { key: 'function-permission-level', label: '函数权限等级', type: 'int' },
  { key: 'max-tick-time', label: '最大 tick 时间（毫秒）', type: 'int' },
  { key: 'rate-limit', label: '限速', type: 'int' },
  { key: 'entity-broadcast-range-percentage', label: '实体广播距离（%）', type: 'int' },
  { key: 'resource-pack', label: '资源包 URL', type: 'string' },
  { key: 'resource-pack-sha1', label: '资源包 SHA1', type: 'string' },
  { key: 'require-resource-pack', label: '强制资源包', type: 'bool' },
  { key: 'prevent-proxy-connections', label: '阻止代理连接', type: 'bool' },
  { key: 'broadcast-console-to-ops', label: '向 OP 广播控制台', type: 'bool' },
  { key: 'broadcast-rcon-to-ops', label: '向 OP 广播 RCON', type: 'bool' },
  { key: 'enable-rcon', label: '启用 RCON', type: 'bool' },
  { key: 'rcon.port', label: 'RCON 端口', type: 'int' },
  { key: 'enable-query', label: '启用 Query', type: 'bool' },
  { key: 'query.port', label: 'Query 端口', type: 'int' },
  { key: 'debug', label: '调试日志', type: 'bool' },
]

const FIELD_BY_KEY = new Map(PROPERTY_FIELDS.map((field) => [field.key, field]))

/** Defaults written for a new server. */
const SERVER_DEFAULTS = {
  'motd': 'A Minecraft Server managed by DSH',
  'server-port': '25565',
  'max-players': '20',
  'online-mode': 'true',
  'white-list': 'false',
  'enforce-whitelist': 'false',
  'difficulty': 'normal',
  'gamemode': 'survival',
  'force-gamemode': 'false',
  'pvp': 'true',
  'hardcore': 'false',
  'level-name': 'world',
  'level-seed': '',
  'level-type': 'minecraft\\:normal',
  'view-distance': '10',
  'simulation-distance': '10',
  'spawn-protection': '16',
  'allow-flight': 'false',
  'allow-nether': 'true',
  'enable-command-block': 'false',
  'spawn-monsters': 'true',
  'generate-structures': 'true',
  'enable-status': 'true',
  'hide-online-players': 'false',
  'network-compression-threshold': '256',
  'player-idle-timeout': '0',
  'op-permission-level': '4',
  'function-permission-level': '2',
  'max-tick-time': '60000',
  'rate-limit': '0',
  'entity-broadcast-range-percentage': '100',
  'prevent-proxy-connections': 'false',
  'broadcast-console-to-ops': 'true',
  'broadcast-rcon-to-ops': 'true',
  'enable-rcon': 'false',
  'enable-query': 'false',
  'debug': 'false',
}

/** Parse a properties file into a plain object (last occurrence wins). */
export function parseProperties(text) {
  const result = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue
    const index = line.indexOf('=')
    if (index <= 0) continue
    result[line.slice(0, index).trim()] = line.slice(index + 1)
  }
  return result
}

/** Coerce one value according to its field type, throwing on invalid input. */
function coerce(key, value) {
  const field = FIELD_BY_KEY.get(key)
  if (field === undefined) return String(value)
  if (field.type === 'bool') {
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    const text = String(value).trim().toLowerCase()
    ensure(text === 'true' || text === 'false', 'INVALID_INPUT', `${key} 必须是 true 或 false`)
    return text
  }
  if (field.type === 'int') {
    const number = Number(String(value).trim())
    ensure(Number.isInteger(number), 'INVALID_INPUT', `${key} 必须是整数`)
    return String(number)
  }
  if (field.type === 'enum') {
    const text = String(value).trim()
    ensure(field.options.includes(text), 'INVALID_INPUT', `${key} 必须是 ${field.options.join(' / ')} 之一`)
    return text
  }
  return String(value)
}

/** Apply a patch to the properties text, preserving untouched lines. */
export function applyPropertyPatch(text, patch) {
  const updates = new Map()
  for (const [key, value] of Object.entries(patch)) {
    ensure(/^[A-Za-z0-9._-]+$/.test(key), 'INVALID_INPUT', `属性名不合法：${key}`)
    updates.set(key, coerce(key, value))
  }
  const lines = text.split(/\r?\n/)
  const seen = new Set()
  const output = lines.map((line) => {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('!')) return line
    const index = trimmed.indexOf('=')
    if (index <= 0) return line
    const key = trimmed.slice(0, index).trim()
    if (!updates.has(key)) return line
    seen.add(key)
    return `${key}=${updates.get(key)}`
  })
  for (const [key, value] of updates) if (!seen.has(key)) output.push(`${key}=${value}`)
  while (output.length > 0 && output[output.length - 1] === '') output.pop()
  return `${output.join('\n')}\n`
}

/** Read a server's properties as an object; missing file yields {} (not an error). */
export async function readProperties(serverDir) {
  const file = join(serverDir, 'server.properties')
  try {
    const text = await readFile(file, 'utf8')
    return { file, text, properties: parseProperties(text) }
  } catch (error) {
    if (error.code === 'ENOENT') return { file, text: '', properties: {} }
    throw error
  }
}

/** Ensure a new server starts from sane defaults. */
export async function writeDefaultProperties(serverDir, { motd, levelName = 'world' } = {}) {
  const file = join(serverDir, 'server.properties')
  let exists = true
  try {
    await stat(file)
  } catch {
    exists = false
  }
  if (exists) return readProperties(serverDir)
  const defaults = { ...SERVER_DEFAULTS, 'level-name': levelName }
  if (typeof motd === 'string' && motd.trim() !== '') defaults.motd = motd.trim()
  const text = Object.entries(defaults).map(([key, value]) => `${key}=${value}`).join('\n')
  await writeTextAtomic(file, `${text}\n`)
  return readProperties(serverDir)
}

/** Update server.properties; returns the new properties. */
export async function updateProperties(serverDir, patch) {
  ensure(patch !== null && typeof patch === 'object' && !Array.isArray(patch), 'INVALID_INPUT', 'properties 必须是对象')
  const { file, text } = await readProperties(serverDir)
  const next = applyPropertyPatch(text, patch)
  await writeTextAtomic(file, next)
  return { properties: parseProperties(next), fieldKeys: Object.keys(patch) }
}

/** Common gamerules with labels, used by the panel's gamerule tab. */
export const GAMERULE_CATALOG = [
  { key: 'doDaylightCycle', label: '昼夜循环', type: 'bool' },
  { key: 'doWeatherCycle', label: '天气循环', type: 'bool' },
  { key: 'doMobSpawning', label: '生成生物', type: 'bool' },
  { key: 'doMobLoot', label: '生物掉落物', type: 'bool' },
  { key: 'doTileDrops', label: '方块掉落物', type: 'bool' },
  { key: 'doEntityDrops', label: '实体掉落物', type: 'bool' },
  { key: 'keepInventory', label: '死亡保留物品', type: 'bool' },
  { key: 'mobGriefing', label: '生物破坏方块', type: 'bool' },
  { key: 'naturalRegeneration', label: '自然回血', type: 'bool' },
  { key: 'randomTickSpeed', label: '随机刻速度', type: 'int' },
  { key: 'sendCommandFeedback', label: '命令反馈', type: 'bool' },
  { key: 'showDeathMessages', label: '死亡消息', type: 'bool' },
  { key: 'doFireTick', label: '火焰蔓延', type: 'bool' },
  { key: 'doImmediateRespawn', label: '立即重生', type: 'bool' },
  { key: 'fallDamage', label: '摔落伤害', type: 'bool' },
  { key: 'fireDamage', label: '火焰伤害', type: 'bool' },
  { key: 'drowningDamage', label: '溺水伤害', type: 'bool' },
  { key: 'freezeDamage', label: '冰冻伤害', type: 'bool' },
  { key: 'commandBlockOutput', label: '命令方块输出', type: 'bool' },
  { key: 'logAdminCommands', label: '记录管理员命令', type: 'bool' },
  { key: 'maxCommandChainLength', label: '最大命令链长度', type: 'int' },
  { key: 'maxEntityCramming', label: '最大实体挤压数', type: 'int' },
  { key: 'playersSleepingPercentage', label: '入睡玩家百分比', type: 'int' },
  { key: 'spawnRadius', label: '出生点半径', type: 'int' },
  { key: 'spectatorsGenerateChunks', label: '旁观者加载区块', type: 'bool' },
  { key: 'announceAdvancements', label: '播报进度', type: 'bool' },
  { key: 'disableElytraMovementCheck', label: '禁用鞘翅移动检查', type: 'bool' },
  { key: 'doLimitedCrafting', label: '限制合成配方', type: 'bool' },
  { key: 'doPatrolSpawning', label: '灾厄巡逻队生成', type: 'bool' },
  { key: 'doTraderSpawning', label: '流浪商人生成', type: 'bool' },
  { key: 'doInsomnia', label: '幻翼生成', type: 'bool' },
  { key: 'doVinesSpread', label: '藤蔓蔓延', type: 'bool' },
  { key: 'forgiveDeadPlayers', label: '原谅死亡玩家', type: 'bool' },
  { key: 'universalAnger', label: '全体激怒', type: 'bool' },
  { key: 'reducedDebugInfo', label: '精简调试信息', type: 'bool' },
  { key: 'disableRaids', label: '禁用袭击', type: 'bool' },
  { key: 'doWardenSpawning', label: '监守者生成', type: 'bool' },
  { key: 'blockExplosionDropDecay', label: '方块爆炸掉落衰减', type: 'bool' },
  { key: 'mobExplosionDropDecay', label: '生物爆炸掉落衰减', type: 'bool' },
  { key: 'tntExplosionDropDecay', label: 'TNT 爆炸掉落衰减', type: 'bool' },
  { key: 'snowAccumulationHeight', label: '积雪高度', type: 'int' },
  { key: 'waterSourceConversion', label: '水源转换', type: 'bool' },
  { key: 'lavaSourceConversion', label: '岩浆源转换', type: 'bool' },
  { key: 'globalSoundEvents', label: '全局声音事件', type: 'bool' },
]

/** Coerce a gamerule value from a JSON request to the text Minecraft expects. */
export function gameruleValue(rule, value, fieldType) {
  if (fieldType === 'bool') {
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    const text = String(value).trim().toLowerCase()
    ensure(text === 'true' || text === 'false', 'INVALID_INPUT', `${rule} 必须是 true 或 false`)
    return text
  }
  if (fieldType === 'int') {
    const number = Number(String(value).trim())
    ensure(Number.isInteger(number), 'INVALID_INPUT', `${rule} 必须是整数`)
    return String(number)
  }
  return String(value)
}

/** Parse the console reply to `gamerule <name>`; null when it is not a value line. */
export function parseGameruleReply(line, rule) {
  const text = stripLogPrefix(line)
  const patterns = [
    new RegExp(`Gamerule\\s+${escapeRegExp(rule)}\\s+is\\s+currently\\s+set\\s+to:\\s*(.+)$`, 'i'),
    new RegExp(`Gamerule\\s+${escapeRegExp(rule)}\\s+is\\s+currently\\s+set\\s+to\\s+(.+)$`, 'i'),
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (match !== null) {
      const value = match[1].trim()
      if (value === 'true' || value === 'false') return value === 'true'
      if (/^-?\d+$/.test(value)) return Number(value)
      return value
    }
  }
  return null
}

/** Drop the `[12:34:56 INFO]:` prefix Paper puts in front of console output. */
export function stripLogPrefix(line) {
  return String(line).replace(/^\[\d{2}:\d{2}:\d{2}\s+[A-Z]+\]:\s?/, '').trim()
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Known gamerules by key. */
export const GAMERULE_BY_KEY = new Map(GAMERULE_CATALOG.map((entry) => [entry.key, entry]))

/** Ensure a rule name is one of the known gamerules or a simple identifier. */
export function checkGameruleName(name) {
  const text = String(name ?? '').trim().replace(/^minecraft:/, '')
  ensure(/^[A-Za-z][A-Za-z0-9]*$/.test(text), 'INVALID_INPUT', 'gamerule 名称不合法')
  return text
}

/** Error helper for a property key that is not in the catalog (still allowed). */
export function propertyLabel(key) {
  return FIELD_BY_KEY.get(key)?.label ?? key
}

export { ManagerError }
