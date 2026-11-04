# DSH 插件与工具机制调研（精确 API + 源码位置）

调研对象：`/tmp/dsh-app/dsh/node_modules/@deepseek-ai/` 下 0.2.1-rc.5 的已构建产物（只读参考）。
标 **实测** 的结论是用 `@deepseek-ai/cordis` + `dsh-tools` + `dsh-system-prompt` 真正加载并执行验证过的（可复现脚本见 [`docs/examples/probes/`](examples/probes/README.md)，摘要见 §9）。

源码位置约定：每个包同时有 `lib/index.js`（打包后的 bundle）和 `lib/types/*.js`（可读的 ESM 单文件）。下面引用 **`lib/types/*.js` 的行号**（可读版），bundle 版行为相同。

---

## 0. 结论速览

| 问题 | 结论 |
|---|---|
| 工具声明 | `ctx.tools.register(definition)`；`definition = { name, description, parameters, output:{schema,render,presentationMeta?}, execute, timeoutMs?, isConcurrencySafe?, finalizeContent?, projectContent?, presentCall?, presentResult?, deferLoading? }`（`dsh-tools/lib/types/index.js:468` 校验） |
| 参数 schema | 两种写法：① `defineTool({parameters:{...}})` 的属性表 DSL（会做参数校验，失败 → `Error: invalid arguments: …`）；② 手写裸 JSON Schema（不校验，参数原样给 execute） |
| handler | `async execute(args, exec)`；返回值必须是 `output.schema` 声明的 canonical JSON；模型看到的内容由 `output.render(args, value)` 生成（`ContentBlock[]`） |
| 流式/进度 | ❌ 工具没有流式或进度通道（只有 `exec.deferContext()` / `exec.concludeTurn()` 两个旁路）。长任务用 `ctx.jobs` + 自带 `job_output`/`job_list`/`job_kill` |
| 返回图片 | ✅ `render` 返回 `{type:'image', attachment}` 块，attachment 由 `ctx.attachments.saveImage()` 产生；或用 Markdown 相对路径（trae 插件做法） |
| 报错 | `throw` 任意 Error → 结果变成 `Error: <message>`，不会中断 turn；`HarnessError` 子类额外把 `{name, code}` 存进 `tool/result.error`（不进模型可见文本） |
| UI 卡片 | 没有 `ctx.uiTool`。浏览器端 keyed slot `tool.call.toolview` 按 **wire 工具名** 分派；未注册 → 通用卡片（`dsh-client-ui-tool/lib/client.js:1967`） |
| 自定义卡片 | 需要额外发一个浏览器 bundle（`package.json` 的 `dsh.client` + `window.__ModuleLoader__.load({id,factory})` 格式）。只写宿主插件 → 只能用通用卡片 |
| 历史/上下文 | `tool/call` + `tool/result` 两条 session 事件（`dsh-agent-loop/lib/index.js:682,697`）；`meta` 来自 `presentationMeta`；额外上下文走 `exec.deferContext`（下一 step 作为 user 消息） |
| 截断 | 工具层 **没有** 统一上限，工具自己负责；`dsh-output-retention` 提供 `TextRetainer`/`ItemRetainer`；压缩期 `dsh-compaction-tool-result-pruner` 默认 >8192 字符截头 4096 + 尾 1024 |
| 超时 | `timeoutMs` 只是声明；真正执行靠 `dsh-tool-call-timeout-policy`（base 已挂）。取消靠 `exec.signal`，必须协作式 |
| 审批 | `tools/pre-execute` 返回 `{kind:'ask', reason}` → `ctx.approval`（`dsh-user-approval`）；也可在 execute 里直接 `ctx.approval.request(...)`；无审批通道时 fail-closed |
| 命令 | ✅ `ctx.commands.register({name, description, handler})`（人工 `/mc start`，**不进模型上下文**） |
| skill | ✅ `ctx.skills.register({name, description, content, source})`（runtime skill）或 `registerProvider`（文件系统） |

---

## 1. 工具定义与注册

### 1.1 注册点与生命周期

```js
// dsh-tools/lib/types/index.js:468
ctx.tools.register(definition) // → disposer
```

* 注册进 **调用方 context 的 scope**：在插件 `apply` 里（全局 context）注册 = 全局工具；在 `agent.ctx` 里注册 = 只对该 agent 可见。
  实现机制：`lib/types/index.js:498` 用 `scopeOf(this.ctx)`，而 cordis 的 service 代理会把 `this.ctx` 解析成**发起调用的 context**（`cordis/lib/index.js:123 createTraceable`）。
* 注册是 cordis effect（`lib/types/index.js:488` → `ScopedLayers.effect`），**插件 fiber 卸载时自动反注册**；返回的 disposer 用于提前撤销（实测：`dispose()` 后调用该工具 → `UNKNOWN_TOOL`）。
* 校验（注册时立刻抛）：`output` 必须是 `{schema, render, presentationMeta?}` 且 `render` 是函数；`output.schema` 必须落在受支持的 JSON Schema 子集内；`timeoutMs` 必须正有限；名字不能是保留的 `run_code`。
* `definition.parameters` 注册时**不校验**，原样投影给模型。

