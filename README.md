# Minecraft Server Manager for DSH

一个带左侧栏入口的 DeepSeek Harness 插件，用于管理本机的 Minecraft **Paper** 服务器。

- 插件包：[dsh-minecraft-manager](dsh-minecraft-manager/README.md)
- 调研资料与测试脚本：[research/](research/)

## 已实现

- 左侧栏「MC 服务器」入口 + 全局面板（服务器列表 / 概览 / 控制台 / 插件 / 存档备份 / server.properties / gamerule）。
- 新建服务器自动从 [PaperMC Fill v3](https://fill.papermc.io) 下载服务端，并默认安装 **LuckPerms** 与 **EssentialsX**（来自 Modrinth，按服务器版本挑选兼容版本）。
- 启停/重启 Java 进程、控制台命令、在线玩家、日志增量拉取。
- **Java 环境管理**：自动扫描本机运行时、按 Paper 版本校验、一键安装 JDK（Corretto 优先、Adoptium 回退；25/21/17/11/8），每台服务器可固定或自动选择 Java。
- 插件 jar 列表（解析 `plugin.yml` 得到真实名称/版本）、启用/禁用/删除、URL 安装、Modrinth 安装。
- 世界 zip 备份（运行中自动 `save-off` / `save-all flush` / `save-on`）、恢复（保留 rollback 回滚点）、删除。
- 22 个 Agent 工具（`mc_*`），可在对话里让模型直接管理服务器；面板提供「让 Agent 执行」快捷动作，指令直接发到当前对话并切页。

## 安装状态

已以 `link:` 方式安装到 DSH 的 `desktop` profile：

```
~/.dsh/profiles/desktop/node_modules/dsh-minecraft-manager -> /Users/mamawhes/work/mc-server/dsh-minecraft-manager
```

`~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 已包含 `dsh-minecraft-manager`，运行中的 DSH 已通过 HMR 加载宿主插件（`mc_*` 工具可见、`/mc/api` 可用）。

如果浏览器里的侧栏没有出现「MC 服务器」，刷新一次页面即可。

## 环境要求

启动服务器需要匹配 Paper 版本的 Java（26.1+ → Java 25，1.20–1.21.11 → Java 21）。当前机器未检测到 Java，可在面板「Java 环境」页一键安装 Temurin JDK。插件与 Paper 下载需要访问 `fill.papermc.io`、`api.modrinth.com`，Java 安装还需要 `api.adoptium.net` 与 GitHub Releases。

## 验证

宿主端（真实下载 Paper + 默认插件、伪 Java 进程）：

```bash
cd research/tests && node host-test.mjs
```

浏览器端组件（React SSR 冒烟）：

```bash
mkdir -p /tmp/mcm-test && cd /tmp/mcm-test && npm i react@18 react-dom@18
MCM_REACT_DIR=/tmp/mcm-test node /Users/mamawhes/work/mc-server/research/tests/client-smoke.mjs
```
