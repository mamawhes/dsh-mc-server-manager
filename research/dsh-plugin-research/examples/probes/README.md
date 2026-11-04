# 实测脚本（可选，用于复核调研结论）

这些脚本直接加载 `/tmp/dsh-app/dsh/node_modules` 里已构建的 DSH 包，**不需要**启动 Harness、不需要浏览器。

前置：

```sh
mkdir -p /tmp/mc-probe && cd /tmp/mc-probe
ln -sfn /tmp/dsh-app/dsh/node_modules node_modules
cp -r <本目录>/../mc-tools-skeleton.mjs plugin.mjs
cp <本目录>/fake-java.sh .
mkdir -p srv/plugins srv/world
printf 'server-port=25565\nmotd=A Minecraft Server\nmax-players=20\n' > srv/server.properties
: > srv/server.jar
chmod +x fake-java.sh
```

| 脚本 | 验证什么 |
|---|---|
| `registry-contract.mjs` | 注册/执行/`isError`/`meta`/参数校验失败/未知工具/disposer |
| `raw-definition-and-gates.mjs` | 裸 JSON Schema 定义（trae 写法）、`tools/pre-execute` 的 `ask`、已取消 signal、`systemPrompt.section` |
| `prompt-assembly.mjs` | `ctx.systemPrompt.assemble()` 里能看到插件段落与工具 schema |
| `lifecycle.mjs` | 用 `fake-java.sh` 冒充 Paper：启动等 `Done`、stdin 命令、重复启动报错、优雅停服 |

注意：`plugin.mjs` 里的 `serverDir` 是硬编码 `/tmp/mc-probe/srv`；移植到本仓库时改成 `config.serverDir`。