插件声明依赖：

```js
export const name = 'dsh-minecraft-manager'
export const inject = ['tools', 'systemPrompt']   // 需要 ctx.tools / ctx.systemPrompt
```

`ctx.get('attachments')`、`ctx.get('approval')`、`ctx.get('jobs')` 这类可选服务用 `ctx.get(...)` 探测，不要写进 `inject`（否则整排依赖会被扣住）。

### 1.2 写法 A：`defineTool`（推荐，带参数校验）

```js
import { defineTool } from '@deepseek-ai/dsh-tools'

ctx.tools.register(defineTool({
  name: 'mc_status',
  description: 'Report whether the local Minecraft Paper server is running …',
  parameters: {
    description: { type: 'string', required: true, description: '…(shown in the UI)' },
    lines:       { type: 'integer', description: 'Trailing console lines (default 20)' },
    action:      { type: 'string', enum: ['read', 'write'], description: '…' },
    worlds:      { type: 'array', items: { type: 'string' } },
    nested:      { type: 'object', additionalProperties: false,
                   properties: { key: { type: 'string', required: true } } },
  },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: {
      running: { type: 'boolean', required: true },
      tail:    { type: 'string', required: true },
    } },
    render: (_args, v) => [{ type: 'text', text: `running=${v.running}\n${v.tail}` }],
    presentationMeta: (_args, v) => ({ running: v.running }), // 落库到 tool/result.meta
  },
  isConcurrencySafe: () => true,   // 省略 = exclusive（独占屏障）
  timeoutMs: 30_000,               // 声明式；需 timeout-policy 才生效
  async execute(args, exec) { … },
}))
```

**DSL 精确规则**（`dsh-tools/lib/types/schema.js:120-200` 编译，`274` 是 `defineTool`）：

| 键 | 说明 |
|---|---|
| `type` | `string` / `number` / `integer` / `boolean` / `null` / `array` / `object` / `json`（author-only，编译成空 schema = 任意 JSON），或改用 `oneOf`（≥2 分支，**不能同时写 type**） |
| `required` | 只允许 `required: true`（写 `false` 直接报错） |
| `description` / `title` / `default` / `examples` | 注解，原样带到 JSON Schema |
| `enum` / `const` | 仅标量节点，`enum` 必须是非空标量数组 |
| `object` | **必须显式给 `additionalProperties: true|false`**，否则报错；嵌套 `properties` 递归 |
| `array` | `items` 可选 |
| 其它键 | 报错（`xxx.yyy is not supported by the value schema DSL`） |

实测编译结果（`params` 里 `required:true` 会汇总到顶层 `required`）：

```json
{"type":"object","properties":{"description":{"type":"string","description":"x"},
 "tail":{"type":"integer"},"mode":{"type":"string","enum":["stop","restart"]},
 "nested":{"type":"object","additionalProperties":false,
   "properties":{"a":{"type":"string"}},"required":["a"]}},
 "required":["description"]}
```

顶层参数对象**不写 `additionalProperties`，因而是开放对象**：模型多给的键会原样进 `execute`（可用于 `confirm:true` 之类的隐藏开关，但模型看不到它）。

### 1.3 写法 B：手写裸 ToolDefinition（第三方插件常用，零依赖）

`dsh-connect-trae` 的 `trae_draw_image` 就是这种（`~/.dsh/profiles/desktop/node_modules/dsh-connect-trae/lib/index.js:10580` 起），注释明确说“不 import 宿主类型，只要求 `output.render` 是函数、`output.schema` 是受支持的 JSON Schema；`parameters` 原样投影给模型”：

```js
const dispose = ctx.tools.register({
  name: 'mc_command',
  description: 'Send one console command …',
  parameters: {                       // ← 裸 JSON Schema，不经过 DSL，也不做本地校验
    type: 'object',
    properties: {
      command:     { type: 'string', description: 'Console command without leading slash' },
      description: { type: 'string', description: 'Short label (shown in the UI)' },
    },
    required: ['command'],
    additionalProperties: false,
  },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  async execute(args) {               // ← 自行校验
    if (typeof args.command !== 'string' || args.command.trim() === '')
      throw new Error('invalid command: expected a non-empty string')
    return `sent: ${args.command}`
  },
})
```

实测：`{command: 42}` 会被 execute 自己的校验拦下（`Error: invalid command: …`），而不是注册表拦下。

> 选择建议：需要 JSON Schema 的 `oneOf`/复杂嵌套又不想被 DSL 限制 → 写法 B；需要 `defineTool` 的自动校验/`presentCall`/`isConcurrencySafe` → 写法 A。两种都能注册进同一个 registry。

### 1.4 handler 签名与返回值

