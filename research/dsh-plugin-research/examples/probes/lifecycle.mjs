import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as mc from './plugin.mjs'

const ctx = new Context()
ctx.plugin(SystemPrompt); ctx.plugin(ToolRuntime)
await new Promise(r => setTimeout(r, 50))
ctx.plugin(mc, { serverDir: '/tmp/mc-probe/srv', javaBin: '/tmp/mc-probe/fake-java.sh', javaArgs: [] })
await new Promise(r => setTimeout(r, 100))
const run = async (name, args) => {
  const r = await ctx.tools.execute({ callId: crypto.randomUUID(), name, arguments: args, signal: new AbortController().signal })
  console.log('---', name, r.isError ? 'ERROR: ' + r.content[0].text.split('\n')[0] : r.content[0].text)
  return r
}
await run('mc_start', { description: 'Start the paper server' })
await run('mc_command', { description: 'List online players', command: 'list' })
await run('mc_status', { description: 'Confirm server health', lines: 3 })
await run('mc_start', { description: 'Start again by mistake' })
await run('mc_stop', { description: 'Stop the paper server' })
await run('mc_status', { description: 'Confirm server stopped', lines: 3 })
console.log('PROMPT SECTIONS', JSON.stringify(ctx.systemPrompt.assemble?.().sections?.map(s=>s.name) ?? 'n/a'))
