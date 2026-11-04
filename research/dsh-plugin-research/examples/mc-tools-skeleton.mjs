/**
 * dsh-minecraft — 本机 Paper 服务器管理插件（宿主侧，ESM Cordis 插件）。
 * 一个可运行的最小骨架：进程启停、console 命令、插件 jar、备份、server.properties。
 */
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir, readdir, rm, cp, stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { isAbsolute, join, resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { HarnessError } from '@deepseek-ai/dsh-llm'

export const name = 'dsh-minecraft'
export const inject = ['tools', 'systemPrompt']

export const Config = z.object({
  serverDir: z.string().min(1),
  javaBin: z.string().default('java'),
  javaArgs: z.array(z.string()).default(['-Xms2G', '-Xmx4G', '-jar', 'server.jar', 'nogui']),
  startTimeoutMs: z.number().default(180_000),
  stopTimeoutMs: z.number().default(60_000),
  consoleBufferLines: z.number().default(400),
})

const err = (m, code) => new HarnessError(m, code ?? 'MC_ERROR')

/** 极简 server.properties 读写（保留注释行与顺序）。 */
function parseProps(text) {
  const map = new Map()
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const i = line.indexOf('=')
    if (i <= 0) continue
    map.set(line.slice(0, i).trim(), line.slice(i + 1))
  }
  return map
}
function renderProps(map) {
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('\n') + '\n'
}

