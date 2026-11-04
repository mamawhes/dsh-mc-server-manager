/**
 * Java process supervision for one managed server: spawn, log capture, console
 * I/O, readiness detection and graceful shutdown. Only one runtime object per
 * plugin instance; child processes are killed when the plugin unloads.
 */
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { ensure, ManagerError, sleep, timestamp, waitFor } from './util.js'

const MAX_LINES = 4000
const STOP_TIMEOUT_MS = 30000
const SIGTERM_WAIT_MS = 5000

let lineSeq = 0

class ServerRuntime {
  constructor(record, { javaCommand, extraArgs, log }) {
    this.record = record
    this.javaCommand = javaCommand
    this.extraArgs = extraArgs
    this.log = log
    this.child = null
    this.state = 'stopped'
    this.startedAt = null
    this.lastExit = null
    this.seq = 0
    this.lines = []
    this.waiters = new Set()
    this.logStream = null
    this.lastError = null
    this.exitPromise = null
    this.resolveExit = null
    this.lock = Promise.resolve()
  }

  /** Serialize start/stop per server. */
  withLock(task) {
    const next = this.lock.then(task, task)
    this.lock = next.catch(() => {})
    return next
  }

  get running() {
    return this.child !== null && this.state !== 'stopped'
  }

  get status() {
    return {
      state: this.state,
      running: this.running,
      pid: this.child?.pid ?? null,
      startedAt: this.startedAt,
      lastExit: this.lastExit,
      lastError: this.lastError,
      uptimeMs: this.startedAt === null ? 0 : Date.now() - this.startedAt,
    }
  }

  pushLine(line, stream = 'stdout') {
    const entry = { seq: ++this.seq, at: Date.now(), stream, text: line }
    this.lines.push(entry)
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES)
    this.logStream?.write(`[${timestamp()}] ${line}\n`)
    for (const waiter of this.waiters) waiter(entry)
  }

  /** Subscribe to new lines; returns an unsubscribe function. */
  onLine(listener) {
    this.waiters.add(listener)
    return () => this.waiters.delete(listener)
  }

  /** Lines after a cursor (0 returns everything currently retained). */
  consoleSince(cursor = 0) {
    const since = Number.isFinite(Number(cursor)) ? Number(cursor) : 0
    const lines = this.lines.filter((line) => line.seq > since)
    return { lines, cursor: this.seq, status: this.status }
  }

  async start(serverDir, { eulaAccepted, memoryMb, javaCommand }) {
    return this.withLock(async () => {
      if (this.running) return this.status
      ensure(eulaAccepted === true, 'EULA_REQUIRED', '还没有接受 Minecraft EULA：请先在面板中勾选同意，再启动服务器')
      this.javaCommand = javaCommand ?? this.javaCommand
      const jar = join(serverDir, 'paper.jar')
      ensure((await stat(jar).catch(() => null)) !== null, 'JAR_MISSING', '缺少 paper.jar：请先创建服务器或重新下载服务端')
      this.lastError = null
      this.lastExit = null
      this.state = 'starting'
      this.startedAt = Date.now()
      const heap = `${Math.max(512, Number(memoryMb) || 2048)}M`
      const args = [
        `-Xms${heap}`,
        `-Xmx${heap}`,
        ...this.extraArgs,
        '-jar',
        'paper.jar',
        'nogui',
      ]
      const logFile = join(serverDir, 'logs', `manager-${timestamp()}.log`)
      this.logStream = createWriteStream(logFile, { flags: 'a' })
      this.logStream.on('error', () => { this.logStream = null })
      let child
      try {
        child = spawn(this.javaCommand, args, { cwd: serverDir, stdio: ['pipe', 'pipe', 'pipe'], env: process.env })
      } catch (error) {
        this.state = 'stopped'
        this.lastError = String(error?.message ?? error)
        this.logStream?.end()
        this.logStream = null
        throw new ManagerError('JAVA_MISSING', `无法启动 java：${this.lastError}`)
      }
      this.child = child
      this.exitPromise = new Promise((resolve) => { this.resolveExit = resolve })
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      let stdoutBuffer = ''
      let stderrBuffer = ''
      child.stdout.on('data', (chunk) => {
        stdoutBuffer = consumeLines(stdoutBuffer + chunk, (line) => this.handleLine(line, 'stdout'))
      })
      child.stderr.on('data', (chunk) => {
        stderrBuffer = consumeLines(stderrBuffer + chunk, (line) => this.handleLine(line, 'stderr'))
      })
      child.once('error', (error) => {
        this.lastError = error?.code === 'ENOENT' ? `找不到 java 命令（${this.javaCommand}）` : String(error?.message ?? error)
        this.pushLine(`[管理器] 启动失败：${this.lastError}`, 'stderr')
      })
      child.once('exit', (code, signal) => {
        if (stdoutBuffer !== '') this.handleLine(stdoutBuffer, 'stdout')
        if (stderrBuffer !== '') this.handleLine(stderrBuffer, 'stderr')
        this.lastExit = { code, signal, at: Date.now() }
        this.child = null
        this.state = 'stopped'
        this.startedAt = null
        this.pushLine(`[管理器] 服务器进程已退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}）`, 'stdout')
        this.logStream?.end()
        this.logStream = null
        this.resolveExit?.()
      })
      this.pushLine(`[管理器] 已启动 java ${args.join(' ')}`, 'stdout')
      return this.status
    })
  }

  handleLine(line) {
    if (line === '') return
    const text = line
    this.pushLine(text)
    if (this.state === 'starting' && /Done\s*\(|\bFor help, type "help"/.test(text)) {
      this.state = 'running'
      this.startedAt = this.startedAt ?? Date.now()
    }
  }

  /** Write one console command (newlines flattened). */
  send(command) {
    ensure(this.running && this.child !== null, 'SERVER_STOPPED', '服务器未运行')
    const text = String(command ?? '').replace(/[\r\n]+/g, ' ').trim()
    ensure(text.length > 0 && text.length <= 2000, 'INVALID_INPUT', '命令不能为空且不超过 2000 字符')
    this.child.stdin.write(`${text}\n`)
    return text
  }

  async commandAndWait(command, { timeoutMs = 1200, matcher } = {}) {
    const startSeq = this.seq
    this.send(command)
    const predicate = matcher ?? (() => true)
    await waitFor(() => this.lines.some((line) => line.seq > startSeq && predicate(line.text)), { timeoutMs, intervalMs: 50 })
    return this.lines.filter((line) => line.seq > startSeq)
  }

  async stop() {
    return this.withLock(async () => {
      if (!this.running || this.child === null) return this.status
      this.state = 'stopping'
      try {
        this.child.stdin.write('stop\n')
      } catch {
        /* process may already be gone */
      }
      const exited = await Promise.race([this.exitPromise, sleep(STOP_TIMEOUT_MS).then(() => false)])
      if (!exited && this.child !== null) {
        this.pushLine('[管理器] 30 秒内未退出，发送 SIGTERM', 'stderr')
        this.child.kill('SIGTERM')
        const term = await Promise.race([this.exitPromise, sleep(SIGTERM_WAIT_MS).then(() => false)])
        if (!term && this.child !== null) {
          this.pushLine('[管理器] SIGTERM 未生效，强制结束进程', 'stderr')
          this.child.kill('SIGKILL')
          await Promise.race([this.exitPromise, sleep(2000)])
        }
      }
      return this.status
    })
  }

  async dispose() {
    try {
      await this.stop()
    } catch (error) {
      this.log?.('warn', `minecraft: 关闭服务器 ${this.record.id} 失败：${String(error)}`)
      this.child?.kill('SIGKILL')
    }
  }
}

