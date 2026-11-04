/**
 * Browser half of the Minecraft manager.
 *
 * This file is a classic script served by dsh-client-modules and must use the
 * `window.__ModuleLoader__.load({ id, factory })` format. The id is the package
 * name. React comes from the shell's shared module table; everything else is
 * either inline or fetched from the plugin's own host routes under mc/api.
 */
window.__ModuleLoader__.load({
  id: 'dsh-mc-server-manager',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const module = { exports: {} }
    const exports = module.exports

    const PANEL_ID = 'minecraft-manager'

    // ── styles ─────────────────────────────────────────────────────────────
    const CSS = `
.mcm-root{display:flex;height:100%;min-height:0;background:var(--dsw-alias-bg-base,#111318);color:var(--dsw-alias-label-primary,#e7e9ee);font-family:inherit;font-size:13px}
.mcm-side{width:250px;flex:none;display:flex;flex-direction:column;border-right:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08));background:var(--dsw-alias-bg-layer-1,#171a20);min-height:0}
.mcm-side-head{padding:14px 14px 8px;display:flex;align-items:center;gap:8px}
.mcm-side-title{font-size:13px;font-weight:600;letter-spacing:.2px;flex:1}
.mcm-side-sub{padding:0 14px 10px;color:var(--dsw-alias-label-tertiary,#8b909a);font-size:11.5px;line-height:1.5}
.mcm-list{flex:1;overflow:auto;padding:2px 8px 12px}
.mcm-server{display:block;width:100%;text-align:left;border:0;background:transparent;color:inherit;padding:9px 10px;border-radius:8px;cursor:pointer;margin-bottom:2px}
.mcm-server:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.05))}
.mcm-server.is-active{background:var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.09))}
.mcm-server-row{display:flex;align-items:center;gap:8px;min-width:0}
.mcm-server-name{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mcm-server-meta{margin-top:3px;padding-left:14px;color:var(--dsw-alias-label-tertiary,#8b909a);font-size:11px;display:flex;gap:8px}
.mcm-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary,#6b7280)}
.mcm-dot.is-running{background:var(--dsw-alias-state-success-primary,#35c26b)}
.mcm-dot.is-starting{background:var(--dsw-alias-state-warn-primary,#e2a03f)}
.mcm-dot.is-stopping{background:var(--dsw-alias-state-warn-primary,#e2a03f)}
.mcm-main{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}
.mcm-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--dsw-alias-label-secondary,#b3b8c2);padding:32px;text-align:center}
.mcm-empty h2{margin:0;font-size:18px;font-weight:600;color:var(--dsw-alias-label-primary,#e7e9ee)}
.mcm-empty p{margin:0;max-width:420px;line-height:1.7;font-size:12.5px}
.mcm-header{padding:14px 18px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06));display:flex;flex-direction:column;gap:10px;flex:none}
.mcm-header-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.mcm-title{font-size:16px;font-weight:600;margin:0}
.mcm-chip{font-size:11px;padding:2px 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#1f232b);color:var(--dsw-alias-label-secondary,#b3b8c2);white-space:nowrap}
.mcm-chip.ok{color:var(--dsw-alias-state-success-primary,#35c26b);background:rgba(53,194,107,.12)}
.mcm-chip.warn{color:var(--dsw-alias-state-warn-label,#e2a03f);background:rgba(226,160,63,.12)}
.mcm-actions{display:flex;gap:6px;margin-left:auto;flex-wrap:wrap}
.mcm-tabs{display:flex;gap:2px;padding:0 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06));flex:none;overflow-x:auto}
.mcm-tab{border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#8b909a);padding:9px 12px;font-size:12.5px;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}
.mcm-tab:hover{color:var(--dsw-alias-label-primary,#e7e9ee)}
.mcm-tab.is-active{color:var(--dsw-alias-label-primary,#e7e9ee);border-bottom-color:var(--dsw-alias-brand-primary,#5b8cff)}
.mcm-body{flex:1;overflow:auto;padding:16px 18px 28px;min-height:0}
.mcm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}
.mcm-card{background:var(--dsw-alias-bg-layer-1,#171a20);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07));border-radius:10px;padding:13px 14px}
.mcm-card h3{margin:0 0 8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#b3b8c2);letter-spacing:.3px}
.mcm-kv{display:grid;grid-template-columns:auto 1fr;gap:5px 10px;font-size:12px;line-height:1.6}
.mcm-kv dt{color:var(--dsw-alias-label-tertiary,#8b909a)}
.mcm-kv dd{margin:0;word-break:break-all;color:var(--dsw-alias-label-primary,#e7e9ee)}
.mcm-btn{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));background:var(--dsw-alias-bg-layer-2,#1f232b);color:var(--dsw-alias-label-primary,#e7e9ee);border-radius:7px;padding:5px 10px;font-size:12px;cursor:pointer;line-height:1.4}
.mcm-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07))}
.mcm-btn:disabled{opacity:.45;cursor:not-allowed}
.mcm-btn.primary{background:var(--dsw-alias-button-primary-fill,#3b6cf0);border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff)}
.mcm-btn.primary:hover{background:var(--dsw-alias-button-primary-hover,#4c7bff)}
.mcm-btn.danger{color:var(--dsw-alias-state-error-primary,#ef5f5f);border-color:rgba(239,95,95,.35)}
.mcm-btn.ghost{background:transparent;border-color:transparent}
.mcm-btn.icon{padding:5px 7px}
.mcm-banner{margin:10px 18px 0;padding:9px 12px;border-radius:8px;font-size:12px;line-height:1.6;display:flex;gap:10px;align-items:center}
.mcm-banner.warn{background:rgba(226,160,63,.12);color:var(--dsw-alias-state-warn-label,#e2a03f);border:1px solid rgba(226,160,63,.25)}
.mcm-banner.err{background:rgba(239,95,95,.1);color:var(--dsw-alias-state-error-primary,#ef5f5f);border:1px solid rgba(239,95,95,.25)}
.mcm-banner .grow{flex:1}
.mcm-table{width:100%;border-collapse:collapse;font-size:12px}
.mcm-table th{ text-align:left;color:var(--dsw-alias-label-tertiary,#8b909a);font-weight:500;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07));white-space:nowrap}
.mcm-table td{padding:7px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.05));vertical-align:middle}
.mcm-table tr:hover td{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.03))}
.mcm-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
.mcm-muted{color:var(--dsw-alias-label-tertiary,#8b909a)}
.mcm-input,.mcm-select,.mcm-textarea{background:var(--dsw-alias-bg-base,#111318);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:7px;color:var(--dsw-alias-label-primary,#e7e9ee);padding:6px 9px;font-size:12.5px;outline:none;min-width:0}
.mcm-input:focus,.mcm-select:focus,.mcm-textarea:focus{border-color:var(--dsw-alias-brand-primary,#5b8cff)}
.mcm-form-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.mcm-field{display:flex;flex-direction:column;gap:5px;margin-bottom:12px}
.mcm-field label{font-size:12px;color:var(--dsw-alias-label-secondary,#b3b8c2)}
.mcm-hint{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8b909a);line-height:1.6}
.mcm-console{background:#0b0d11;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:9px;display:flex;flex-direction:column;height:calc(100vh - 290px);min-height:260px;overflow:hidden}
.mcm-console-out{flex:1;overflow:auto;padding:10px 12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word;color:#cfd6e4}
.mcm-console-line.err{color:#f19a9a}
.mcm-console-line.sent{color:#7fb0ff}
.mcm-console-bar{border-top:1px solid rgba(255,255,255,.08);display:flex;gap:6px;padding:8px}
.mcm-console-bar input{flex:1;background:#11151b;border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#e7e9ee;padding:6px 9px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;outline:none}
.mcm-settings{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px 18px}
.mcm-prop{display:flex;flex-direction:column;gap:4px}
.mcm-prop label{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8b909a)}
.mcm-prop .mcm-mono{color:var(--dsw-alias-label-secondary,#b3b8c2)}
.mcm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:1200;padding:20px}
.mcm-modal{background:var(--dsw-alias-bg-layer-2,#1b1f27);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.45);width:min(560px,100%);max-height:88vh;display:flex;flex-direction:column}
.mcm-modal-head{padding:14px 16px 10px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07))}
.mcm-modal-head h3{margin:0;font-size:14px;flex:1}
.mcm-modal-body{padding:14px 16px;overflow:auto}
.mcm-modal-foot{padding:10px 16px 14px;display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06))}
.mcm-toast{position:fixed;right:20px;bottom:20px;z-index:1300;max-width:420px;padding:10px 14px;border-radius:9px;font-size:12.5px;line-height:1.5;background:var(--dsw-alias-toast-bg,#262b35);color:var(--dsw-alias-toast-label,#e7e9ee);box-shadow:0 8px 30px rgba(0,0,0,.35);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12))}
.mcm-toast.err{border-color:rgba(239,95,95,.5);color:#ffb4b4}
.mcm-spinner{width:14px;height:14px;border:2px solid rgba(255,255,255,.2);border-top-color:#fff;border-radius:50%;animation:mcm-spin .8s linear infinite;display:inline-block;vertical-align:-2px}
@keyframes mcm-spin{to{transform:rotate(360deg)}}
.mcm-inline{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.mcm-section-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#b3b8c2);margin:18px 0 8px}
.mcm-section-title:first-child{margin-top:0}
.mcm-rule{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.04))}
.mcm-rule label{width:200px;flex:none;font-size:12px;color:var(--dsw-alias-label-secondary,#b3b8c2)}
.mcm-rule .mcm-mono{flex:0 0 150px;color:var(--dsw-alias-label-tertiary,#8b909a);font-size:11px}
.mcm-rule .grow{flex:1}
`

    function injectStyles() {
      if (typeof document === 'undefined') return
      const id = 'dsh-mc-server-manager/styles.css'
      if (document.querySelector(`style[data-plugin-css="${id}"]`) !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-mc-server-manager'
      tag.dataset.pluginCss = id
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    // ── tiny utilities ─────────────────────────────────────────────────────
    function req(segments, options = {}) {
      const url = 'mc/api/' + segments.map((segment) => encodeURIComponent(String(segment))).join('/')
      const headers = { accept: 'application/json' }
      if (options.body !== undefined) headers['content-type'] = 'application/json'
      return fetch(url, {
        method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        credentials: 'same-origin',
        signal: options.signal,
      }).then(async (response) => {
        let data = null
        try {
          data = await response.json()
        } catch {
          data = null
        }
        if (!response.ok) {
          const message = data?.error?.message ?? `HTTP ${response.status}`
          const error = new Error(message)
          error.code = data?.error?.code
          throw error
        }
        return data
      })
    }

    function formatBytes(bytes) {
      const value = Number(bytes) || 0
      if (value <= 0) return '0 B'
      const units = ['B', 'KB', 'MB', 'GB', 'TB']
      const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))
      return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
    }

    function formatUptime(ms) {
      const value = Number(ms) || 0
      if (value <= 0) return '—'
      const totalSeconds = Math.floor(value / 1000)
      const days = Math.floor(totalSeconds / 86400)
      const hours = Math.floor((totalSeconds % 86400) / 3600)
      const minutes = Math.floor((totalSeconds % 3600) / 60)
      if (days > 0) return `${days} 天 ${hours} 小时`
      if (hours > 0) return `${hours} 小时 ${minutes} 分`
      if (minutes > 0) return `${minutes} 分 ${totalSeconds % 60} 秒`
      return `${totalSeconds} 秒`
    }

    function formatTime(value) {
      if (value === null || value === undefined || value === '') return '—'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return String(value)
      return date.toLocaleString('zh-CN', { hour12: false })
    }

    const STATE_TEXT = { stopped: '已停止', starting: '启动中', running: '运行中', stopping: '停止中' }
    const STATUS_CHIP_CLASS = { stopped: 'warn', starting: 'warn', running: 'ok', stopping: 'warn' }

    const AGENT_ACTIONS = [
      ['status', '检查状态'],
      ['start', '启动'],
      ['stop', '停止'],
      ['backup', '备份世界'],
      ['plugins', '查看插件'],
      ['settings', '查看参数'],
    ]

    /** A concrete instruction the Agent can act on without further context. */
    function agentPrompt(detail, action) {
      const state = STATE_TEXT[detail.status?.state] ?? '未知'
      const head = `Minecraft 服务器「${detail.name}」（server id: ${detail.id}，Paper ${detail.mcVersion}，当前${state}）。`
      const tail = {
        manage: '请接管它的日常管理：先用 mc_server_status 检查状态，然后告诉我你建议的下一步；需要操作时直接调用 mc_* 工具。',
        status: '请用 mc_server_status 检查它的运行状态和在线玩家，并简要汇报。',
        start: '请用 mc_start_server 启动它，启动后确认状态（必要时用 mc_server_status）并汇报。',
        stop: '请用 mc_stop_server 优雅停止它，并确认进程已经退出。',
        backup: '请用 mc_backup_world 备份主世界，完成后汇报备份文件名和大小。',
        plugins: '请用 mc_list_plugins 列出它已安装的插件、版本与启用状态。',
        settings: '请用 mc_get_properties 和 mc_get_gamerules 读取它的主要配置与常用游戏规则，并总结关键设置。',
      }[action]
      return head + (tail ?? '请先检查它的状态，再按我的需求操作。')
    }

    /**
    * Deliver an instruction to the conversation the user is looking at. When a
    * session is open the message is queued there and the view switches to it;
    * otherwise a new session opens with the instruction prefilled.
    */
    async function sendToAgent(agent, notify, text) {
      try {
        const result = await agent.send(text)
        if (result.kind === 'sent') notify('已发送到当前对话')
        else if (result.kind === 'opened') notify('已打开新会话并填入指令，按发送即可')
        else notify('对话功能不可用', 'err')
        return result.kind
      } catch (caught) {
        notify(caught.message, 'err')
        return 'failed'
      }
    }

    const PROPERTY_LABELS = {
      motd: '服务器标语 (MOTD)',
      'server-port': '端口',
      'max-players': '最大玩家数',
      'online-mode': '正版验证',
      'white-list': '白名单',
      'enforce-whitelist': '强制白名单',
      difficulty: '难度',
      gamemode: '默认游戏模式',
      'force-gamemode': '强制游戏模式',
      pvp: '允许 PvP',
      hardcore: '极限模式',
      'level-name': '世界名',
      'level-seed': '世界种子',
      'level-type': '世界类型',
      'view-distance': '视距',
      'simulation-distance': '模拟距离',
      'spawn-protection': '出生点保护半径',
      'allow-flight': '允许飞行',
      'allow-nether': '允许下界',
      'enable-command-block': '启用命令方块',
      'spawn-monsters': '生成怪物',
      'generate-structures': '生成结构',
      'enable-status': '服务器列表状态',
      'hide-online-players': '隐藏在线玩家',
      'network-compression-threshold': '网络压缩阈值',
      'player-idle-timeout': '挂机踢出（分钟）',
      'op-permission-level': 'OP 权限等级',
      'function-permission-level': '函数权限等级',
      'max-tick-time': '最大 tick 时间',
      'rate-limit': '限速',
      'entity-broadcast-range-percentage': '实体广播距离%',
      'resource-pack': '资源包 URL',
      'resource-pack-sha1': '资源包 SHA1',
      'require-resource-pack': '强制资源包',
      'prevent-proxy-connections': '阻止代理连接',
      'broadcast-console-to-ops': '向 OP 广播控制台',
      'broadcast-rcon-to-ops': '向 OP 广播 RCON',
      'enable-rcon': '启用 RCON',
      'rcon.port': 'RCON 端口',
      'enable-query': '启用 Query',
      'query.port': 'Query 端口',
      debug: '调试日志',
    }

    const PROPERTY_ENUMS = {
      difficulty: ['peaceful', 'easy', 'normal', 'hard'],
      gamemode: ['survival', 'creative', 'adventure', 'spectator'],
    }

    function propertyKind(key, value) {
      if (PROPERTY_ENUMS[key] !== undefined) return 'enum'
      if (value === 'true' || value === 'false') return 'bool'
      if (/^-?\d+$/.test(String(value ?? ''))) return 'int'
      return 'text'
    }

    // ── icons ──────────────────────────────────────────────────────────────
    function Svg({ size = 16, children, viewBox = '0 0 16 16' }) {
      return h('svg', { width: size, height: size, viewBox, fill: 'none', 'aria-hidden': true, style: { display: 'block' } }, children)
    }

    function IconCube({ size = 18 }) {
      return h(Svg, { size }, h('path', { d: 'M8 1.6 14 4.8v6.4L8 14.4 2 11.2V4.8L8 1.6Z', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' }),
        h('path', { d: 'M2.3 4.9 8 8l5.7-3.1M8 8v6.2', stroke: 'currentColor', strokeWidth: 1.1, strokeLinejoin: 'round', opacity: 0.75 }))
    }
    function IconPlay({ size = 14 }) {
      return h(Svg, { size }, h('path', { d: 'M4.5 2.8v10.4L13 8 4.5 2.8Z', fill: 'currentColor' }))
    }
    function IconStop({ size = 14 }) {
      return h(Svg, { size }, h('rect', { x: 3.6, y: 3.6, width: 8.8, height: 8.8, rx: 1.4, fill: 'currentColor' }))
    }
    function IconRestart({ size = 14 }) {
      return h(Svg, { size }, h('path', { d: 'M13 8a5 5 0 1 1-1.6-3.7', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }), h('path', { d: 'M13 2.6v3.2H9.8', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }
    function IconPlus({ size = 14 }) {
      return h(Svg, { size }, h('path', { d: 'M8 3v10M3 8h10', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }))
    }
    function IconTrash({ size = 14 }) {
      return h(Svg, { size }, h('path', { d: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.6 4.5l.6 8.4h5.6l.6-8.4', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }
    function IconRefresh({ size = 14 }) {
      return h(Svg, { size }, h('path', { d: 'M13 8a5 5 0 1 1-1.5-3.6M13 2.8v3H10', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }
    function IconChat({ size = 14 }) {
      return h(Svg, { size }, h('path', { d: 'M2.6 3.4h10.8v7.2H7.4L4.2 13v-2.4H2.6V3.4Z', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' }))
    }
    function IconPackage({ size = 14 }) {
      return h(Svg, { size }, h('path', { d: 'M8 1.8 13.5 4.6v6.8L8 14.2 2.5 11.4V4.6L8 1.8Z', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' }), h('path', { d: 'M2.7 4.7 8 7.4l5.3-2.7M8 7.4v6.5', stroke: 'currentColor', strokeWidth: 1, opacity: 0.7 }))
    }

    // ── small controls ─────────────────────────────────────────────────────
    function Button({ children, onClick, variant = 'default', disabled = false, title, style }) {
      return h('button', {
        type: 'button',
        className: `mcm-btn${variant === 'default' ? '' : ` ${variant}`}`,
        onClick,
        disabled,
        title,
        style,
      }, children)
    }

    function Chip({ children, tone }) {
      return h('span', { className: `mcm-chip${tone === undefined ? '' : ` ${tone}`}` }, children)
    }

    function Field({ label, hint, children }) {
      return h('div', { className: 'mcm-field' }, h('label', null, label), children, hint === undefined ? null : h('div', { className: 'mcm-hint' }, hint))
    }

    function Modal({ title, children, footer, onClose, width }) {
      return h('div', { className: 'mcm-overlay', onMouseDown: (event) => { if (event.target === event.currentTarget) onClose?.() } },
        h('div', { className: 'mcm-modal', style: width === undefined ? undefined : { width } },
          h('div', { className: 'mcm-modal-head' }, h('h3', null, title), h(Button, { variant: 'ghost icon', onClick: onClose, title: '关闭' }, '✕')),
          h('div', { className: 'mcm-modal-body' }, children),
          footer === undefined ? null : h('div', { className: 'mcm-modal-foot' }, footer)))
    }

    function ConfirmDialog({ title, message, confirmLabel = '确认', danger = false, busy = false, onConfirm, onClose, children }) {
      return h(Modal, {
        title,
        onClose: busy ? undefined : onClose,
        footer: [
          h(Button, { key: 'cancel', onClick: onClose, disabled: busy }, '取消'),
          h(Button, { key: 'ok', variant: danger ? 'danger' : 'primary', onClick: onConfirm, disabled: busy }, busy ? '处理中…' : confirmLabel),
        ],
      }, h('div', { style: { lineHeight: 1.7 } }, message), children ?? null)
    }

    function Toast({ notice, onDismiss }) {
      React.useEffect(() => {
        const timer = setTimeout(onDismiss, notice.kind === 'err' ? 7000 : 4000)
        return () => clearTimeout(timer)
      }, [notice, onDismiss])
      return h('div', { className: `mcm-toast${notice.kind === 'err' ? ' err' : ''}`, onClick: onDismiss }, notice.message)
    }

    // ── main panel ─────────────────────────────────────────────────────────
    function Panel(props) {
      const agent = props.agent
      const [meta, setMeta] = React.useState(null)
      const [servers, setServers] = React.useState([])
      const [selectedId, setSelectedId] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState(null)
      const [creationOpen, setCreationOpen] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const [versions, setVersions] = React.useState(null)

      const notify = React.useCallback((message, kind = 'ok') => setNotice({ message, kind, key: Date.now() }), [])

      const refresh = React.useCallback(async (signal) => {
        try {
          const data = await req(['servers'], { signal })
          setServers(data.servers ?? [])
          setError(null)
          setLoading(false)
          return data.servers ?? []
        } catch (caught) {
          if (signal?.aborted) return null
          setError(caught.message)
          setLoading(false)
          return null
        }
      }, [])

      React.useEffect(() => {
        const controller = new AbortController()
        void refresh(controller.signal)
        const timer = setInterval(() => void refresh(controller.signal), 5000)
        return () => {
          clearInterval(timer)
          controller.abort()
        }
      }, [refresh])

      React.useEffect(() => {
        req(['meta'], {}).then(setMeta).catch(() => {})
      }, [])

      React.useEffect(() => {
        if (selectedId === null && servers.length > 0) setSelectedId(servers[0].id)
        if (selectedId !== null && servers.length > 0 && !servers.some((server) => server.id === selectedId)) setSelectedId(servers[0].id)
      }, [servers, selectedId])

      const openCreate = React.useCallback(async () => {
        setCreationOpen(true)
        req(['meta'], {}).then(setMeta).catch(() => {})
        if (versions === null) {
          try {
            setVersions(await req(['versions']))
          } catch (caught) {
            setVersions({ versions: [], recommended: '26.1.2', offline: true, error: caught.message })
          }
        }
      }, [versions])

      const selected = servers.find((server) => server.id === selectedId) ?? null

      return h('div', { className: 'mcm-root' },
        h('aside', { className: 'mcm-side' },
          h('div', { className: 'mcm-side-head' },
            h('span', { className: 'mcm-side-title' }, 'Minecraft 服务器'),
            h(Button, { variant: 'ghost icon', title: '刷新', onClick: () => void refresh() }, h(IconRefresh, { size: 13 }))),
          h('div', { className: 'mcm-side-sub' }, 'Paper 服务端 · 本机托管 · 可与 Agent 对话管理'),
          h('div', { className: 'mcm-list' },
            servers.map((server) => {
              const state = server.status?.state ?? 'stopped'
              return h('button', {
                key: server.id,
                type: 'button',
                className: `mcm-server${server.id === selectedId ? ' is-active' : ''}`,
                onClick: () => setSelectedId(server.id),
              },
                h('div', { className: 'mcm-server-row' },
                  h('span', { className: `mcm-dot is-${state}` }),
                  h('span', { className: 'mcm-server-name' }, server.name)),
                h('div', { className: 'mcm-server-meta' },
                  h('span', null, `Paper ${server.mcVersion}`),
                  h('span', null, STATE_TEXT[state] ?? state)))
            }),
            servers.length === 0 && !loading ? h('div', { className: 'mcm-hint', style: { padding: '10px 6px' } }, error === null ? '还没有服务器。点击下方按钮新建。' : `加载失败：${error}`) : null),
          h('div', { style: { padding: '10px 12px 14px' } },
            h(Button, { variant: 'primary', onClick: () => void openCreate(), style: { width: '100%', justifyContent: 'center' } }, h(IconPlus, { size: 13 }), '新建服务器'))),

        h('section', { className: 'mcm-main' },
          error === null ? null : h('div', { className: 'mcm-banner err' }, h('span', { className: 'grow' }, `接口错误：${error}`)),
          selected === null
            ? h('div', { className: 'mcm-empty' },
              h('div', { style: { opacity: 0.7 } }, h(IconCube, { size: 42 })),
              h('h2', null, '管理你的 Minecraft 服务器'),
              h('p', null, '在左侧新建或选择一台 Paper 服务器，即可启动/停止、查看控制台、安装插件、备份存档、修改服务器参数与游戏规则。也可以打开对话，让 Agent 用 mc_* 工具帮你管理。'),
              h('div', { className: 'mcm-inline' },
                h(Button, { variant: 'primary', onClick: () => void openCreate() }, h(IconPlus, { size: 13 }), '新建服务器'),
                h(Button, { onClick: () => void refresh() }, h(IconRefresh, { size: 13 }), '刷新列表')))
            : h(ServerDetail, {
              key: selected.id,
              id: selected.id,
              meta,
              agent,
              notify,
              onListChanged: () => void refresh(),
            })),

        creationOpen ? h(CreateServerDialog, {
          meta,
          versions,
          onClose: () => setCreationOpen(false),
          onCreated: (server) => {
            setCreationOpen(false)
            setSelectedId(server.id)
            void refresh()
            notify(`服务器「${server.name}」已创建`)
          },
          notify,
        }) : null,

        notice === null ? null : h(Toast, { key: notice.key, notice, onDismiss: () => setNotice(null) }))
    }

    // ── server detail ──────────────────────────────────────────────────────
    const TABS = [
      ['overview', '概览'],
      ['console', '控制台'],
      ['plugins', '插件'],
      ['worlds', '存档与备份'],
      ['settings', '服务器参数'],
      ['gamerules', '游戏规则'],
      ['java', 'Java 环境'],
    ]

    function ServerDetail({ id, meta, agent, notify, onListChanged }) {
      const [detail, setDetail] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [tab, setTab] = React.useState('overview')
      const [busy, setBusy] = React.useState(null)
      const [players, setPlayers] = React.useState(null)
      const [eulaPrompt, setEulaPrompt] = React.useState(false)
      const [deletePrompt, setDeletePrompt] = React.useState(false)

      const load = React.useCallback(async (signal) => {
        try {
          const data = await req(['servers', id], { signal })
          setDetail(data)
          setError(null)
          return data
        } catch (caught) {
          if (!signal?.aborted) setError(caught.message)
          return null
        }
      }, [id])

      React.useEffect(() => {
        const controller = new AbortController()
        void load(controller.signal)
        const timer = setInterval(async () => {
          try {
            const status = await req(['servers', id, 'status'], { signal: controller.signal })
            setDetail((current) => current === null ? current : { ...current, status: status.status, eulaAccepted: status.eulaAccepted, name: status.name, mcVersion: status.mcVersion })
          } catch {
            /* transient poll failure */
          }
        }, 2000)
        return () => {
          clearInterval(timer)
          controller.abort()
        }
      }, [id, load])

      const act = React.useCallback(async (label, task, successMessage) => {
        setBusy(label)
        try {
          await task()
          await load()
          onListChanged?.()
          if (successMessage !== undefined) notify(successMessage)
          return true
        } catch (caught) {
          if (caught.code === 'EULA_REQUIRED') {
            setEulaPrompt(true)
            notify(caught.message, 'err')
          } else {
            notify(caught.message, 'err')
          }
          return false
        } finally {
          setBusy(null)
        }
      }, [load, notify, onListChanged])

      const status = detail?.status ?? { state: 'stopped' }
      const running = status.state === 'running' || status.state === 'starting'
      const eulaAccepted = detail?.eulaAccepted === true

      const start = () => act('start', () => req(['servers', id, 'start'], { method: 'POST', body: {} }), '启动指令已发送')
      const stop = () => act('stop', () => req(['servers', id, 'stop'], { method: 'POST', body: {} }), '已请求停止服务器')
      const restart = () => act('restart', () => req(['servers', id, 'restart'], { method: 'POST', body: {} }), '已请求重启服务器')

      const refreshPlayers = React.useCallback(async () => {
        try {
          setPlayers(await req(['servers', id, 'players']))
        } catch (caught) {
          notify(caught.message, 'err')
        }
      }, [id, notify])

      React.useEffect(() => {
        setPlayers(null)
        if (running) void refreshPlayers()
      }, [running, refreshPlayers])

      if (detail === null) {
        return h('div', { className: 'mcm-empty' }, error === null ? h('span', null, '加载服务器信息…') : h('span', null, `加载失败：${error}`))
      }

      const acceptEula = () => act('eula', async () => {
        await req(['servers', id, 'eula'], { method: 'POST', body: { accept: true } })
        await load()
      }, '已接受 EULA')

      return h(React.Fragment, null,
        h('header', { className: 'mcm-header' },
          h('div', { className: 'mcm-header-top' },
            h('h2', { className: 'mcm-title' }, detail.name),
            h(Chip, { tone: STATUS_CHIP_CLASS[status.state] ?? 'warn' }, STATE_TEXT[status.state] ?? status.state),
            h(Chip, null, `Paper ${detail.mcVersion}`),
            h(Chip, null, `${detail.memoryMb} MiB`),
            status.pid ? h(Chip, null, `pid ${status.pid}`) : null,
            h('div', { className: 'mcm-actions' },
              running
                ? h(Button, { onClick: () => void stop(), disabled: busy !== null || status.state === 'stopping' }, h(IconStop, { size: 12 }), busy === 'stop' ? '停止中…' : '停止')
                : h(Button, { variant: 'primary', onClick: () => void start(), disabled: busy !== null, title: eulaAccepted ? undefined : '需要先接受 EULA' }, h(IconPlay, { size: 12 }), busy === 'start' ? '启动中…' : '启动'),
              h(Button, { onClick: () => void restart(), disabled: busy !== null || !running }, h(IconRestart, { size: 12 }), '重启'),
              h(Button, {
                onClick: () => void sendToAgent(agent, notify, agentPrompt(detail, 'manage')),
              }, h(IconChat, { size: 12 }), '在对话中管理'))),

        eulaAccepted ? null : h('div', { className: 'mcm-banner warn' },
          h('span', { className: 'grow' }, '尚未接受 Minecraft EULA（最终用户许可协议）。接受后才能启动服务器。'),
          h(Button, { onClick: () => setEulaPrompt(true) }, '阅读并接受')),

        error === null ? null : h('div', { className: 'mcm-banner err' }, h('span', { className: 'grow' }, error)),

        h('nav', { className: 'mcm-tabs' }, TABS.map(([key, label]) => h('button', {
          key,
          type: 'button',
          className: `mcm-tab${tab === key ? ' is-active' : ''}`,
          onClick: () => setTab(key),
        }, label)))),

        h('div', { className: 'mcm-body' },
          tab === 'overview' ? h(OverviewTab, { detail, players, refreshPlayers, running, busy, start, stop, restart, acceptEula, deleteServer: () => setDeletePrompt(true), onListChanged, agent, notify }) : null,
          tab === 'console' ? h(ConsoleTab, { id, running, notify, detail, act }) : null,
          tab === 'plugins' ? h(PluginsTab, { id, detail, running, notify, reload: load, act }) : null,
          tab === 'worlds' ? h(WorldsTab, { id, detail, running, notify, reload: load, act }) : null,
          tab === 'settings' ? h(SettingsTab, { id, detail, running, notify, reload: load }) : null,
          tab === 'gamerules' ? h(GamerulesTab, { id, detail, running, meta, notify }) : null,
          tab === 'java' ? h(JavaTab, { id, detail, notify, reload: load }) : null),

        eulaPrompt ? h(ConfirmDialog, {
          title: '接受 Minecraft EULA',
          message: '启动 Paper 服务器需要同意 Minecraft 最终用户许可协议（EULA）。请确认你已阅读并同意 https://aka.ms/MinecraftEULA 。接受后会在服务器目录写入 eula=true。',
          confirmLabel: '我已阅读并同意',
          busy: busy === 'eula',
          onConfirm: async () => {
            const ok = await acceptEula()
            if (ok) setEulaPrompt(false)
          },
          onClose: () => setEulaPrompt(false),
        }) : null,

        deletePrompt ? h(DeleteServerDialog, {
          server: detail,
          onClose: () => setDeletePrompt(false),
          onDelete: async (name) => {
            const ok = await act('delete', () => req(['servers', id], { method: 'DELETE', body: { confirmName: name } }), '服务器已删除')
            if (ok) {
              setDeletePrompt(false)
              onListChanged?.()
            }
          },
        }) : null)
    }

    // ── overview ───────────────────────────────────────────────────────────
    function OverviewTab({ detail, players, refreshPlayers, running, busy, deleteServer, onListChanged, agent, notify }) {
      const status = detail.status ?? { state: 'stopped' }
      return h(React.Fragment, null,
        h('div', { className: 'mcm-grid' },
          h('div', { className: 'mcm-card' },
            h('h3', null, '运行状态'),
            h('dl', { className: 'mcm-kv' },
              h('dt', null, '状态'), h('dd', null, STATE_TEXT[status.state] ?? status.state),
              h('dt', null, '进程'), h('dd', null, status.pid ? `pid ${status.pid}` : '—'),
              h('dt', null, '已运行'), h('dd', null, running ? formatUptime(status.uptimeMs) : '—'),
              h('dt', null, '上次退出'), h('dd', null, status.lastExit ? `code ${status.lastExit.code ?? 'null'} · ${formatTime(status.lastExit.at)}` : '—'),
              h('dt', null, 'EULA'), h('dd', null, detail.eulaAccepted ? '已接受' : '未接受'))),
          h('div', { className: 'mcm-card' },
            h('div', { className: 'mcm-inline', style: { justifyContent: 'space-between' } },
              h('h3', { style: { margin: 0 } }, '在线玩家'),
              h(Button, { variant: 'ghost icon', title: '刷新玩家', onClick: () => void refreshPlayers(), disabled: !running }, h(IconRefresh, { size: 12 }))),
            players === null
              ? h('div', { className: 'mcm-hint', style: { marginTop: 8 } }, running ? '读取中…' : '服务器未运行')
              : h('div', { style: { marginTop: 8 } },
                h('div', { style: { fontSize: 20, fontWeight: 600 } }, `${players.online} / ${players.max}`),
                h('div', { className: 'mcm-hint', style: { marginTop: 4 } }, players.names.length === 0 ? '暂无玩家在线' : players.names.join('、')))),
          h('div', { className: 'mcm-card' },
            h('h3', null, '服务器信息'),
            h('dl', { className: 'mcm-kv' },
              h('dt', null, 'Minecraft'), h('dd', null, detail.mcVersion),
              h('dt', null, '内存'), h('dd', null, `${detail.memoryMb} MiB`),
              h('dt', null, '目录'), h('dd', { className: 'mcm-mono' }, detail.dir),
              h('dt', null, '创建时间'), h('dd', null, formatTime(detail.createdAt))))),

        h('div', { className: 'mcm-section-title' }, '让 Agent 执行'),
        h('div', { className: 'mcm-card' },
          h('div', { className: 'mcm-inline' },
            AGENT_ACTIONS.map(([action, label]) => h(Button, {
              key: action,
              onClick: () => void sendToAgent(agent, notify, agentPrompt(detail, action)),
            }, label))),
          h('div', { className: 'mcm-hint', style: { marginTop: 8 } },
            '点击后会把一条带服务器上下文的指令发送到当前对话并切到对话页；没有打开的会话时会新建会话并预填指令。')),

        h('div', { className: 'mcm-section-title' }, '服务器内容'),
        h('div', { className: 'mcm-grid' },
          h('div', { className: 'mcm-card' },
            h('h3', null, '插件'),
            h('div', { style: { fontSize: 20, fontWeight: 600 } }, String(detail.plugins?.length ?? 0)),
            h('div', { className: 'mcm-hint', style: { marginTop: 4 } }, (detail.plugins ?? []).map((plugin) => plugin.name).join('、') || '还没有安装插件')),
          h('div', { className: 'mcm-card' },
            h('h3', null, '存档世界'),
            h('div', { style: { fontSize: 20, fontWeight: 600 } }, String(detail.worlds?.length ?? 0)),
            h('div', { className: 'mcm-hint', style: { marginTop: 4 } }, (detail.worlds ?? []).map((world) => world.name).join('、') || '首次启动后生成')),
          h('div', { className: 'mcm-card' },
            h('h3', null, '备份'),
            h('div', { style: { fontSize: 20, fontWeight: 600 } }, String(detail.backups?.length ?? 0)),
            h('div', { className: 'mcm-hint', style: { marginTop: 4 } }, '在「存档与备份」中创建或恢复'))),

        h('div', { className: 'mcm-inline', style: { marginTop: 18 } },
          h(Button, { variant: 'danger', onClick: () => deleteServer(), disabled: busy !== null || running }, h(IconTrash, { size: 12 }), '删除服务器'),
          h('span', { className: 'mcm-hint' }, running ? '停止服务器后才能删除' : '删除会移除服务器目录及所有存档，请先备份')))
    }

    // ── console ────────────────────────────────────────────────────────────
    function ConsoleTab({ id, running, notify, detail }) {
      const [lines, setLines] = React.useState([])
      const [input, setInput] = React.useState('')
      const [sending, setSending] = React.useState(false)
      const cursor = React.useRef(0)
      const outRef = React.useRef(null)
      const stick = React.useRef(true)

      React.useEffect(() => {
        const controller = new AbortController()
        let timer = null
        const poll = async () => {
          try {
            const data = await req(['servers', id, 'console'], { signal: controller.signal })
            if (Array.isArray(data.lines) && data.lines.length > 0) {
              setLines((current) => {
                const next = current.concat(data.lines)
                return next.length > 2500 ? next.slice(next.length - 2500) : next
              })
              cursor.current = data.cursor
            }
          } catch {
            /* keep polling */
          }
        }
        void poll()
        timer = setInterval(poll, 1500)
        return () => {
          clearInterval(timer)
          controller.abort()
        }
      }, [id])

      React.useEffect(() => {
        const element = outRef.current
        if (element !== null && stick.current) element.scrollTop = element.scrollHeight
      }, [lines])

      const send = async (event) => {
        event.preventDefault()
        const command = input.trim()
        if (command === '' || sending) return
        setSending(true)
        try {
          const result = await req(['servers', id, 'command'], { method: 'POST', body: { command } })
          setLines((current) => current.concat([{ seq: -1, text: `> ${command}`, stream: 'sent' }]).concat(
            (result.output ?? []).map((text, index) => ({ seq: -(index + 2), text, stream: 'stdout' }))))
          setInput('')
          stick.current = true
        } catch (caught) {
          notify(caught.message, 'err')
        } finally {
          setSending(false)
        }
      }

      return h('div', null,
        h('div', { className: 'mcm-inline', style: { marginBottom: 8 } },
          h('span', { className: 'mcm-hint' }, running ? '实时输出 · 每 1.5 秒刷新' : '服务器未运行，显示已有日志'),
          h('span', { style: { flex: 1 } }),
          h(Button, { variant: 'ghost', onClick: () => { setLines([]); stick.current = true } }, '清空视图')),
        h('div', { className: 'mcm-console' },
          h('div', {
            className: 'mcm-console-out',
            ref: outRef,
            onScroll: (event) => {
              const element = event.currentTarget
              stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40
            },
          }, lines.length === 0 ? h('div', { className: 'mcm-muted' }, '暂无输出') : lines.map((line, index) => h('div', {
            key: `${line.seq}-${index}`,
            className: `mcm-console-line${line.stream === 'stderr' ? ' err' : line.stream === 'sent' ? ' sent' : ''}`,
          }, line.text))),
          h('form', { className: 'mcm-console-bar', onSubmit: send },
            h('span', { className: 'mcm-muted', style: { padding: '6px 2px' } }, '>'),
            h('input', {
              value: input,
              placeholder: running ? '输入控制台命令，例如 list、gamerule keepInventory true' : '服务器未运行',
              disabled: !running || sending,
              onChange: (event) => setInput(event.target.value),
              spellCheck: false,
            }),
            h(Button, { variant: 'primary', onClick: send, disabled: !running || sending || input.trim() === '' }, sending ? '发送中…' : '发送'))))
    }

    // ── plugins ────────────────────────────────────────────────────────────
    function PluginsTab({ id, detail, running, notify, reload, act }) {
      const [url, setUrl] = React.useState('')
      const [slug, setSlug] = React.useState('')
      const [busy, setBusy] = React.useState(null)
      const [installTarget, setInstallTarget] = React.useState(null)

      const install = async (body, label) => {
        setBusy(label)
        try {
          const result = await req(['servers', id, 'plugins'], { method: 'POST', body })
          await reload()
          const installed = (result.installed ?? []).map((entry) => `${entry.name ?? entry.slug}${entry.skipped ? '（已存在）' : ''}`).join('、')
          notify(installed === '' ? '安装完成' : `已安装：${installed}`)
          for (const warning of result.warnings ?? []) notify(warning, 'err')
        } catch (caught) {
          notify(caught.message, 'err')
        } finally {
          setBusy(null)
        }
      }

      const plugins = detail.plugins ?? []
      return h('div', null,
        h('div', { className: 'mcm-inline', style: { marginBottom: 10 } },
          h('span', { className: 'mcm-hint' }, running ? '修改插件后需要重启服务器才会生效' : '服务器已停止，修改将在下次启动时生效'),
          h('span', { style: { flex: 1 } }),
          h(Button, { onClick: () => void install({ kind: 'defaults' }, 'defaults'), disabled: busy !== null }, busy === 'defaults' ? '安装中…' : '安装默认插件 (LuckPerms + EssentialsX)')),

        h('table', { className: 'mcm-table' },
          h('thead', null, h('tr', null, h('th', null, '插件'), h('th', null, '版本'), h('th', null, '文件'), h('th', null, '状态'), h('th', null, '操作'))),
          h('tbody', null,
            plugins.length === 0
              ? h('tr', null, h('td', { colSpan: 5, className: 'mcm-muted' }, '还没有安装插件'))
              : plugins.map((plugin) => h('tr', { key: plugin.file },
                h('td', null, plugin.name),
                h('td', { className: 'mcm-muted' }, plugin.version || '—'),
                h('td', { className: 'mcm-mono mcm-muted' }, plugin.file),
                h('td', null, plugin.enabled ? '启用' : '已禁用'),
                h('td', null, h('div', { className: 'mcm-inline' },
                  h(Button, {
                    variant: 'ghost',
                    disabled: busy !== null,
                    onClick: () => act('toggle', () => req(['servers', id, 'plugins-toggle'], { method: 'POST', body: { file: plugin.file, enabled: !plugin.enabled } }), plugin.enabled ? '插件已禁用' : '插件已启用'),
                  }, plugin.enabled ? '禁用' : '启用'),
                  h(Button, {
                    variant: 'ghost danger',
                    disabled: busy !== null,
                    onClick: () => {
                      setInstallTarget(plugin)
                    },
                  }, '删除'))))))),

        h('div', { className: 'mcm-section-title' }, '从 URL 安装'),
        h('form', { className: 'mcm-form-row', onSubmit: async (event) => { event.preventDefault(); if (url.trim() === '') return; const value = url.trim(); setUrl(''); await install({ kind: 'url', url: value }, 'url') } },
          h('input', { className: 'mcm-input', style: { flex: 1 }, placeholder: 'https://example.com/Plugin-1.0.jar', value: url, onChange: (event) => setUrl(event.target.value) }),
          h(Button, { variant: 'primary', disabled: busy !== null || url.trim() === '' }, busy === 'url' ? '下载中…' : '安装')),

        h('div', { className: 'mcm-section-title' }, '从 Modrinth 安装'),
        h('form', { className: 'mcm-form-row', onSubmit: async (event) => { event.preventDefault(); if (slug.trim() === '') return; const value = slug.trim(); setSlug(''); await install({ kind: 'slug', slug: value }, 'slug') } },
          h('input', { className: 'mcm-input', style: { flex: 1 }, placeholder: 'Modrinth slug，例如 vault、worldedit', value: slug, onChange: (event) => setSlug(event.target.value) }),
          h(Button, { variant: 'primary', disabled: busy !== null || slug.trim() === '' }, busy === 'slug' ? '解析中…' : '安装')),
        h('div', { className: 'mcm-hint', style: { marginTop: 6 } }, '会按服务器版本自动选择兼容的最新版本；新版本刚发布时可能还没有声明支持。'),

        installTarget === null ? null : h(ConfirmDialog, {
          title: '删除插件',
          message: `确定删除「${installTarget.name}」（${installTarget.file}）吗？删除后需要重启服务器，且无法撤销。`,
          confirmLabel: '删除',
          danger: true,
          onConfirm: async () => {
            const plugin = installTarget
            setInstallTarget(null)
            await act('remove', () => req(['servers', id, 'plugins', plugin.file], { method: 'DELETE' }), '插件已删除')
          },
          onClose: () => setInstallTarget(null),
        }))
    }

    // ── worlds & backups ───────────────────────────────────────────────────
    function WorldsTab({ id, detail, running, notify, reload, act }) {
      const [busy, setBusy] = React.useState(null)
      const [restoreTarget, setRestoreTarget] = React.useState(null)
      const [deleteTarget, setDeleteTarget] = React.useState(null)

      const backup = async (world) => {
        setBusy(`backup:${world}`)
        try {
          const result = await req(['servers', id, 'backups'], { method: 'POST', body: { world } })
          await reload()
          notify(`已创建备份 ${result.backup?.name}（${formatBytes(result.backup?.size)}）`)
        } catch (caught) {
          notify(caught.message, 'err')
        } finally {
          setBusy(null)
        }
      }

      const worlds = detail.worlds ?? []
      const backups = detail.backups ?? []
      return h('div', null,
        h('div', { className: 'mcm-section-title' }, '存档世界'),
        h('table', { className: 'mcm-table' },
          h('thead', null, h('tr', null, h('th', null, '世界'), h('th', null, '版本'), h('th', null, '大小'), h('th', null, '最后修改'), h('th', null, '操作'))),
          h('tbody', null,
            worlds.length === 0
              ? h('tr', null, h('td', { colSpan: 5, className: 'mcm-muted' }, '还没有世界，首次启动服务器后生成'))
              : worlds.map((world) => h('tr', { key: world.name },
                h('td', null, world.name),
                h('td', { className: 'mcm-muted' }, world.version || '—'),
                h('td', null, formatBytes(world.size)),
                h('td', { className: 'mcm-muted' }, formatTime(world.lastModified)),
                h('td', null, h(Button, {
                  disabled: busy !== null,
                  onClick: () => void backup(world.name),
                }, busy === `backup:${world.name}` ? '备份中…' : '备份')))))),

        h('div', { className: 'mcm-section-title' }, '备份'),
        h('table', { className: 'mcm-table' },
          h('thead', null, h('tr', null, h('th', null, '备份'), h('th', null, '大小'), h('th', null, '创建时间'), h('th', null, '操作'))),
          h('tbody', null,
            backups.length === 0
              ? h('tr', null, h('td', { colSpan: 4, className: 'mcm-muted' }, '还没有备份'))
              : backups.map((item) => h('tr', { key: item.name },
                h('td', { className: 'mcm-mono' }, item.name),
                h('td', null, formatBytes(item.size)),
                h('td', { className: 'mcm-muted' }, formatTime(item.createdAt)),
                h('td', null, h('div', { className: 'mcm-inline' },
                  h(Button, { disabled: busy !== null || running, title: running ? '恢复前请先停止服务器' : undefined, onClick: () => setRestoreTarget(item) }, '恢复'),
                  h(Button, { variant: 'ghost danger', disabled: busy !== null, onClick: () => setDeleteTarget(item) }, '删除'))))))),

        running ? h('div', { className: 'mcm-hint', style: { marginTop: 10 } }, '提示：备份运行中的服务器时会先 save-off / save-all flush，完成后恢复 save-on；恢复存档必须停止服务器。') : null,

        restoreTarget === null ? null : h(ConfirmDialog, {
          title: '恢复存档',
          message: `用「${restoreTarget.name}」覆盖当前世界存档？当前世界会先移动到 backups/rollback-* 作为回滚点，但恢复过程不可撤销。`,
          confirmLabel: '恢复',
          danger: true,
          onConfirm: async () => {
            const name = restoreTarget.name
            setRestoreTarget(null)
            const ok = await act('restore', () => req(['servers', id, 'backups', name, 'restore'], { method: 'POST', body: {} }), `已从 ${name} 恢复`)
            if (ok) await reload()
          },
          onClose: () => setRestoreTarget(null),
        }),

        deleteTarget === null ? null : h(ConfirmDialog, {
          title: '删除备份',
          message: `确定删除备份「${deleteTarget.name}」吗？该操作不可恢复。`,
          confirmLabel: '删除',
          danger: true,
          onConfirm: async () => {
            const name = deleteTarget.name
            setDeleteTarget(null)
            const ok = await act('delete-backup', () => req(['servers', id, 'backups', name], { method: 'DELETE' }), '备份已删除')
            if (ok) await reload()
          },
          onClose: () => setDeleteTarget(null),
        }))
    }

    // ── server.properties ──────────────────────────────────────────────────
    function SettingsTab({ id, detail, running, notify, reload }) {
      const properties = detail.properties ?? {}
      const [draft, setDraft] = React.useState({})
      const [saving, setSaving] = React.useState(false)

      React.useEffect(() => {
        setDraft({})
      }, [detail.id])

      const keys = Object.keys(properties)
      const dirtyKeys = Object.keys(draft).filter((key) => String(draft[key]) !== String(properties[key] ?? ''))

      const save = async () => {
        if (dirtyKeys.length === 0) return
        setSaving(true)
        try {
          const patch = {}
          for (const key of dirtyKeys) patch[key] = draft[key]
          const result = await req(['servers', id, 'properties'], { method: 'PUT', body: { properties: patch } })
          await reload()
          setDraft({})
          notify(`已保存 ${dirtyKeys.length} 项配置${result.note ? `。${result.note}` : ''}`)
        } catch (caught) {
          notify(caught.message, 'err')
        } finally {
          setSaving(false)
        }
      }

      const renderControl = (key) => {
        const value = draft[key] ?? properties[key] ?? ''
        const kind = propertyKind(key, properties[key])
        if (kind === 'enum') {
          return h('select', { className: 'mcm-select', value, onChange: (event) => setDraft((current) => ({ ...current, [key]: event.target.value })) },
            PROPERTY_ENUMS[key].map((option) => h('option', { key: option, value: option }, option)))
        }
        if (kind === 'bool') {
          return h('select', { className: 'mcm-select', value: String(value), onChange: (event) => setDraft((current) => ({ ...current, [key]: event.target.value })) },
            h('option', { value: 'true' }, 'true'), h('option', { value: 'false' }, 'false'))
        }
        return h('input', {
          className: 'mcm-input',
          value,
          type: kind === 'int' ? 'number' : 'text',
          spellCheck: false,
          onChange: (event) => setDraft((current) => ({ ...current, [key]: event.target.value })),
        })
      }

      return h('div', null,
        h('div', { className: 'mcm-inline', style: { marginBottom: 10 } },
          h('span', { className: 'mcm-hint' }, running ? '服务器运行中：修改会在重启后生效' : '服务器已停止：修改将在下次启动时生效'),
          h('span', { style: { flex: 1 } }),
          dirtyKeys.length === 0 ? null : h(Button, { variant: 'ghost', onClick: () => setDraft({}), disabled: saving }, '放弃修改'),
          h(Button, { variant: 'primary', onClick: () => void save(), disabled: saving || dirtyKeys.length === 0 }, saving ? '保存中…' : `保存${dirtyKeys.length === 0 ? '' : ` (${dirtyKeys.length})`}`)),
        h('div', { className: 'mcm-settings' },
          keys.length === 0
            ? h('div', { className: 'mcm-muted' }, 'server.properties 文件尚未生成')
            : keys.map((key) => h('div', { key, className: 'mcm-prop' },
              h('label', null, PROPERTY_LABELS[key] ?? key, h('span', { className: 'mcm-mono mcm-muted', style: { marginLeft: 6 } }, key)),
              renderControl(key)))),
        h('div', { className: 'mcm-hint', style: { marginTop: 12 } }, '提示：改端口、正版验证等需要同时调整网络/客户端设置；未知键会按原样写入。'))
    }

    // ── gamerules ──────────────────────────────────────────────────────────
    function GamerulesTab({ id, detail, running, meta, notify }) {
      const catalog = meta?.gamerules ?? []
      const [values, setValues] = React.useState(null)
      const [draft, setDraft] = React.useState({})
      const [loading, setLoading] = React.useState(false)
      const [saving, setSaving] = React.useState(false)
      const [source, setSource] = React.useState('')
      const [world, setWorld] = React.useState('')

      const load = React.useCallback(async () => {
        setLoading(true)
        try {
          const data = await req(['servers', id, 'gamerules'])
          setValues(data.values ?? {})
          setSource(data.source ?? '')
          setWorld(data.world ?? '')
          setDraft({})
        } catch (caught) {
          notify(caught.message, 'err')
        } finally {
          setLoading(false)
        }
      }, [id, notify])

      React.useEffect(() => {
        void load()
      }, [load])

      const dirtyRules = Object.keys(draft).filter((rule) => String(draft[rule]) !== String(values?.[rule] ?? ''))

      const apply = async () => {
        if (dirtyRules.length === 0) return
        setSaving(true)
        try {
          for (const rule of dirtyRules) {
            await req(['servers', id, 'gamerules'], { method: 'POST', body: { rule, value: draft[rule] } })
          }
          notify(`已设置 ${dirtyRules.length} 条游戏规则`)
          await load()
        } catch (caught) {
          notify(caught.message, 'err')
        } finally {
          setSaving(false)
        }
      }

      const rules = catalog.length > 0 ? catalog : Object.keys(values ?? {}).map((key) => ({ key, label: key, type: typeof values[key] === 'boolean' ? 'bool' : 'int' }))

      return h('div', null,
        h('div', { className: 'mcm-inline', style: { marginBottom: 10 } },
          h('span', { className: 'mcm-hint' },
            running ? `通过控制台读取（世界 ${world}）` : `服务器未停止时从存档读取（世界 ${world}）`),
          source === 'level.dat' ? h('span', { className: 'mcm-chip' }, '来源 level.dat') : null,
          h('span', { style: { flex: 1 } }),
          h(Button, { onClick: () => void load(), disabled: loading || saving }, loading ? '读取中…' : '刷新'),
          h(Button, { variant: 'primary', onClick: () => void apply(), disabled: !running || saving || dirtyRules.length === 0 }, saving ? '应用中…' : `应用修改${dirtyRules.length ? ` (${dirtyRules.length})` : ''}`)),

        running ? null : h('div', { className: 'mcm-banner warn', style: { margin: '0 0 10px' } }, h('span', { className: 'grow' }, '服务器未运行：这里的值来自存档，修改需要先启动服务器（gamerule 通过控制台写入）。')),

        h('div', null, rules.map((rule) => {
          const known = values !== null && Object.prototype.hasOwnProperty.call(values, rule.key)
          const value = draft[rule.key] !== undefined ? draft[rule.key] : (known ? values[rule.key] : '')
          const type = rule.type ?? (typeof (values?.[rule.key]) === 'boolean' ? 'bool' : 'int')
          return h('div', { key: rule.key, className: 'mcm-rule' },
            h('label', { title: rule.key }, rule.label ?? rule.key),
            h('span', { className: 'mcm-mono' }, rule.key),
            h('div', { className: 'grow' },
              type === 'bool'
                ? h('select', {
                  className: 'mcm-select',
                  value: String(value),
                  disabled: !running,
                  onChange: (event) => setDraft((current) => ({ ...current, [rule.key]: event.target.value })),
                }, h('option', { value: 'true' }, 'true'), h('option', { value: 'false' }, 'false'))
                : h('input', {
                  className: 'mcm-input',
                  type: 'number',
                  value,
                  disabled: !running,
                  onChange: (event) => setDraft((current) => ({ ...current, [rule.key]: event.target.value })),
                })),
            h('span', { className: 'mcm-hint', style: { width: 70, textAlign: 'right' } }, known ? '' : '未知'))
        })))
    }

    // ── java environment ───────────────────────────────────────────────────
    function requiredJavaForClient(version) {
      const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(version ?? '').trim())
      if (match === null) return 21
      const major = Number(match[1])
      const minor = Number(match[2])
      const patch = Number(match[3] ?? '0')
      if (major >= 26) return 25
      if (major === 1) {
        if (minor >= 20) return 21
        if (minor >= 17) return 17
        if (minor === 16 && patch === 5) return 16
        if (minor >= 12) return 11
        return 8
      }
      return 25
    }

    function JavaTab({ id, detail, notify, reload }) {
      const [info, setInfo] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(null)
      const [elapsed, setElapsed] = React.useState(0)
      const [manualPath, setManualPath] = React.useState('')
      const required = detail.requiredJava?.major ?? requiredJavaForClient(detail.mcVersion)

      const load = React.useCallback(async () => {
        try {
          setInfo(await req(['java']))
          setError(null)
        } catch (caught) {
          setError(caught.message)
        }
      }, [])

      React.useEffect(() => {
        void load()
      }, [load])

      React.useEffect(() => {
        if (busy === null || !busy.startsWith('install:')) return undefined
        const started = Date.now()
        const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500)
        return () => clearInterval(timer)
      }, [busy])

      const select = async (path) => {
        setBusy('select')
        try {
          await req(['servers', id, 'java'], { method: 'POST', body: { path } })
          await reload()
          await load()
          notify(path === null ? '已改为自动选择 Java' : '已切换服务器使用的 Java')
        } catch (caught) {
          notify(caught.message, 'err')
        } finally {
          setBusy(null)
        }
      }

      const setDefault = async (path) => {
        setBusy('default')
        try {
          await req(['java', 'select'], { method: 'POST', body: { path } })
          await load()
          notify('已设为默认 Java（新启动的服务器会优先使用它）')
        } catch (caught) {
          notify(caught.message, 'err')
        } finally {
          setBusy(null)
        }
      }

      const install = async (version) => {
        setBusy(`install:${version}`)
        setElapsed(0)
        try {
          const result = await req(['java', 'install'], { method: 'POST', body: { version } })
          await load()
          notify(`Java ${result.installed?.major} 已安装（${result.installed?.version}）`)
        } catch (caught) {
          notify(caught.message, 'err')
        } finally {
          setBusy(null)
        }
      }

      if (info === null) {
        return error === null
          ? h('div', { className: 'mcm-hint' }, '读取 Java 运行时…')
          : h('div', { className: 'mcm-banner err' }, h('span', { className: 'grow' }, error))
      }

      const runtimes = info.runtimes ?? []
      const satisfying = runtimes.filter((runtime) => runtime.major >= required)
      const pinned = detail.javaPath !== null && detail.javaPath !== undefined
      const pinnedLow = pinned && Number(detail.javaMajor) < required
      const installable = info.installable ?? [25, 21, 17, 11, 8]

      return h('div', null,
        satisfying.length === 0
          ? h('div', { className: 'mcm-banner warn', style: { margin: '0 0 10px' } },
            h('span', { className: 'grow' }, `该服务器是 Paper ${detail.mcVersion}，需要 Java ${required}+，但本机还没有满足要求的运行时。可以在下方安装 JDK ${required}。`))
          : null,
        pinnedLow
          ? h('div', { className: 'mcm-banner warn', style: { margin: '0 0 10px' } },
            h('span', { className: 'grow' }, `当前选定的 Java ${detail.javaMajor} 低于该服务器要求的 Java ${required}，启动会被拒绝。请选择更高的版本或改为自动选择。`))
          : null,

        h('div', { className: 'mcm-grid' },
          h('div', { className: 'mcm-card' },
            h('h3', null, '本服务器的 Java'),
            h('dl', { className: 'mcm-kv' },
              h('dt', null, '最低要求'), h('dd', null, `Java ${required}`),
              h('dt', null, '当前选择'), h('dd', null, pinned ? `Java ${detail.javaMajor}（${detail.javaVersion ?? ''}）` : '自动选择'),
              h('dt', null, '默认 Java'), h('dd', { className: 'mcm-mono', style: { fontSize: 11 } }, info.defaultPath ?? '未设置'))),
          h('div', { className: 'mcm-card' },
            h('h3', null, '操作'),
            h('div', { className: 'mcm-inline' },
              h(Button, { onClick: () => void select(null), disabled: busy !== null || !pinned }, '改为自动选择'),
              h(Button, { onClick: () => void load(), disabled: busy !== null }, '重新扫描')),
            h('div', { className: 'mcm-hint', style: { marginTop: 8 } }, '自动选择会挑选满足该 Paper 版本要求、且版本号最低的已检测运行时。'),
            h('form', {
              className: 'mcm-form-row',
              style: { marginTop: 10 },
              onSubmit: (event) => {
                event.preventDefault()
                if (manualPath.trim() === '') return
                void select(manualPath.trim())
                setManualPath('')
              },
            },
              h('input', {
                className: 'mcm-input',
                style: { flex: 1 },
                placeholder: '手动指定 java 可执行文件路径',
                value: manualPath,
                onChange: (event) => setManualPath(event.target.value),
              }),
              h(Button, { variant: 'primary', disabled: busy !== null || manualPath.trim() === '' }, '使用该路径')))),

        h('div', { className: 'mcm-section-title' }, `检测到的 Java 运行时（${runtimes.length}）`),
        h('table', { className: 'mcm-table' },
          h('thead', null, h('tr', null, h('th', null, '版本'), h('th', null, '厂商'), h('th', null, '路径'), h('th', null, '来源'), h('th', null, '操作'))),
          h('tbody', null,
            runtimes.length === 0
              ? h('tr', null, h('td', { colSpan: 5, className: 'mcm-muted' }, '没有检测到 Java，请用下方按钮安装'))
              : runtimes.map((runtime) => {
                const isCurrent = pinned && detail.javaPath === runtime.path
                const tooLow = runtime.major < required
                return h('tr', { key: runtime.path },
                  h('td', null, `Java ${runtime.major}`, h('span', { className: 'mcm-mono mcm-muted', style: { marginLeft: 6 } }, runtime.version)),
                  h('td', { className: 'mcm-muted' }, runtime.vendor),
                  h('td', { className: 'mcm-mono mcm-muted', style: { maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, runtime.path),
                  h('td', { className: 'mcm-muted' }, runtime.managed ? '插件安装' : '系统'),
                  h('td', null, h('div', { className: 'mcm-inline' },
                    h(Button, {
                      variant: isCurrent ? 'ghost' : 'default',
                      disabled: busy !== null || isCurrent || tooLow,
                      title: tooLow ? `该服务器需要 Java ${required}+` : undefined,
                      onClick: () => void select(runtime.path),
                    }, isCurrent ? '使用中' : '使用'),
                    h(Button, {
                      variant: 'ghost',
                      disabled: busy !== null,
                      onClick: () => void setDefault(runtime.path),
                    }, '设为默认'))))
              }))),

        h('div', { className: 'mcm-section-title' }, '安装 JDK（Amazon Corretto / Eclipse Temurin）'),
        h('div', { className: 'mcm-inline' },
          installable.map((version) => h(Button, {
            key: version,
            variant: version === required ? 'primary' : 'default',
            disabled: busy !== null,
            onClick: () => void install(version),
          }, busy === `install:${version}`
            ? h('span', { className: 'mcm-inline' }, h('span', { className: 'mcm-spinner' }), `安装中 ${elapsed}s`)
            : `安装 Java ${version}${version === required ? '（推荐）' : ''}`))),
        h('div', { className: 'mcm-hint', style: { marginTop: 8 } },
          'JDK 会下载到 ~/.dsh/minecraft/java 并自动解压验证，优先使用 Amazon Corretto CDN，失败时回退到 Adoptium。安装完成后在列表中选择「使用」即可。'),
        h('div', { className: 'mcm-hint', style: { marginTop: 4 } },
          `平台：${info.platform?.os ?? ''} / ${info.platform?.arch ?? ''}`))
    }

    // ── create server ──────────────────────────────────────────────────────
    function CreateServerDialog({ meta, versions, onClose, onCreated, notify }) {
      const [name, setName] = React.useState('')
      const [version, setVersion] = React.useState(versions?.recommended ?? '')
      const [memory, setMemory] = React.useState(meta?.defaultMemoryMb ?? 2048)
      const [acceptEula, setAcceptEula] = React.useState(false)
      const [installDefaults, setInstallDefaults] = React.useState(true)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [elapsed, setElapsed] = React.useState(0)

      React.useEffect(() => {
        if (!busy) return undefined
        const started = Date.now()
        const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500)
        return () => clearInterval(timer)
      }, [busy])

      React.useEffect(() => {
        if (version === '' && versions?.recommended !== undefined) setVersion(versions.recommended)
      }, [versions, version])

      const submit = async (event) => {
        event?.preventDefault()
        if (name.trim() === '') return
        setBusy(true)
        setError(null)
        try {
          const result = await req(['servers'], {
            method: 'POST',
            body: {
              name: name.trim(),
              version: version.trim() === '' ? undefined : version.trim(),
              memoryMb: Number(memory),
              acceptEula,
              installDefaults,
            },
          })
          for (const warning of result.warnings ?? []) notify(warning, 'err')
          onCreated(result.server)
        } catch (caught) {
          setError(caught.message)
          setBusy(false)
        }
      }

      const offline = versions?.offline === true
      return h(Modal, {
        title: '新建 Paper 服务器',
        onClose: busy ? undefined : onClose,
        footer: [
          h(Button, { key: 'cancel', onClick: onClose, disabled: busy }, '取消'),
          h(Button, { key: 'create', variant: 'primary', onClick: submit, disabled: busy || name.trim() === '' }, busy ? h('span', { className: 'mcm-inline' }, h('span', { className: 'mcm-spinner' }), `创建中 ${elapsed}s`) : '创建服务器'),
        ],
      },
        busy
          ? h('div', null,
            h('p', { style: { marginTop: 0 } }, '正在下载 Paper 服务端并创建服务器…'),
            h('p', { className: 'mcm-hint' }, '首次创建需要从 PaperMC 下载约 50 MB 的 jar；如果勾选了默认插件，还会从 Modrinth 下载 LuckPerms 与 EssentialsX。'),
            h('div', { className: 'mcm-hint', style: { marginTop: 10 } }, `已用时 ${elapsed} 秒`))
          : h('form', { onSubmit: submit },
            h(Field, { label: '服务器名称' },
              h('input', { className: 'mcm-input', value: name, autoFocus: true, placeholder: '例如：朋友服', onChange: (event) => setName(event.target.value), disabled: busy })),
            h(Field, { label: 'Paper / Minecraft 版本', hint: offline ? `无法连接 PaperMC，将使用离线默认值。${versions?.error ?? ''}` : (versions?.recommended ? `推荐 ${versions.recommended}（默认插件 LuckPerms 与 EssentialsX 都声明支持）` : '') },
              versions === null
                ? h('div', { className: 'mcm-hint' }, '读取版本列表…')
                : h('select', {
                  className: 'mcm-select',
                  value: version,
                  onChange: (event) => setVersion(event.target.value),
                },
                  (versions?.versions ?? []).length === 0
                    ? h('option', { value: versions?.recommended ?? '26.1.2' }, versions?.recommended ?? '26.1.2')
                    : versions.versions.map((item) => h('option', { key: item, value: item }, item === versions.recommended ? `${item}（推荐）` : item)))),
            (() => {
              const need = requiredJavaForClient(version)
              const available = (meta?.javaRuntimes ?? []).some((runtime) => runtime.major >= need)
              if (available) return null
              return h('div', { className: 'mcm-banner warn', style: { margin: '0 0 10px' } },
                h('span', { className: 'grow' }, `本机还未检测到满足 Paper ${version || '该版本'} 的 Java ${need}+；创建后可在服务器详情「Java 环境」里安装 JDK ${need}，否则无法启动。`))
            })(),
            h(Field, { label: 'Java 堆内存（MiB）', hint: '建议 2048–4096；服务器启动后可在服务器参数中调整视距等。' },
              h('input', { className: 'mcm-input', type: 'number', min: 512, max: 65536, value: memory, onChange: (event) => setMemory(event.target.value) })),
            h('label', { className: 'mcm-inline', style: { marginBottom: 8 } },
              h('input', { type: 'checkbox', checked: installDefaults, onChange: (event) => setInstallDefaults(event.target.checked) }),
              h('span', null, '安装默认插件 LuckPerms + EssentialsX')),
            h('label', { className: 'mcm-inline' },
              h('input', { type: 'checkbox', checked: acceptEula, onChange: (event) => setAcceptEula(event.target.checked) }),
              h('span', null, '我已阅读并同意 Minecraft EULA（', h('a', { href: 'https://aka.ms/MinecraftEULA', target: '_blank', rel: 'noreferrer', style: { color: 'var(--dsw-alias-link, #6ea8ff)' } }, 'aka.ms/MinecraftEULA'), '）')),
            h('div', { className: 'mcm-hint', style: { marginTop: 4 } }, '不勾选也可以先创建服务器，之后在服务器详情里接受 EULA 再启动。'),
            error === null ? null : h('div', { className: 'mcm-banner err', style: { margin: '10px 0 0' } }, h('span', { className: 'grow' }, error))))
    }

    function DeleteServerDialog({ server, onClose, onDelete }) {
      const [name, setName] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      return h(ConfirmDialog, {
        title: '删除服务器',
        message: `这会删除服务器「${server.name}」的整个目录（服务端、插件、世界存档和备份），无法恢复。`,
        confirmLabel: '永久删除',
        danger: true,
        busy,
        onConfirm: async () => {
          setBusy(true)
          try {
            await onDelete(name)
          } finally {
            setBusy(false)
          }
        },
        onClose,
      }, h(Field, { label: `输入服务器名称「${server.name}」以确认` },
        h('input', { className: 'mcm-input', value: name, onChange: (event) => setName(event.target.value), placeholder: server.name })))
    }

    // ── plugin entry ───────────────────────────────────────────────────────
    const name = 'minecraft-manager-client'
    const inject = ['slots']

    function apply(ctx) {
      try {
        injectStyles()
        const agent = {
          async send(text) {
            const sessions = ctx.get('sessions')
            const conversation = ctx.get('conversation')
            const workspace = ctx.get('uiWorkspace')
            const state = sessions?.list?.getSnapshot?.()
            const current = state === undefined
              ? undefined
              : Object.values(state.byId).find((session) => (session.retainedBy?.mainView ?? 0) > 0)
            if (current !== undefined && conversation?.sendSession !== undefined && typeof sessions.binding === 'function') {
              const binding = sessions.binding(current.sessionId)
              if (binding?.session !== undefined) {
                await conversation.sendSession(binding.session, text, [], 'queue')
                workspace?.openSession?.(current.sessionId)
                return { kind: 'sent' }
              }
            }
            if (workspace?.startSession !== undefined) {
              workspace.startSession(undefined, { prompt: text })
              return { kind: 'opened' }
            }
            return { kind: 'unavailable' }
          },
        }

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 20,
          label: 'MC 服务器',
        }, PanelIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          inject: () => ({ agent }),
        }, Panel))
      } catch (error) {
        console.error('[minecraft-manager] 浏览器半边加载失败', error)
      }
    }

    function PanelIcon({ size = 20 }) {
      return h('span', { style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size } },
        h(Svg, { size, viewBox: '0 0 20 20' },
          h('path', { d: 'M10 2.2 17 5.9v8.2L10 17.8 3 14.1V5.9L10 2.2Z', stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round' }),
          h('path', { d: 'M3.3 6 10 9.7 16.7 6M10 9.7v7.6', stroke: 'currentColor', strokeWidth: 1.1, opacity: 0.7 })))
    }

    exports.name = name
    exports.inject = inject
    exports.apply = apply
    // Internal surface for tests and debugging; not part of the plugin contract.
    exports.__components = { Panel, PanelIcon, ServerDetail, OverviewTab, ConsoleTab, PluginsTab, WorldsTab, SettingsTab, GamerulesTab, JavaTab, CreateServerDialog, DeleteServerDialog }
    return module.exports
  },
})
