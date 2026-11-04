# dsh-minecraft-manager

给 DeepSeek Harness（DSH）用的 Minecraft 服务器管理插件：左侧栏入口 + 图形面板 + 一组 `mc_*` Agent 工具。当前版本只支持 **Paper** 服务端。

## 功能

- **左侧栏入口**：侧栏出现「MC 服务器」，打开全局面板（不绑定会话）。
- **服务器生命周期**：新建（自动从 PaperMC 下载 jar）、启动、停止、重启、删除。进程由宿主插件直接托管，服务器数据放在 `~/.dsh/minecraft`，不污染工作区。
- **Java 环境管理**：扫描本机 Java（PATH/JAVA_HOME/Homebrew/SDKMAN/JDK 目录/插件安装目录），按 Paper 版本校验最低版本；一键下载安装 JDK（优先 Amazon Corretto，回退 Eclipse Temurin/Adoptium；25/21/17/11/8），为每台服务器固定或自动选择运行时。Paper 1.20–1.21.11 需要 Java 21，**Paper 26.1+ 需要 Java 25**。
- **控制台**：实时日志（每 1.5 秒增量拉取）、直接发送控制台命令。
- **插件管理**：列出 `plugins/`（从 jar 的 `plugin.yml` 读出真实插件名与版本）、启用/禁用（`*.jar.disabled`）、删除、从 URL 安装、从 Modrinth 按服务器版本安装。
- **默认插件**：新建服务器时自动安装 **LuckPerms** 与 **EssentialsX**（已存在则跳过；失败只告警不阻塞创建）。
- **存档管理**：列出世界与维度目录，创建 zip 备份（运行中会先 `save-off` + `save-all flush`，完成后 `save-on`），恢复（自动保留 `backups/rollback-*` 回滚点），删除备份。
- **服务器参数**：`server.properties` 图形化编辑（常用键中文标签、按类型校验；未知键原样保留），运行中修改会提示重启生效。
- **游戏规则**：`gamerule` 读取/修改；运行中通过控制台批量读取并回读确认，停止时从 `world/level.dat` 读取。
- **与 Agent 对话管理**：宿主插件注册 `mc_*` 工具。概览页的「让 Agent 执行」提供检查状态/启动/停止/备份世界/查看插件/查看参数等一键动作：点击后会把一条带服务器上下文的指令**直接发送到当前对话并切到对话页**，Agent 立即执行；没有打开的会话时才新建会话并预填指令。也可以直接在对话框里描述需求。

## 环境要求

- DSH Desktop / dsh web（本插件在 Desktop 自带的 Web 面板中加载）。
- 启动服务器需要与 Paper 版本匹配的 Java（1.20–1.21.11 → Java 21，26.1+ → Java 25）。没有 Java 也没关系：在面板「Java 环境」里点「安装 Java 25」会自动从 Amazon Corretto（失败回退 Adoptium）下载、解压并验证。
- 网络：创建服务器访问 `fill.papermc.io`（PaperMC 新 API，旧的 `api.papermc.io/v2` 已 410）；插件下载访问 `api.modrinth.com`。
- 备份/恢复使用系统 `zip` / `unzip`（macOS、常见 Linux 自带）。

## 安装

插件是一个 DSH bundle 包，安装到 `desktop` profile：

```bash
cd /Users/mamawhes/work/mc-server
dsh plugin --profile desktop add link:$PWD/dsh-minecraft-manager
```

然后把包名加入 profile 的 `~/.dsh/profiles/desktop/package.json`：

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-connect-trae", "dsh-minecraft-manager"]
    }
  }
}
```

运行中的 DSH 会通过 profile 的 HMR 监听自动重组（修改 bundles 列表即可，无需重启）；如果宿主代码有改动，`touch ~/.dsh/profiles/desktop/cordis.patch.yml` 触发一次重组即可。浏览器半边的改动由 `dsh-client-hmr` 在约 0.5 秒内热替换。

> 数据目录默认 `~/.dsh/minecraft`，可用环境变量 `DSH_MC_ROOT` 或 patch 里的 `config.root` 覆盖。

## 数据目录

```
~/.dsh/minecraft/
├─ settings.json        # 默认 Java 路径
├─ java/                # 插件安装的 Temurin JDK
└─ servers/<id>/
   ├─ server.json       # 显示名、MC 版本、内存、EULA、Java 选择
   ├─ paper.jar
   ├─ server.properties
   ├─ eula.txt
   ├─ plugins/          # 默认含 LuckPerms、EssentialsX
   ├─ backups/          # 备份 zip 与 rollback-*/ 回滚目录
   └─ world/ world_nether/ world_the_end/ ...