export function apply(ctx, config) {
  const serverDir = resolve(config.serverDir)
  const state = {
    proc: undefined,     // ChildProcess
    startedAt: 0,
    exit: undefined,     // { code, signal }
    lines: [],
    waiters: new Set(),
    starting: undefined,
  }

  const pushLine = (stream, line) => {
    state.lines.push({ t: Date.now(), stream, line })
    if (state.lines.length > config.consoleBufferLines) state.lines.splice(0, state.lines.length - config.consoleBufferLines)
    for (const w of [...state.waiters]) w(line, stream)
  }
  const tail = (n) => state.lines.slice(-n).map((e) => e.line).join('\n') || '(no console output)'

  /** 等到某个 console 行出现，或超时 / 取消。 */
  const waitFor = (predicate, timeoutMs, signal) => new Promise((resolvePromise, rejectPromise) => {
    const waiter = (line) => {
      if (!predicate(line)) return
      cleanup()
      resolvePromise(line)
    }
    const timer = setTimeout(() => { cleanup(); rejectPromise(err(`timed out after ${timeoutMs}ms waiting for server output; recent console:\n${tail(15)}`, 'MC_TIMEOUT')) }, timeoutMs)
    const onAbort = () => { cleanup(); rejectPromise(err('tool call aborted', 'TOOL_ABORTED')) }
    const cleanup = () => { clearTimeout(timer); state.waiters.delete(waiter); signal?.removeEventListener('abort', onAbort) }
    state.waiters.add(waiter)
    signal?.addEventListener('abort', onAbort, { once: true })
  })

  const running = () => state.proc !== undefined && state.exit === undefined

  const start = async (signal) => {
    if (running()) throw err(`server already running (pid ${state.proc.pid})`, 'MC_ALREADY_RUNNING')
    const jar = join(serverDir, 'server.jar')
    await stat(jar).catch(() => { throw err(`server.jar not found in ${serverDir}`, 'MC_NO_JAR') })
    if (state.starting !== undefined) return state.starting
    state.exit = undefined
    state.lines = []
    const child = spawn(config.javaBin, config.javaArgs, { cwd: serverDir, stdio: ['pipe', 'pipe', 'pipe'] })
    state.proc = child
    state.startedAt = Date.now()
    createInterface({ input: child.stdout }).on('line', (line) => pushLine('stdout', line))
    createInterface({ input: child.stderr }).on('line', (line) => pushLine('stderr', line))
    child.once('exit', (code, sig) => {
      state.exit = { code, signal: sig }
      state.proc = undefined
      pushLine('system', `[server exited code=${code} signal=${sig}]`)
    })
    const onAbort = () => { child.kill('SIGTERM') }
    signal?.addEventListener('abort', onAbort, { once: true })
    state.starting = (async () => {
      try {
        const line = await waitFor((l) => /Done \([\d.]+s\)! For help/.test(l) || /\[server exited/.test(l), config.startTimeoutMs, signal)
        if (/\[server exited/.test(line)) throw err(`server exited during startup; console:\n${tail(30)}`, 'MC_START_FAILED')
        return { pid: child.pid, startupLine: line }
      } finally {
        state.starting = undefined
        signal?.removeEventListener('abort', onAbort)
      }
    })()
    return state.starting
  }

  /** 发一条 console 命令并收集随后 250ms 内的输出（不给模型整段历史）。 */
  const command = async (line, signal) => {
    if (!running()) throw err('server is not running; call mc_start first', 'MC_NOT_RUNNING')
    if (line.includes('\n')) throw err('a console command must be a single line', 'MC_BAD_COMMAND')
    const before = state.lines.length
    state.proc.stdin.write(`${line}\n`)
    await new Promise((r) => setTimeout(r, 250))
    signal?.throwIfAborted()
    const delta = state.lines.slice(before).map((e) => e.line).join('\n')
    return { command: line, output: delta === '' ? '(no new console output)' : delta }
  }

  const stop = async (signal) => {
    if (!running()) return { stopped: false, detail: 'server was not running' }
    const child = state.proc
    const exited = new Promise((r) => child.once('exit', (code, sig) => r({ code, signal: sig })))
    child.stdin.write('stop\n')
    const timer = setTimeout(() => child.kill('SIGTERM'), config.stopTimeoutMs)
    const onAbort = () => child.kill('SIGTERM')
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const facts = await exited
      return { stopped: true, exitCode: facts.code, signal: facts.signal }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  // ---- tools -------------------------------------------------------------

  ctx.tools.register(defineTool({
    name: 'mc_status',
    description: 'Report whether the local Minecraft Paper server is running, its pid, uptime, and the tail of its console. Call this before any other mc_* tool when you are unsure of the server state.',
    parameters: {
      description: { type: 'string', required: true, description: 'Clear, concise description of what this check is for, 5-10 words (shown in the UI).' },
      lines: { type: 'integer', description: 'How many trailing console lines to include (default 20, max 200).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          running: { type: 'boolean', required: true },
          pid: { type: 'integer' },
          uptimeMs: { type: 'number' },
          tail: { type: 'string', required: true },
        },
      },
      render: (_args, v) => [{
        type: 'text',
        text: `${v.running ? `running (pid ${v.pid}, up ${Math.round((v.uptimeMs ?? 0) / 1000)}s)` : 'not running'}\n${v.tail}`,
      }],
    },
    isConcurrencySafe: () => true,
    execute(args, exec) {
      exec.signal.throwIfAborted()
      const n = Math.min(Math.max(args.lines ?? 20, 0), 200)
      return {
        running: running(),
        ...(running() ? { pid: state.proc.pid, uptimeMs: Date.now() - state.startedAt } : {}),
        tail: n === 0 ? '(omitted)' : tail(n),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mc_start',
    description: 'Start the local Paper server (java -jar server.jar nogui) and wait until it prints "Done". Returns the pid and the startup line; on failure returns the console tail. Long operation: on timeout the server keeps starting, so check mc_status afterwards.',
    parameters: {
      description: { type: 'string', required: true, description: 'Clear, concise description of why the server is being started, 5-10 words (shown in the UI).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pid: { type: 'integer' },
          startupLine: { type: 'string' },
        },
      },
      render: (_args, v) => [{ type: 'text', text: `server started (pid ${v.pid})\n${v.startupLine}` }],
    },
    timeoutMs: 180_000,
    async execute(_args, exec) {
      const out = await start(exec.signal)
      return { pid: out.pid, startupLine: out.startupLine }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mc_command',
    description: 'Send one console command (without the leading slash) to the running Paper server\'s stdin and return the console output it produced. Examples: "list", "say hello", "whitelist add Notch", "reload confirm".',
    parameters: {
      description: { type: 'string', required: true, description: 'Clear, concise description of what this command does, 5-10 words (shown in the UI).' },
      command: { type: 'string', required: true, description: 'The console command to send, without a leading slash and without newlines.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { command: { type: 'string', required: true }, output: { type: 'string', required: true } },
      },
      render: (_args, v) => [{ type: 'text', text: `> ${v.command}\n${v.output}` }],
    },
    async execute(args, exec) {
      return command(args.command.trim(), exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mc_stop',
    description: 'Gracefully stop the local Paper server by sending "stop" and waiting for the process to exit. Destructive: the world is saved and every player is disconnected.',
    parameters: {
      description: { type: 'string', required: true, description: 'Clear, concise description of why the server is stopped, 5-10 words (shown in the UI).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          stopped: { type: 'boolean', required: true },
          detail: { type: 'string' },
          exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
          signal: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
      render: (_args, v) => [{ type: 'text', text: v.stopped ? `server stopped (exit code ${String(v.exitCode)}, signal ${String(v.signal)})` : `nothing to stop: ${v.detail ?? ''}` }],
    },
    timeoutMs: 120_000,
    async execute(_args, exec) {
      return await stop(exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mc_plugins',
    description: 'List, install, or remove Paper plugin jars under plugins/. Installing copies an absolute .jar path into plugins/; removing deletes a jar by file name. Both require a server restart to take effect.',
    parameters: {
      description: { type: 'string', required: true, description: 'Clear, concise description of the plugin operation, 5-10 words (shown in the UI).' },
      action: { type: 'string', required: true, enum: ['list', 'install', 'remove'], description: 'list — show installed jars; install — copy sourcePath into plugins/; remove — delete fileName.' },
      sourcePath: { type: 'string', description: 'Absolute path of the .jar to install (required for action=install).' },
      fileName: { type: 'string', description: 'Jar file name inside plugins/ to remove (required for action=remove).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          jars: { type: 'array', required: true, items: { type: 'string' } },
          detail: { type: 'string' },
        },
      },
      render: (_args, v) => [{ type: 'text', text: `${v.detail ?? `plugins/ (${v.jars.length})`}\n${v.jars.join('\n') || '(none)'}` }],
    },
    async execute(args, exec) {
      const dir = join(serverDir, 'plugins')
      await mkdir(dir, { recursive: true })
      if (args.action === 'install') {
        const src = args.sourcePath
        if (src === undefined || !isAbsolute(src) || !src.endsWith('.jar')) throw err('action=install needs an absolute .jar sourcePath', 'MC_BAD_ARGS')
        await cp(src, join(dir, src.split('/').pop()), { force: true })
        exec.signal.throwIfAborted()
      } else if (args.action === 'remove') {
        const file = args.fileName
        if (file === undefined || isAbsolute(file) || file.includes('..') || !file.endsWith('.jar')) throw err('action=remove needs a bare .jar fileName inside plugins/', 'MC_BAD_ARGS')
        await rm(join(dir, file), { force: false })
      }
      const jars = (await readdir(dir)).filter((f) => f.endsWith('.jar')).sort()
      return { action: args.action, jars, ...(args.action === 'list' ? {} : { detail: `${args.action} done — restart the server to apply` }) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mc_backup',
    description: 'Copy the Paper world directories into backups/<timestamp>/ while the server is running: sends save-off + save-all flush first, then save-on. Returns the absolute backup path and copied entries.',
    parameters: {
      description: { type: 'string', required: true, description: 'Clear, concise description of why a backup is taken, 5-10 words (shown in the UI).' },
      worlds: { type: 'array', items: { type: 'string' }, description: 'World directory names to copy (default: world, world_nether, world_the_end).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          entries: { type: 'array', required: true, items: { type: 'string' } },
          skipped: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, v) => [{ type: 'text', text: `backup written to ${v.path}\ncopied: ${v.entries.join(', ') || '(none)'}\nskipped: ${v.skipped.join(', ') || '(none)'}` }],
    },
    timeoutMs: 600_000,
    async execute(args, exec) {
      const names = args.worlds ?? ['world', 'world_nether', 'world_the_end']
      const live = running()
      if (live) {
        await command('save-off', exec.signal)
        await command('save-all flush', exec.signal)
      }
      const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
      const dest = join(serverDir, 'backups', stamp)
      await mkdir(dest, { recursive: true })
      const entries = []
      const skipped = []
      for (const n of names) {
        const from = join(serverDir, n)
        try {
          await stat(from)
        } catch {
          skipped.push(n)
          continue
        }
        await cp(from, join(dest, n), { recursive: true })
        entries.push(n)
      }
      if (live) await command('save-on', exec.signal)
      return { path: dest, entries, skipped }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mc_properties',
    description: 'Read or update server.properties. Reading returns the selected keys; writing sets key=value pairs (a timestamped .bak copy is written first) and reminds that most keys need a restart.',
    parameters: {
      description: { type: 'string', required: true, description: 'Clear, concise description of the properties operation, 5-10 words (shown in the UI).' },
      action: { type: 'string', required: true, enum: ['read', 'write'], description: 'read — return current values; write — merge the given set values.' },
      keys: { type: 'array', items: { type: 'string' }, description: 'With action=read: keys to return; omitted means every key.' },
      set: { type: 'object', additionalProperties: true, description: 'With action=write: key → value pairs to set (values must be strings or scalars).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          values: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { key: { type: 'string', required: true }, value: { type: 'string', required: true } },
            },
          },
          changed: { type: 'array', required: true, items: { type: 'string' } },
          backupPath: { type: 'string' },
        },
      },
      render: (_args, v) => [{
        type: 'text',
        text: `${v.action === 'read' ? 'server.properties' : `updated (backup: ${v.backupPath ?? '(none)'})`}\n`
          + (v.values.map((e) => `${e.key}=${e.value}`).join('\n') || '(none)')
          + (v.changed.length > 0 ? `\nchanged: ${v.changed.join(', ')} — restart the server for these to take effect` : ''),
      }],
    },
    async execute(args, exec) {
      const file = join(serverDir, 'server.properties')
      const map = parseProps(await readFile(file, 'utf8'))
      if (args.action === 'read') {
        const keys = args.keys ?? [...map.keys()]
        const values = []
        for (const k of keys) if (map.has(k)) values.push({ key: k, value: map.get(k) })
        return { action: 'read', values, changed: [] }
      }
      const set = args.set
      if (set === undefined || Object.keys(set).length === 0) throw err('action=write needs a non-empty `set` object', 'MC_BAD_ARGS')
      const changed = []
      for (const [k, val] of Object.entries(set)) {
        if (!/^[A-Za-z0-9._-]+$/.test(k)) throw err(`invalid server.properties key "${k}"`, 'MC_BAD_ARGS')
        if (String(val).includes('\n')) throw err(`value of "${k}" must be a single line`, 'MC_BAD_ARGS')
        if (map.get(k) !== String(val)) changed.push(k)
        map.set(k, String(val))
      }
      const backupPath = `${file}.${Date.now()}.bak`
      await cp(file, backupPath, { force: true })
      await writeFile(file, renderProps(map), 'utf8')
      exec.signal.throwIfAborted()
      return { action: 'write', values: Object.entries(set).map(([k, v]) => ({ key: k, value: String(v) })), changed, backupPath }
    },
  }))

  // 让模型知道这组工具存在时的用法约束（第三方可用任意有限 order）
  ctx.systemPrompt.section({
    name: 'tool:minecraft',
    order: 1500,
    text: 'The mc_* tools manage one local Paper server. Check mc_status before starting or stopping; never start a second server. mc_command only receives console commands (no leading slash). After installing or removing a plugin, restart before expecting it to load.',
  })

  // 服务关闭时收尾：停服，避免遗留 java 进程
  ctx.effect(() => async () => {
    if (running()) {
      try { await stop(undefined) } catch { state.proc?.kill('SIGKILL') }
    }
  }, 'minecraft server teardown')
}