`execute(args, exec)`。`exec` 的字段（实测 `Object.keys(exec)`，无 agent 时 `agent` 键不出现）：

```js
{
  token,          // registry 内部相关性 token（Symbol）
  callId,         // 本次调用 id（= assistant tool_call id）
  rootCallId,     // PTC 子调用的根调用 id
  name,
  arguments,      // 冻结后的参数（已 deepFreeze）
  signal,         // AbortSignal，必须协作
  agent,          // 可选：Agent（exec.agent.session.workingDirectory 等）
  parent,         // 可选：PTC 父调用
  schema,         // 可选
  deferContext(context),  // 追加"下一步"的用户消息
  concludeTurn(),         // 声明本轮到此结束
}
```

返回值：**只返回 canonical JSON 值**，必须匹配 `output.schema`（`dsh-tools/lib/types/index.js:1199 createSuccessResult`）。模型看到的文本由 `output.render(exec.arguments, value)` 产出，返回 `ContentBlock[]`：

```js
{ type: 'text',  text: '…' }
{ type: 'image', attachment: { attachmentId, mediaType, bytes, width, height, name?, originalDimensions? } }
```

其他可声明的钩子：

| 字段 | 作用 | 源码 |
|---|---|---|
| `output.render(args, value)` | 生成模型可见 content（必填） | `index.js:1209` |
| `output.presentationMeta(args, value)` | 生成落库的 `meta`（UI 卡片用，模型看不到） | `index.js:1213` |
| `finalizeContent(exec, result)` | 对最终 content 做最后一道裁剪/改写（job 工具用它做 byte 上限） | `index.js:325`/`tool-jobs/lib/index.js:240` |
| `projectContent(exec, result)` | 在 post-execute 策略之前预置 content | 同上 |
| `isConcurrencySafe(args)` | true → 可与其他调用并行；抛错/省略 → exclusive | `index.js:694` |
| `timeoutMs` | **仅声明**，registry 不强制；`dsh-tool-call-timeout-policy` 读它并 abort | 见 §4 |
| `presentCall/presentResult` | Host 侧纯展示描述（`{card:'generic'|'terminal'|'read'|'diff'|'search'|'web', …}`）；**Web Client 不消费** | `dsh-tool-bash/lib/index.js:711` |
| `deferLoading` | 请求延迟加载定义（provider 支持有限） | `dsh-tools/README.md:240` |

### 1.5 错误如何表达

* `throw new Error('…')` → `content: [{type:'text', text:'Error: …'}]`、`isError:true`，`turn` 继续（实测）。
* `throw new (class extends HarnessError)(msg, 'MC_NOT_RUNNING')` → 额外把 `{info:{name, code}}` 写进 `tool/result.error`（模型文本里仍只有 `Error: msg`）。`dsh-llm/lib/index.js:126` 定义 `HarnessError`，`dsh-tools/lib/types/index.js:158 errorInfo` 只认 `HarnessError` 实例。
* 取消：`throw` 一个 `name='AbortError'`、`code='TOOL_ABORTED'` 的错误（仿 `dsh-tool-bash/lib/index.js:318 toolAborted()`）；即使不抛，registry 也会在 body 返回后把结果换成 `ABORTED`。
* 不存在“部分成功”：`isError` 的结果没有 `value`（`dsh-tools/lib/types/index.js:1274 toolErrorResult`）。

### 1.6 按 agent preset / 会话可见性过滤

| 手段 | 用法 | 说明 |
|---|---|---|
| preset 作用域 | 把插件行写进 `dsh-agent-preset` 的 `plugins:` 而不是全局补丁 | 只有该 preset 的 agent 有这组工具（`dsh-agent-preset/README.md`） |
| `ctx.tools.restrict({allow,deny})` | 必须在 **scoped ctx**（`agent.ctx`）里调用，否则抛错；可叠加、可 dispose | `index.js:497` |
| `ctx.tools.get(name, scope)` | 判断某 scope 是否看得见某工具（可用来做 prompt 条件段落） | `index.js:654` 附近 |
| PTC 模式 | `tools mode: ptc` 时模型只看到 `run_code` + 生成的 SDK | `dsh-tools/README.md` §PTC |
| 注销 | disposer / 插件卸载 | 实测生效 |

> 注意：`restrict` 只能遮 **global** 工具；scope 内注册的工具不受全局 restrict 影响。

本部署（desktop profile + `dsh-base`）没有给 `@deepseek-ai/dsh-tools` 配 `mode`，即 **native**：模型直接看到每个工具的 schema（`dsh-base/cordis.patch.yml:500`）。只有某个 agent preset 显式挂 `@deepseek-ai/dsh-agent-tool-presentation` 且 `mode: ptc` 时，模型才只看到 `run_code`；此时你的工具仍可被 `await tools.mc_status({...})` 调用（SDK 由 JSON Schema 生成），不需要改代码。

---

## 2. 工具调用的 UI 呈现（transcript 卡片）