```

## Agent 工具（节选）

| 工具 | 用途 |
|---|---|
| `mc_list_servers` | 列出全部服务器与状态（任何操作前先调用） |
| `mc_list_java_runtimes` | 列出检测到的 Java 运行时与服务器 Java 要求 |
| `mc_install_java` | 安装 JDK（Corretto/Temurin，25/21/17/11/8） |
| `mc_set_server_java` | 为服务器固定 Java 或改回自动选择 |
| `mc_create_server` | 新建 Paper 服务器（默认装 LuckPerms + EssentialsX） |
| `mc_start_server` / `mc_stop_server` | 启动 / 优雅停止（30s 超时后 SIGTERM/SIGKILL） |
| `mc_server_status` | 状态、在线玩家、最近控制台 |
| `mc_console_command` | 发送控制台命令并捕获输出 |
| `mc_get_properties` / `mc_set_properties` | 读写 server.properties |
| `mc_get_gamerules` / `mc_set_gamerule` | 读写 gamerule |
| `mc_list_plugins` / `mc_install_plugin` / `mc_toggle_plugin` / `mc_remove_plugin` | 插件管理 |
| `mc_list_worlds` / `mc_backup_world` / `mc_restore_world` / `mc_delete_backup` | 存档与备份 |
| `mc_accept_eula` | 仅在用户明确同意 EULA 后调用 |

## HTTP 接口

面板使用宿主路由前缀 `/mc/api`（`ctx.webServer` 的 prefix 路由，不经过 `/api` 的 cookie 鉴权，因此服务端校验 Origin 必须是回环地址；默认只监听 127.0.0.1）。

| 方法 | 路径 |
|---|---|
| GET | `/mc/api/meta`、`/mc/api/versions`、`/mc/api/java` |
| POST | `/mc/api/java/install`、`/mc/api/java/select`、`/mc/api/java/probe` |
| GET/POST | `/mc/api/servers` |
| GET/DELETE | `/mc/api/servers/:id` |
| POST | `/mc/api/servers/:id/start`、`stop`、`restart`、`eula`、`java`、`command`、`gamerules`、`backups`、`plugins`、`plugins-toggle` |
| GET | `/mc/api/servers/:id/status`、`console`、`players`、`properties`、`plugins`、`worlds`、`backups`、`latest-log` |
| PUT | `/mc/api/servers/:id/properties` |
| DELETE | `/mc/api/servers/:id/plugins/:file`、`/mc/api/servers/:id/backups/:name` |
| POST | `/mc/api/servers/:id/backups/:name/restore` |

## 安全说明

- EULA 是法律协议：插件不会替用户接受。新建时可勾选，之后可在服务器详情中确认；Agent 工具只有在用户明确同意后才会 `acceptEula=true`。
- 自定义 HTTP 路由不走 DSH 的 `/api` 鉴权，插件用 Origin 回环校验 + 仅本机监听的组合自保；不要把 DSH 暴露到公网后依赖本插件做管理。
- 删除服务器、恢复存档、删除备份都是破坏性操作，面板会二次确认，Agent 调用前应先备份。

## 开发

- 宿主：`lib/index.js`（cordis 插件入口）→ `manager.js`（业务门面）→ `paper.js` / `modrinth.js` / `runtime.js` / `plugins.js` / `properties.js` / `backup.js`。
- 浏览器：`lib/client.js` 是 classic script，必须保持 `window.__ModuleLoader__.load({ id: 'dsh-minecraft-manager', factory })` 格式，且不能内联 React（从 shell 的共享模块表 `require('react')`）。
- 测试脚本在仓库的 `research/tests/`：`host-test.mjs` 用伪 Java 进程跑通「创建 → Java 版本校验 → 启停 → 控制台 → gamerule → 备份/恢复 → API → 工具」；`client-smoke.mjs` 用 React SSR 渲染全部面板组件。运行前在临时目录装 `react`/`react-dom`，并把 `MCM_REACT_DIR` 指过去。设置 `MCM_TEST_JAVA_INSTALL=1` 会额外真实下载并安装 JDK 25（约 130 MB）。

已知限制（v1）：

- 只支持 Paper；Fabric/Forge/Vanilla 未实现。
- Java 安装依赖 Amazon Corretto CDN（主）或 Adoptium/GitHub（备）；离线环境需手动安装 Java 后由扫描发现，也可在「Java 环境」里手动填写 java 路径。
- 宿主重启后无法接管仍在运行的 java 进程（状态会显示为已停止），启动前请确认端口未被占用。
- 服务器控制台与游戏内参数依赖服务器处于运行状态；`gamerule` 停止时只能读取 `level.dat`。
- 自定义 HTTP 路由不走 DSH 的 `/api` 鉴权，仅做 Origin 回环校验。
