import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as mc from './plugin.mjs'
const ctx = new Context()
ctx.plugin(SystemPrompt); ctx.plugin(ToolRuntime)
await new Promise(r => setTimeout(r, 50))
ctx.plugin(mc, { serverDir: '/tmp/mc-probe/srv' })
await new Promise(r => setTimeout(r, 100))
const a = await ctx.systemPrompt.assemble()
console.log(Object.keys(a))
console.log(a.sections.map(s => [s.name, s.order, String(s.text).slice(0, 60)]))
console.log('tools in assembly:', a.tools.map(t => t.name))