### 2.1 分派机制

* 浏览器端把每个原子调用按 **wire 工具名** 分派到 keyed slot `tool.call.toolview`
  （`dsh-client-ui-tool/lib/client.js:1967`：`renderSlot("tool.call.toolview", owner, { entryKey: toolName, fallback: <GenericToolCard/> })`）。
* 内置视图就在同一个包里用同样方式注册（例如 `bash`：`client.js:2614`；`ask_user_question`：`client.js:2422`）：
  ```js
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'bash',
    locale: 'conversation',
  }, BashRow))
  ```
* **没有 `ctx.uiTool`**（全仓 grep 无此服务）。宿主侧的 `presentCall/presentResult` 明确不进 Web Client（`dsh-tools/README.md:95`）。

### 2.2 未注册工具 → 通用卡片的行为（决定我们能白拿多少）

`dsh-client-ui-tool/lib/client.js`：

* `TOOL_VARIANTS`（`:97`）把已知名字映射成 `bash/read/write/edit/search/code/others`；未知名 → `others`。
* 标题：`toolName · <summary>`；summary 取 **参数里的 `description` 字符串首行**，没有则退化成参数 JSON 摘要（`argumentSummary :261`、`toolRowModel :307`）。
* 展开体 = 原始参数 JSON（`bodyRaw`）+ 结果文本（`resultText`），错误时显示首行。
* 结果里的 image 块由 `tool.call.images` slot（`dsh-client-ui-attachment`）渲染成画廊。

**结论（可白拿的做法）**：给每个工具的第一个参数都叫 `description`（必填、一句话、主动语态），卡片就会显示 `mc_stop · Stop the paper server for a backup`，展开后是参数 JSON + 纯文本结果。这已经足够可用；不需要写任何浏览器代码。

### 2.3 自定义卡片：第三方是否支持？

**支持，但要额外发一个浏览器 bundle**，机制是公开的 keyed slot（`dsh-client-ui-tool/README.md:34-46`）：

1. `package.json` 声明 `dsh.client`（本仓库已有雏形）：
   ```json
   "dsh": { "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-layout", "@deepseek-ai/dsh-client-ui-sidebar"] } }
   ```
   `inject` 列的是**必须先加载的 client 插件**（模块图顺序），不是 npm 依赖。
2. `lib/client.js` 必须是 DSH 模块加载器格式（这就是被 `dsh-client-modules` 服务的 bundle）。**普通 ESM `export function apply` 不会被浏览器端接受** —— 第一方包用 tsdown + DSH 的 client 构建插件生成这种 `window.__ModuleLoader__.load({id, factory})` 包装（`dsh-client-modules/README.md` 的 "Lazy-CJS model"），第三方要么复刻这个包装，要么用同样的构建链（trae 就是 tsdown）：
   ```js
   window.__ModuleLoader__.load({
     id: 'dsh-minecraft-manager',
     factory: (require) => {
       const React = require('react')
       const { jsx } = require('react/jsx-runtime')
       const module = { exports: {} }
       const exports = module.exports
       const name = 'minecraft-manager-client'
       const inject = ['slots']
       function apply(ctx) {
         ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
           name: 'tool.call.toolview', key: 'mc_status',
         }, McStatusRow))
       }
       exports.name = name; exports.inject = inject; exports.apply = apply
       return module.exports
     },
   })
   ```
3. 可用的 baseline 模块（静态表，`dsh-web-frontend/dist/assets/index-*.js` 里的 `OZ()`）：
   `react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`zod`、`@tanstack/react-virtual`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。其它模块要在 `dsh.client.external` 里声明。
4. 卡片组件的 props（`ToolCallOwnerProps`，`client.js:1930` 附近）：`{ callId, toolName, phase: 'preparing'|'start'|'result', block, cwd, home, openFile, inspect, loadImage, useDisclosure, t }`；`inject` 工厂还能再塞自定义 props。

**限制 / 风险**：

* 槽注册选项在 rc 版本间改过名（trae 源码注释明确记载 `id`/`order` → `key`/`priority` 的破坏性改名），跨版本要 try/catch 兜底。
* 语言包、primitive 组件（`ToolRow` 等）都在 `@deepseek-ai/dsh-client-ui-primitives`，未做稳定性承诺。
* 结论：**先用通用卡片 + 纯文本结果**；只有确实需要（比如服务器状态面板、启动按钮）再写 client bundle。

### 2.4 图片怎么显示

两条路，都实测于 trae 插件（`lib/index.js:10690` 注释）：

1. **Markdown 相对路径**（最简单）：`render` 返回 `` {type:'text', text:`![mc](mc-shots/x.png)`} ``，路径按 session cwd 解析，走 `api/file` 鉴权路由取字节。trae 用 `trae-images/<name>`。
2. **附件块**（正规做法，多模态模型能"看"到）：`ctx.attachments.saveImage({data, mediaType, name})` → `{type:'image', attachment: ref}`，同时 UI 走 `tool.call.images`。见 `dsh-tool-fs/lib/index.js:986` 的 `read_image`。

---

## 3. 结果如何进入会话历史 / 模型上下文

### 3.1 两条 durable 事件

`dsh-agent-loop/lib/index.js`：

```js
// :682
session.append('tool/call', { turn, step, callId, name, arguments })       // 模型原始参数（字符串或 JSON）
// :697
session.append('tool/result', { turn, step, message, error?, meta? },
  { surfaceOp: 'append', sourceEventSeqs: [callSeq] })                     // message = createToolResultMessage({callId, content, isError})
