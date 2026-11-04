/**
 * Minimal read-only NBT parser, enough to read gamerules and identity from a
 * world's level.dat (gzip-compressed, big-endian, standard NBT tags).
 */
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'

const TAG_END = 0
const TAG_BYTE = 1
const TAG_SHORT = 2
const TAG_INT = 3
const TAG_LONG = 4
const TAG_FLOAT = 5
const TAG_DOUBLE = 6
const TAG_BYTE_ARRAY = 7
const TAG_STRING = 8
const TAG_LIST = 9
const TAG_COMPOUND = 10
const TAG_INT_ARRAY = 11
const TAG_LONG_ARRAY = 12

class Reader {
  constructor(buffer) {
    this.buffer = buffer
    this.offset = 0
  }

  need(bytes) {
    if (this.offset + bytes > this.buffer.length) throw new Error('NBT 数据不完整')
  }

  u8() {
    this.need(1)
    return this.buffer.readUInt8(this.offset++)
  }

  i8() {
    this.need(1)
    return this.buffer.readInt8(this.offset++)
  }

  i16() {
    this.need(2)
    const value = this.buffer.readInt16BE(this.offset)
    this.offset += 2
    return value
  }

  u16() {
    this.need(2)
    const value = this.buffer.readUInt16BE(this.offset)
    this.offset += 2
    return value
  }

  i32() {
    this.need(4)
    const value = this.buffer.readInt32BE(this.offset)
    this.offset += 4
    return value
  }

  i64() {
    this.need(8)
    const value = this.buffer.readBigInt64BE(this.offset)
    this.offset += 8
    return value
  }

  f32() {
    this.need(4)
    const value = this.buffer.readFloatBE(this.offset)
    this.offset += 4
    return value
  }

  f64() {
    this.need(8)
    const value = this.buffer.readDoubleBE(this.offset)
    this.offset += 8
    return value
  }

  string() {
    const length = this.u16()
    this.need(length)
    const value = this.buffer.toString('utf8', this.offset, this.offset + length)
    this.offset += length
    return value
  }

  payload(type) {
    switch (type) {
      case TAG_BYTE:
        return this.i8()
      case TAG_SHORT:
        return this.i16()
      case TAG_INT:
        return this.i32()
      case TAG_LONG:
        return Number(this.i64())
      case TAG_FLOAT:
        return this.f32()
      case TAG_DOUBLE:
        return this.f64()
      case TAG_BYTE_ARRAY: {
        const length = this.i32()
        this.need(length)
        const value = this.buffer.subarray(this.offset, this.offset + length)
        this.offset += length
        return value
      }
      case TAG_STRING:
        return this.string()
      case TAG_LIST: {
        const elementType = this.u8()
        const length = this.i32()
        const value = []
        for (let index = 0; index < length; index += 1) value.push(this.payload(elementType))
        return value
      }
      case TAG_COMPOUND: {
        const value = {}
        for (;;) {
          const childType = this.u8()
          if (childType === TAG_END) break
          const name = this.string()
          value[name] = this.payload(childType)
        }
        return value
      }
      case TAG_INT_ARRAY: {
        const length = this.i32()
        const value = []
        for (let index = 0; index < length; index += 1) value.push(this.i32())
        return value
      }
      case TAG_LONG_ARRAY: {
        const length = this.i32()
        const value = []
        for (let index = 0; index < length; index += 1) value.push(Number(this.i64()))
        return value
      }
      default:
        throw new Error(`未知 NBT 标签类型 ${type}`)
    }
  }
}

/** Parse an uncompressed NBT buffer into a plain object tree. */
export function parseNbt(buffer) {
  const reader = new Reader(buffer)
  const rootType = reader.u8()
  if (rootType !== TAG_COMPOUND) throw new Error('level.dat 根标签不是 compound')
  reader.string()
  return reader.payload(TAG_COMPOUND)
}

/**
 * Read world metadata from `<world>/level.dat`.
 * @returns {Promise<{gamerules: Record<string, string|number|boolean>, levelName?: string, version?: string, lastPlayed?: number}|null>}
 */
export async function readLevelDat(worldDir) {
  let buffer
  try {
    buffer = await readFile(`${worldDir}/level.dat`)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  let raw
  try {
    raw = gunzipSync(buffer)
  } catch {
    raw = buffer
  }
  const root = parseNbt(raw)
  const data = root?.Data ?? {}
  const rules = data.GameRules ?? {}
  const gamerules = {}
  for (const [key, value] of Object.entries(rules)) {
    const text = String(value)
    if (text === 'true' || text === 'false') gamerules[key] = text === 'true'
    else if (/^-?\d+$/.test(text)) gamerules[key] = Number(text)
    else gamerules[key] = text
  }
  const version = data.Version?.Name ?? undefined
  return {
    gamerules,
    levelName: typeof data.LevelName === 'string' ? data.LevelName : undefined,
    version: typeof version === 'string' ? version : undefined,
    lastPlayed: typeof data.LastPlayed === 'number' ? data.LastPlayed : undefined,
  }
}
