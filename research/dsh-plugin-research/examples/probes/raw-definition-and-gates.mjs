import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

const ctx = new Context()
ctx.plugin(SystemPrompt)
ctx.plugin(ToolRuntime)
await new Promise(r => setTimeout(r, 100))

// hand-written raw definition, trae style
const dispose = ctx.tools.register({
  name: 'mc_command',
  description: 'Send a console command to the Minecraft server.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Console command without the leading slash' },
      description: { type: 'string', description: 'Short label' },
    },
    required: ['command'],
    additionalProperties: false,
  },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  async execute(args) {
    if (typeof args.command !== 'string' || args.command.trim() === '') throw new Error('invalid command: expected a non-empty string')
    return `sent: ${args.command}`
  },
})
const r = await ctx.tools.execute({ callId: 'c1', name: 'mc_command', arguments: { command: 'list' }, signal: new AbortController().signal })
console.log('RAW-DEF RESULT', JSON.stringify(r))
const r2 = await ctx.tools.execute({ callId: 'c2', name: 'mc_command', arguments: { command: 42 }, signal: new AbortController().signal })
console.log('RAW-DEF NO-VALIDATION', JSON.stringify(r2))

// ask gate without an approval service
ctx.on('tools/pre-execute', async (exec, next) => {
  if (exec.name === 'mc_command') return { kind: 'ask', reason: `may I run "${exec.arguments.command}" on the server?` }
  return next()
})
const r3 = await ctx.tools.execute({ callId: 'c3', name: 'mc_command', arguments: { command: 'stop' }, signal: new AbortController().signal })
console.log('ASK-NO-APPROVAL', JSON.stringify(r3))

// cancel before dispatch
const ac = new AbortController(); ac.abort(new Error('user stop'))
const r4 = await ctx.tools.execute({ callId: 'c4', name: 'mc_command', arguments: { command: 'list' }, signal: ac.signal })
console.log('ABORT', JSON.stringify(r4))

// system prompt section
ctx.systemPrompt.section({ name: 'minecraft:usage', order: 1500, text: 'Use mc_* tools to manage the local Paper server.' })
console.log('PROMPT', JSON.stringify(ctx.systemPrompt.assemble?.() ? 'assemble-ok' : 'no-assemble'))
