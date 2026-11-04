import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'

const ctx = new Context()
ctx.plugin(SystemPrompt)
ctx.plugin(ToolRuntime)
await new Promise(r => setTimeout(r, 100))
console.log('tools?', typeof ctx.tools)

const dispose = ctx.tools.register(defineTool({
  name: 'mc_status',
  description: 'Return Minecraft server status.',
  parameters: { description: { type: 'string', required: true } },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: { running: { type: 'boolean', required: true }, players: { type: 'integer', required: true } } },
    render: (_a, v) => [{ type: 'text', text: `running=${v.running} players=${v.players}` }],
    presentationMeta: (_a, v) => ({ running: v.running }),
  },
  isConcurrencySafe: () => true,
  async execute(args, exec) {
    console.log('exec keys', Object.keys(exec), 'signal?', !!exec.signal, 'agent?', exec.agent)
    return { running: true, players: 0 }
  },
}))
console.log('schemas', JSON.stringify(ctx.tools.schemas?.() ?? null).slice(0, 500))
const r = await ctx.tools.execute({ callId: 'c1', name: 'mc_status', arguments: { description: 'status' }, signal: new AbortController().signal })
console.log('RESULT', JSON.stringify(r, null, 1))
const bad = await ctx.tools.execute({ callId: 'c2', name: 'mc_status', arguments: {}, signal: new AbortController().signal })
console.log('BAD', JSON.stringify(bad))
const unk = await ctx.tools.execute({ callId: 'c3', name: 'nope', arguments: {}, signal: new AbortController().signal })
console.log('UNK', JSON.stringify(unk))
dispose()
const r2 = await ctx.tools.execute({ callId: 'c4', name: 'mc_status', arguments: { description: 's' }, signal: new AbortController().signal })
console.log('AFTER DISPOSE', JSON.stringify(r2).slice(0,300))
