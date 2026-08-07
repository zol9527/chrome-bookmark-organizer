# AI 客户端配置

> 配套文档：[架构](architecture.md)（进程 A/B 拓扑）/ [安全模型](security.md)（接入面风险）。MCP server 入口统一为 `@cborg/mcp-host` 的 CLI，默认命令即 `serve`（stdio transport）。

## 前置条件（所有客户端通用）

1. 已 `pnpm build`，产物在 `packages/mcp-host/dist/cli/index.js`。
2. 已 `register` 并替换扩展 ID（`README.md` 快速开始第 2 步）。
3. `@cborg/mcp-host` 是**私有 workspace 包，未发布到 npm**，因此配置里 `command` 用 `node`、`args` 指向本地构建产物的**绝对路径**，不能用 `npx cborg-mcp-host`。发布后可改用 `npx`。
4. 当前进程 A ↔ B 真实桥为 TODO；配置连接后调 tool 会得到 `No extension transport configured` 错误属预期。联调可先加 `--mock` 参数注入 in-memory transport（返回 canned 数据，`packages/mcp-host/src/cli/serve.ts:25`），确认客户端 ↔ 进程 A 链路通畅后再接真实书签。

## Claude Desktop

配置文件：`~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "bookmark-organizer": {
      "command": "node",
      "args": [
        "/Users/<you>/dev/project/chrome-extensions/chrome-bookmark-organizer/packages/mcp-host/dist/cli/index.js"
      ]
    }
  }
}
```

说明：`command`/`args` 是 Claude Desktop 的 stdio MCP 格式；client 每次启动时 spawn 该进程。联调用例：args 末尾追加 `"--mock"` 走 mock transport。

**验证**：重启 Claude Desktop，对话里问「列出你的 MCP 工具」，应能看到 10 个 `bookmark_*` / `plan_*` 工具；或在开发者工具控制台查 `claude` 日志。

## Cursor

配置文件：项目根 `.cursor/mcp.json`（或全局 `~/.cursor/mcp.json`）

```json
{
  "mcpServers": {
    "bookmark-organizer": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/Users/<you>/dev/project/chrome-extensions/chrome-bookmark-organizer/packages/mcp-host/dist/cli/index.js"
      ]
    }
  }
}
```

说明：Cursor 的 stdio 配置用 `type: "stdio"` + `command`/`args`；远程 Streamable HTTP 预留 `type: "http"` + `url`（本项目 HTTP transport 未实现，`packages/mcp-host/src/mcp/server.ts:15`）。

**验证**：Cursor Settings → MCP 面板，应显示 `bookmark-organizer` 为 connected；展开可看到 10 个工具。

## opencode

配置文件：项目根 `opencode.json`（或 `~/.config/opencode/opencode.json`）

```json
{
  "mcp": {
    "bookmark-organizer": {
      "type": "local",
      "command": ["node", "/Users/<you>/dev/project/chrome-extensions/chrome-bookmark-organizer/packages/mcp-host/dist/cli/index.js"],
      "enabled": true
    }
  }
}
```

说明：opencode 的 `type: "local"` 对应 stdio（`command` 是数组形式）；远程预留 `type: "remote"` + `url`。

**验证**：启动 opencode，TUI 里输入 `/mcp` 查看 `bookmark-organizer` 状态；或问「你能访问我的书签吗」看工具调用。

## Cline（VS Code）

配置文件：VS Code `settings.json`

```json
{
  "cline.mcpServers": {
    "bookmark-organizer": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/Users/<you>/dev/project/chrome-extensions/chrome-bookmark-organizer/packages/mcp-host/dist/cli/index.js"
      ]
    }
  }
}
```

说明：Cline 的 stdio 配置直接写 `command`/`args`，`type: "stdio"` 显式声明。

**验证**：Cline 面板 → MCP Servers → 点刷新，`bookmark-organizer` 应显示绿色 connected；展开工具列表核对 10 个工具。

## 通用调试：手动模拟 MCP client

MCP stdio transport 是 **newline-delimited JSON-RPC**（每行一条消息）。可用管道直接与进程 A 对话，不依赖任何客户端：

```bash
# 1. 用 mock transport 启动（演示模式，不接真实书签）
node packages/mcp-host/dist/cli/index.js --mock

# 2. 另一个终端：发送 initialize + tools/list
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"debug","version":"0.1"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | node packages/mcp-host/dist/cli/index.js --mock
```

- 期望输出：`initialize` 返回 `MCP_SERVER_INFO`（`chrome-bookmark-organizer` v0.1.0，`packages/shared/src/constants.ts:10-13`），`tools/list` 返回 10 个 tool 的 name + description。
- 单条消息必须在一行内（stdout 被 MCP 协议占用，日志在 stderr，可加 `2>debug.log` 分开看）。
- 若想进一步测 tool 调用（如 `bookmark_count`），追加一条 `tools/call` 消息即可；无 `--mock` 时会得到 `No extension transport configured` 错误（真实桥未实现，`packages/mcp-host/src/native/bridge.ts:42`）。

## 排查清单

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| client 报「spawn ENOENT」 | args 路径写错或未 build | `pnpm build` 后核对绝对路径 |
| 工具能列出，调用报 `No extension transport configured` | 真实桥未实现 | 联调用 `--mock`；生产等 phase 3 |
| NM 状态未连接 | host 未注册 / 扩展 ID 占位符 | `doctor` 诊断，见 [development.md](development.md) |