function consumeLines(buffer, emit) {
  const parts = buffer.split(/\r?\n/)
  const rest = parts.pop() ?? ''
  for (const part of parts) emit(part)
  return rest
}

/** Java availability probe, cached briefly per command path. */
const javaProbes = new Map()

export async function checkJava(javaCommand = 'java') {
  const cached = javaProbes.get(javaCommand)
  if (cached !== undefined && Date.now() - cached.at < 60000) return cached.value
  const value = await new Promise((resolve) => {
    let output = ''
    const child = spawn(javaCommand, ['-version'], { stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (chunk) => { output += chunk.toString('utf8') })
    child.stderr.on('data', (chunk) => { output += chunk.toString('utf8') })
    child.on('error', (error) => resolve({ ok: false, command: javaCommand, version: '', error: error.code === 'ENOENT' ? `未找到 ${javaCommand}` : String(error.message ?? error) }))
    child.on('close', (code) => {
      if (code !== 0) resolve({ ok: false, command: javaCommand, version: '', error: output.trim().slice(0, 300) || `java -version 退出码 ${code}` })
      else resolve({ ok: true, command: javaCommand, version: output.split(/\r?\n/).find((line) => line.trim() !== '')?.trim() ?? output.trim(), error: null })
    })
  })
  javaProbes.set(javaCommand, { at: Date.now(), value })
  return value
}

/** One runtime per server, created lazily. */
export class RuntimePool {
  constructor({ javaCommand, extraArgs, log }) {
    this.javaCommand = javaCommand
    this.extraArgs = extraArgs
    this.log = log
    this.pool = new Map()
  }

  of(record) {
    let runtime = this.pool.get(record.id)
    if (runtime === undefined) {
      runtime = new ServerRuntime(record, { javaCommand: this.javaCommand, extraArgs: this.extraArgs, log: this.log })
      this.pool.set(record.id, runtime)
    }
    return runtime
  }

  status(id) {
    return this.pool.get(id)?.status ?? { state: 'stopped', running: false, pid: null, startedAt: null, lastExit: null, lastError: null, uptimeMs: 0 }
  }

  consoleSince(id, cursor) {
    const runtime = this.pool.get(id)
    if (runtime === undefined) return { lines: [], cursor: 0, status: this.status(id) }
    return runtime.consoleSince(cursor)
  }

  async start(record, options) {
    return this.of(record).start(record.dir, options)
  }

  /** Replace the default java command (used when the plugin config changes). */
  setJavaCommand(command) {
    this.javaCommand = command
  }

  async stop(id) {
    return this.pool.get(id)?.stop() ?? this.status(id)
  }

  send(id, command) {
    const runtime = this.pool.get(id)
    ensure(runtime !== undefined, 'SERVER_STOPPED', '服务器未运行')
    return runtime.send(command)
  }

  async commandAndWait(id, command, options) {
    const runtime = this.pool.get(id)
    ensure(runtime !== undefined, 'SERVER_STOPPED', '服务器未运行')
    return runtime.commandAndWait(command, options)
  }

  onLine(id, listener) {
    return this.pool.get(id)?.onLine(listener) ?? (() => {})
  }

  /** Stop every process this pool owns (plugin unload). */
  async disposeAll() {
    const runtimes = [...this.pool.values()]
    this.pool.clear()
    await Promise.allSettled(runtimes.map((runtime) => runtime.dispose()))
  }
}

/** Read `eula.txt` and report whether the EULA has been accepted. */
export async function readEula(serverDir) {
  try {
    const text = await readFile(join(serverDir, 'eula.txt'), 'utf8')
    return /^\s*eula\s*=\s*true\s*$/im.test(text)
  } catch {
    return false
  }
}