```

* `content` = `output.render(...)` 的结果（text/image 块）；`meta` = `presentationMeta` 的快照。
* `value`（canonical JSON）**不进** session 事件，只给程序化调用方（PTC / `run_code`）用。
* 压缩：`dsh-compaction-tool-result-pruner` 在压力触发时把 >`thresholdChars`（默认 8192）的文本换成 头 4096 + `middle pruned` + 尾 1024；原始结果留在 session log 里可回放。

### 3.2 额外上下文（相当于"工具顺手写一条用户消息"）

```js
import { createUserMessage } from '@deepseek-ai/dsh-llm'

exec.deferContext(createUserMessage({
  content: [{ type: 'text', text: '服务器最近 50 行日志：…' }],
  source: { kind: 'minecraft-console' },
}))
```

实现：`deferContext` 收集 → 结果上的 `additionalContexts` → loop 在 commit 后 splice 进 agent inbox 的 `next-step`（`dsh-agent-loop/lib/index.js:572, 1166`），下一 step 作为 user 消息被采纳。PTC 模式的图片结果就是这么进上下文的。

### 3.3 长输出的截断（工具自己负责）

* 工具层**没有**统一上限：`output.render` 返回多长就进多长（受后续压缩策略约束）。
* 推荐库 `@deepseek-ai/dsh-output-retention`：
  ```js
  import { TextRetainer, formatRetentionNotice } from '@deepseek-ai/dsh-output-retention'
  const out = new TextRetainer({ kind: 'headTail', headBytes: 4096, tailBytes: 4096 })
  // …push(buf)…
  const { text, omittedBytes } = out.finish()
  ```
  `dsh-tool-bash` 就是靠它 + 溢出文件（spill）实现 "tail + `[output truncated; full output: <path>]`"。
* 也可以像 `dsh-tool-jobs` 那样声明 `finalizeContent(exec, result)` 再兜一层（`dsh-tool-jobs/lib/index.js:240`）。

### 3.4 attachments

* 图片：`ctx.attachments.saveImage({ data: Uint8Array, mediaType, name })` → `AttachmentRef`；需 `dsh-attachment-local` 挂载（base 已有）。有尺寸/字节/像素上限，失败抛 `AttachmentError`（路由 `code`，别解析 message）。
* 通用文件（>图片）：`ctx.attachments.saveFile(...)`，模型只拿到一行句柄 + 只读路径。
* 注意：**assistant 侧图像输出尚未打通**（附件 README 的限制），但 **tool result 是 user 角色**，所以工具返回图片是可行的（`read_image` 就是证据）。

---

## 4. 超时、取消、权限审批

### 4.1 取消（AbortSignal）

* `exec.signal` 由调用方（turn）拥有；工具必须观察它并尽快收敛。registry 语义（`dsh-tools/README.md:126`、实测）：
  * body 未开始就取消 → `ABORTED_BEFORE_DISPATCH`（`Error: tool call aborted before dispatch`）。
  * body 已开始 → 等 body settle，然后把成功结果换成 `ABORTED`。
  * `tool/execute` wrapper 替换 signal 时，registry 会把调用方 signal **重新 fuse** 回来，body 拿到的始终包含调用方取消。
* 长时间阻塞操作（等 `Done (`、等进程退出）必须用 `signal.addEventListener('abort', …)` 或 `AbortSignal.any([exec.signal, AbortSignal.timeout(ms)])`。

### 4.2 超时

* `definition.timeoutMs` 只是**声明**（registry 不强制）。
* 强制者是 `@deepseek-ai/dsh-tool-call-timeout-policy`（base 默认挂载）：读 `ctx.tools.get(exec.name, exec.agent)?.timeoutMs`，到期 abort 派生 signal，body 收敛后把结果换成 `Error: tool call timed out after <ms>ms`（`dsh-tool-call-timeout-policy/README.md`）。
* `bash` 故意不受该策略管（自己有 `BASH_TIMEOUT`）。超过 ~1 分钟的操作，正解是 `ctx.jobs`（见 §6）。

### 4.3 权限审批

三种做法：

**(a) 让整次调用需要用户点同意（推荐）** —— `tools/pre-execute` 返回 `ask`：

```js
ctx.on('tools/pre-execute', async (exec, next) => {
  if (exec.name === 'mc_stop' || (exec.name === 'mc_plugins' && exec.arguments.action === 'remove'))
    return { kind: 'ask', reason: `Allow "${exec.name}" to change the running Paper server?` }
  return next()
})
```

管线的处理（`dsh-tools/lib/types/index.js:1102 serviceAsk`）：无 `ctx.approval` → deny；有 → `approval.request({agent, toolName, callId, reason, signal})`，outcome `allowed-once | rejected | cancelled | unavailable` → allow / deny（`the user rejected tool "x"`）/ deny（`approval for tool "x" was cancelled`）/ deny（`no approval channel is available`）。

实测（无 approval 服务，带 reason）→ `Error: may I run "stop" on the server?`；不写 reason 时是 `tool "x" requires approval (not yet supported)`。

**(b) 在 execute 里主动问**：

```js
const outcome = await ctx.approval.request({
  agent: exec.agent, toolName: exec.name, callId: exec.callId,
  reason: 'overwrite server.properties', displayReason: '要修改服务器配置吗？',
  signal: exec.signal,
})
if (outcome !== 'allowed-once') throw new Error('user declined the server.properties change')
```
要求**当前有打开的 turn**（否则抛错，`dsh-user-approval/lib/index.js:128`）；`policy: never` 时直接拒绝，不问人；headless 无 answerer 时 `unavailable`（fail-closed）。

**(c) 硬拒绝**：`ctx.tools.guard(exec => string | undefined)`（`index.js:531`），同步、单调（一旦某个 guard 返回原因，后续监听器无法翻案）。实测：

```js
ctx.tools.guard((exec) =>
  exec.name === 'mc_command' && /^\s*op\b/.test(exec.arguments.command ?? '')
    ? 'refusing to grant operator via mc_command; edit ops.json instead' : undefined)
// → Error: refusing to grant operator …
```

> `dsh-authorization` **不是**权限审批，它是"拿凭据（OAuth/一次性 code）"的流程注册表；权限审批 = `dsh-user-approval` 的 `ctx.approval`。

### 4.4 文件策略提醒

插件的宿主代码用 `node:fs` 直接读写 **不会** 被 DSH 的 file sandbox 约束（sandbox 在 `ctx.fs`/`fs-sandbox` 与 bash-sandbox 里强制）。想遵守工作区策略就用 `ctx.fs`（`writeText`/`editText`/`readText`…，`dsh-fs/README.md`）。服务器目录通常在 workspace 之外，用 `node:fs` 是合理的，但要在工具描述里讲明白。

---

## 5. 最小工具定义摘录（并更正包名）

⚠️ **更正**：`dsh-bash-local` 是 **执行器**（`ctx.shell` 的 Service Provider，`dsh-bash-local/lib/index.js:67 LocalBashExecutor`），里面**没有**工具定义。模型看到的 `bash` 工具在 **`dsh-tool-bash/lib/index.js`**（`defineTool` 在 `:492`，注册在 `:716`）。

同族包名（grep 结果）：

| 工具名 | 包 | 注册位置 |
|---|---|---|
| `bash` | `@deepseek-ai/dsh-tool-bash` | `lib/index.js:492 / 716` |
| `read` / `write` / `edit` / `read_image` | `@deepseek-ai/dsh-tool-fs` | `lib/index.js:251 / 549 / 690 / 986` |
| `glob` / `grep` | `@deepseek-ai/dsh-tool-fs-search` | `lib/index.js:782 / 1090` |
| `job_output` / `job_list` / `job_kill` | `@deepseek-ai/dsh-tool-jobs` | `lib/index.js:298 / 348 / 368` |

从 `dsh-tool-bash/lib/index.js` 摘出的最小骨架（去掉 jobs/sandbox，保留形状）：

```js
import { TOOL_ABORTED, defineTool } from '@deepseek-ai/dsh-tools'
import { HarnessError } from '@deepseek-ai/dsh-llm'

function apply(ctx, config) {
  ctx.tools.register(defineTool({
    name: 'bash',
    description: 'Execute a bash command (`bash -c`) and return its stdout/stderr. …',
    parameters: {
      description: { type: 'string', required: true, description: 'Clear, concise description … 5-10 words (shown in the UI).' },
      command:     { type: 'string', required: true, description: 'The bash command to execute.' },
      timeoutMs:   { type: 'number', description: 'Timeout in milliseconds. …' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { /* … */ } },
      render: (_args, value) => [{ type: 'text', text: value.kind === 'background' ? `started background job ${value.jobId}` : renderResult(value) }],
      presentationMeta: (_args, value) => ({ cwd: value.cwd }),
    },
    async execute(args, exec) {
      const result = await (await ctx.shell.execute(spec)).result()
      if (result.aborted) throw toolAborted()
      return { kind: 'foreground', ...canonicalBashResult(result, spec.workdir) }
    },
    presentCall: presentBashCall,
    presentResult: presentBashResult,
  }))
  // ctx.systemPrompt.section({ name: 'tool:bash', order: ctx.systemPrompt.getSectionOrder('TOOL_BASH'), text: 'Check the [exit code: N] marker …' })
}
function toolAborted() {                       // :318
  const error = new HarnessError('tool call aborted', TOOL_ABORTED)
  error.name = 'AbortError'
  return error
}
export { apply, inject, name }
```

必需 import / ctx 名称：
`defineTool`、`TOOL_ABORTED`（`@deepseek-ai/dsh-tools`）、`HarnessError`（`@deepseek-ai/dsh-llm`）、`z`（`@deepseek-ai/schemastery`，做 Config）；`ctx.tools`、`ctx.systemPrompt`、（可选）`ctx.shell`、`ctx.jobs`、`ctx.approval`、`ctx.attachments`。

---

## 6. 命令（`/compact` 那类）与 skill

### 6.1 命令：`ctx.commands.register`

**命令不进模型上下文**，是给人用的（`dsh-commands/README.md`）。适合 `/mc start`、`/mc backup`。

```js
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'

// dsh-command-compact/lib/index.js:93 是范本
ctx.commands.register({
  definitionId: CommandDefinitionId('dsh-minecraft-manager'),  // 可选，稳定身份
  name: 'mc',                       // 小写；^[a-z0-9_-]+$
  description: 'Manage the local Paper server',
  input: { hint: 'start|stop|status|backup' },   // 可选；input.attachments 可声明接收图片/文件
  handler: async ({ agent, rawInput, signal }) => {
    // 直接对 agent 执行，不产生模型消息
    return { kind: 'success', text: 'server started' }   // 或 { kind: 'error', text: '…' }
  },
})
```

* handler 收到 `{ agent, rawInput, signal, commandId, attachments? }`，返回 `{kind:'success'|'error', text, sourceEventSeq?}`。
* 同名在一个 scope 内重复注册会抛；全局 vs `agent.ctx` 作用域可覆盖（shadow）。
* 需要 `dsh-commands` + UI 适配器（`dsh-client-ui-commands`）。

### 6.2 skill：`ctx.skills.register`

适合把"这台服务器怎么管"写成可被模型按需加载的操作手册（不占常驻 prompt）。

```js
// 需要 dsh-skill + dsh-tool-skill；runtime skill 是全局层，name 必须 kebab-case
const dispose = ctx.skills.register({
  name: 'minecraft-ops',
  description: 'Operate the local Paper server: start/stop, console commands, plugin jars, backups, server.properties.',
  whenToUse: 'Use whenever the user asks to run, inspect, back up, or reconfigure the local Minecraft Paper server.',
  content: `# Minecraft Paper 运维手册\n\n1. 先 mc_status …\n2. 停服用 mc_stop，等 "Stopping server" …\n`,
  source: 'builtin',                 // 必填字符串（会进 catalog）
  invocation: { modelInvocable: true, userInvocable: true },  // 可选，默认都是 true
})
```

校验（`dsh-skill/lib/index.js:465 validateRuntimeSkill` + `471 validateDefinition`）：`name` 必须匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`，`description` 非空，`content` 必须字符串，`source` 必须字符串；同层同名 first-wins（后者警告 + no-op disposer）。

模型侧由 `dsh-tool-skill` 提供 `skill` 工具 + 一份 **durable catalog**（首请求前注入：名字 + ≤500 字符描述），模型点名后才加载正文；用户也可以 `/skill-name` 直接注入。所以 skill 正文不占常驻上下文。

需要"带资源目录/文件预览"的 skill 时改用 `ctx.skills.registerProvider(() => ({ name:'dsh-minecraft', list, get }))`（范本：`dsh-skill-office/lib/index.js:44-101`，`resourceBase: {kind:'directory', path}`）。

> 实测组合建议：**短约束写进 `ctx.systemPrompt.section`（常驻、最可靠）+ 长手册写成 skill（按需加载）+ 每个工具的描述写清前置条件**。三处都做，不要只做一处。

### 6.3 常驻 prompt 段落

```js
ctx.systemPrompt.section({
  name: 'tool:minecraft',
  order: 1500,                      // 第三方可用任意有限数；第一方用 getSectionOrder('TOOL_BASH') 之类
  text: 'The mc_* tools manage one local Paper server. Check mc_status before start/stop; never start a second server. …',
})
```

实测：段落出现在 `ctx.systemPrompt.assemble().sections` 里（`harness:identity` 之后、`deployment:persona-suffix` 之前），工具 schema 也会自动进 `assemble().tools`。

---

## 7. 长任务：用 `ctx.jobs` 而不是硬扛

```js
const id = ctx.jobs.start({
  kind: 'bash',                         // 现有 UI 只认内置 kind 的展示；自定义 kind 会显示为通用 job
  label: 'paper server',
  toolCall: { callId: exec.callId, rootCallId: exec.rootCallId },  // 可选，卡片关联
  owner: exec.agent?.id,                // 归属 agent session
  output: [{ channel: 'stdout', read: (fromByte) => ({ text, nextOffset, lossy: false }) }],  // 可选拉取源
  run: (handle) => {
    handle.append('starting…', { channel: 'stdout' })   // 'stdout' | 'stderr' | 'log'（log 只给观察者，不进模型）
    handle.updateProgress('loading 1/3 worlds')
    return { done, cancel: (reason) => { /* kill */ } }
  },
})
```

`start()` 的语义与字段：`dsh-jobs-local/lib/index.js:412`；模型侧用自带的 `job_output` / `job_list` / `job_kill`（`dsh-tool-jobs`）。**注意**：`start()` 要求该 owner 有 controller（`dsh-tool-jobs` 挂载时提供），否则抛错。

对本项目：Minecraft 服务器进程本身就是长驻进程，**不要**把它注册成一个 job（job 的语义是"会结束的后台任务"，且 job 随进程退出而丢失）；把"启动中等待"、"备份"、"从 Modrinth 下载"这类**有限步骤**注册成 job 更合适。

---

## 8. 可直接照抄的骨架

完整可运行版本（411 行，已实测）：[`docs/examples/mc-tools-skeleton.mjs`](examples/mc-tools-skeleton.mjs)

覆盖：`mc_status` / `mc_start` / `mc_command` / `mc_stop` / `mc_plugins` / `mc_backup` / `mc_properties`，包含
`child_process.spawn` + readline 收集 console、`waitFor(Done)`、stdin 写命令、优雅停服、插件 jar 装卸、`save-off/save-all flush` 备份、properties 备份写回、teardown 停服。

实测记录（用假 `java` 脚本模拟 Paper）：

```
--- mc_start server started (pid 71936)
--- mc_command > list
--- mc_status running (pid 71936, up 4s)
--- mc_start ERROR: Error: server already running (pid 71936)
--- mc_stop server stopped (exit code 0, signal null)
--- mc_status not running
```

装配（本仓库已有 `cordis.patch.yml`，profile 侧只需两行）：

```jsonc
// <profile>/package.json
"dependencies": { "dsh-minecraft-manager": "link:../../work/mc-server/dsh-minecraft-manager" },
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-minecraft-manager"] } }
```

```yaml
# <profile>/cordis.patch.yml
- id: minecraft-manager
  name: dsh-minecraft-manager
  config:
    serverDir: /Users/mamawhes/work/mc-server/server
    javaArgs: ['-Xms2G', '-Xmx4G', '-jar', 'server.jar', 'nogui']
```

Config 用 schemastery 声明，Cordis 通过 standard-schema 校验（`cordis/lib/index.js:956 resolveConfig`）：

```js
export const Config = z.object({
  serverDir: z.string().min(1),
  javaBin: z.string().default('java'),
  javaArgs: z.array(z.string()).default(['-Xms2G', '-Xmx4G', '-jar', 'server.jar', 'nogui']),
  startTimeoutMs: z.number().default(180_000),
})
```

> 非 `.volatile()` 字段是普通值（直接 `config.serverDir`）；只有 `volatile()` 字段才是 Ref（`.get()`）。参照 `dsh-bash-local` 的 Config 与 `dsh-tool-bash` 的用法差异。

---

## 9. 实测记录（可复现）

环境：`/tmp/mc-probe`，`node_modules` 软链到 `/tmp/dsh-app/dsh/node_modules`。

```js
const ctx = new Context()
ctx.plugin(SystemPrompt)     // @deepseek-ai/dsh-system-prompt 默认导出类
ctx.plugin(ToolRuntime)      // @deepseek-ai/dsh-tools 默认导出类
ctx.plugin(mc, { serverDir: '/tmp/mc-probe/srv' })
```

1. **注册与执行**：`ctx.tools.schemas()` 返回模型可见 schema；`ctx.tools.execute({callId,name,arguments,signal})` 返回
   `{isError:false, content:[{type:'text',text:'…'}], meta:{…}, value:{…}}`。
2. **参数校验**：缺必填 → `{isError:true, error:{message:'invalid arguments: missing required property "description"', info:{name:'ToolArgsError', code:'INVALID_ARGS'}}}`。
3. **未注册工具**：`UNKNOWN_TOOL`；disposer 之后同名字调用也变 `UNKNOWN_TOOL`。
4. **取消**：`signal` 已 abort → `ABORTED_BEFORE_DISPATCH`、`Error: tool call aborted before dispatch`。
5. **ask 无审批通道**：`Error: <reason>`（reason 来自 ask）。
6. **guard**：返回字符串 → `Error: <reason>`。
7. **prompt 段落**：`ctx.systemPrompt.assemble().sections` 含 `tool:minecraft`；`tools` 含 `mc_*`。
8. **真实进程生命周期**：spawn 假 java → 读到 `Done (0.312s)!` → `mc_command list` 拿到回显 → `mc_stop` 退出码 0。
