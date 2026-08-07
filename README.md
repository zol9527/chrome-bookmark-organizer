# Chrome Bookmark Organizer

![status](https://img.shields.io/badge/status-alpha-green)

> 状态：alpha —— 三进程桥（stdio MCP ↔ localhost TCP ↔ Native Messaging ↔ SW）已接通，110 个测试通过，等待真实 Chrome 手动联调确认。

一个 Chrome MV3 扩展 + MCP server 的组合：让外部 AI 客户端（Claude Desktop / Cursor / opencode / Cline 等）通过 MCP 协议**读取你的书签、提出整理方案**，但**任何写操作都必须经过扩展 popup 的人工确认**才落地（plan-then-confirm）。

AI 只负责「看」和「提议」，用户负责「拍板」。整理书签这类高破坏性操作不交给 AI 全权代理，这是本项目区别于一般「AI 自动整理」方案的核心安全设计。

## 架构：三进程拓扑

```
┌──────────────┐  stdio / MCP JSON-RPC   ┌─────────────────┐  localhost TCP  ┌──────────────────┐
│ AI client    │ ──────────────────────▶ │ mcp-host serve  │  (线协议,JSON+NL)│ NM host 子进程     │
│ (Claude/Cursor│ ◀────────────────────── │ (进程 A, Node)  │ ◀───────────── │ (进程 B, Node)    │
│  /opencode…   │     结果回流            └─────────────────┘   rendezvous    └──────────────────┘
└──────────────┘                          (endpoint 文件)     endpoint 文件        │ chrome.runtime
                                                                                  │ .connectNative
                                                       ┌──────────────────────┐     ▼
                                                       │ 扩展 Service Worker  │ ◀── Native Messaging
                                                       │ plan-engine / repo / │     32-bit 长度前缀 JSON
                                                       │ nm-bridge / snapshot │
                                                       └──────────────────────┘
                                                                     │ chrome.bookmarks
                                                                     ▼
                                                             浏览器书签树（唯一事实源）
```

- **进程 A**（`@cborg/mcp-host` 的 `serve` 命令）：由 AI client 以 stdio 拉起，跑 MCP JSON-RPC，暴露 10 个 tool；同时启动 localhost TCP rendezvous server（动态端口）并把端口写入 endpoint 文件（`src/bridge/endpoint-file.ts`）。
- **进程 B**（`host` 命令）：由 Chrome 的 `chrome.runtime.connectNative` 拉起，读 endpoint 文件找到 host-A、回连 TCP，再经 Native Messaging 与扩展 SW 双向桥接（`src/bridge/nm-bridge-host.ts`）。bin 入口检测到 `chrome-extension://` argv 会自动进入 host 模式（`src/cli/index.ts:20`）。
- **扩展 SW**：`chrome.bookmarks` 的唯一入口；写操作收敛在 plan-engine + snapshot-store 内。

> **实现状态**：三进程桥已完整实现并通过 110 个测试（mcp-host 90 + extension 20），含桥接集成测试；进程 A ↔ B 走 line-delimited JSON over localhost TCP（`src/bridge/tcp-protocol.ts`），host-A 侧注入 `TcpBridgeTransport`（`src/cli/serve.ts:42`）。真实 Chrome 联调待手动执行（见下文「手动验证」与 [docs/development.md](docs/development.md)）。

## 快速开始

**依赖**：Node ≥ 20（`package.json` engines）、pnpm ≥ 10（本仓库用 pnpm 11）。macOS 支持 Chrome / Edge / Brave / Arc / Zen。

```bash
pnpm install        # 安装依赖
pnpm build          # 构建全部包（extension → dist/，mcp-host → dist/）
```

**1. 加载扩展**：打开 `chrome://extensions` → 开启 Developer mode → Load unpacked → 选择 `packages/extension/dist/`。从 `chrome://extensions` 复制扩展 ID（后续要用）。

**2. 注册 Native Messaging host**：

```bash
pnpm --filter @cborg/mcp-host exec cborg-mcp-host register
```

`register` 会向 Chrome/Edge/Brave/Arc/Zen 各写一份 manifest（`~/Library/Application Support/<Browser>/NativeMessagingHosts/com.loyd.chrome_bookmark_organizer.json`）。**关键步骤**：把每个 manifest 里 `allowed_origins` 的 `EXTENSION_ID_PLACEHOLDER` 替换成第 1 步复制的真实扩展 ID，否则 Chrome 拒绝拉起 host。可用 `doctor` 校验：

```bash
pnpm --filter @cborg/mcp-host exec cborg-mcp-host doctor
```

**3. 配置 AI client**：把 MCP server 指向本仓库的 CLI 入口（私有包未发布，用本地构建产物）：

```json
{ "command": "node", "args": ["/绝对路径/chrome-bookmark-organizer/packages/mcp-host/dist/cli/index.js"] }
```

各客户端（Claude Desktop / Cursor / opencode / Cline）的具体配置文件位置与示例见 **[docs/mcp-clients.md](docs/mcp-clients.md)**。

**4. 确认工作流**：AI 调 `plan_propose` 提出整理方案 → 打开扩展 popup，看到 pending plan 与逐条 diff → 点 Confirm 后 plan 才真正执行；执行前自动拍快照，失败自动回滚。

### 手动验证（桥接自检，无需 Chrome）

三进程桥可脱离真实 Chrome 验证（关键技巧：用 `sleep N |` 保持 serve 的 stdin 不 EOF，否则 `&` 后台启动会让 stdin 立即 EOF 触发 shutdown）：

```bash
# 1) 启动 host-A（stdio MCP + TCP rendezvous），保持 stdin open 30s
sleep 30 | pnpm --filter @cborg/mcp-host exec cborg-mcp-host serve &

# 2) 等 1-2 秒，检查 endpoint 文件（host-B 靠它找到 host-A）
cat "$HOME/Library/Application Support/com.loyd.chrome_bookmark_organizer/endpoint"
# 预期：{"version":1,"port":XXXXX,"pid":XXXXX,"startedAt":XXX}

# 3) 验证 stdio MCP 应答（tools/list 应返回 10 个 tool）
echo '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}' | \
  pnpm --filter @cborg/mcp-host exec cborg-mcp-host serve

# 4) 模拟 Chrome NM 调用（bin 检测到 chrome-extension:// argv 自动进入 host 模式）
pnpm --filter @cborg/mcp-host exec cborg-mcp-host chrome-extension://test-id-aaaaaaaaaaaaaaaaaa/
# 预期：stderr 显示 invoked by chrome-extension://... → 连上 host-A → 启动 NM 桥
# 无真 SW 时立即 NM EOF → exit 0
```

完整的手动 e2e（真实 Chrome：加载扩展 → register → doctor → popup 确认）见 [docs/development.md](docs/development.md)「手动测试 / 端到端验证」。

## 项目结构

```
.
├── packages/
│   ├── shared/        # 协议契约单一来源：BookmarkNode / Plan / PlanAction / NmMessage /
│   │                  #   MCP_TOOLS（10 个 tool 名）+ 参数/结果类型映射 / NM_HOST_NAME /
│   │                  #   默认目录映射与顶层目录命名（constants.ts）
│   ├── extension/     # Chrome MV3 扩展（React + Vite + crxjs + Tailwind）
│   │   ├── src/background/   # service worker：RPC dispatcher / plan-engine / bookmarks-repo /
│   │   │                     #   snapshot-store / store / nm-bridge
│   │   ├── src/popup/        # 确认中心：NM host 状态 + pending plans + diff + confirm/reject
│   │   ├── src/options/      # 设置页：目录映射编辑 + Native Host 面板 + About
│   │   └── src/shared/       # messaging.ts（popup↔SW 的 15 种 RPC 契约）+ rpc-client.ts
│   └── mcp-host/      # Node MCP server + Native Messaging host + CLI
│       ├── src/mcp/         # server.ts（stdio transport）+ tools.ts（10 个 tool 注册表）
│       ├── src/native/      # messaging.ts（NM 帧 IO）/ bridge.ts（transport 抽象）+ mock
│       ├── src/bridge/      # 三进程桥：endpoint-file / tcp-protocol / tcp-server / tcp-client
│       │                    #   / tcp-transport（host-A 侧）/ nm-bridge-host（host-B 侧）
│       └── src/cli/         # serve（默认，注入 TcpBridgeTransport）/ register / doctor / host
└── docs/
    ├── architecture.md     # 进程拓扑、三层协议、数据流、生命周期、关键设计决策
    ├── security.md         # 威胁模型 + 协议/UI/数据三层安全边界
    ├── mcp-clients.md      # 各 AI 客户端配置示例与验证方法
    └── development.md      # 开发环境、脚本、测试、扩展 checklist、故障排查
```

## 安全模型（一句话）

**写操作只通过 `plan_execute` 落地，且必须经 popup 人工确认；协议层不暴露任何裸 move/remove/create tool，执行前自动快照、失败自动回滚。** 详见 [docs/security.md](docs/security.md)。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | 进程拓扑、三层协议（MCP / Wire / NM）、数据流、生命周期 |
| [docs/security.md](docs/security.md) | 威胁模型、三层安全边界、prompt injection 防护、NM 安全 |
| [docs/mcp-clients.md](docs/mcp-clients.md) | Claude Desktop / Cursor / opencode / Cline 配置与验证 |
| [docs/development.md](docs/development.md) | 开发环境、脚本、测试、新增 tool / RPC 的 checklist |

## Legacy

原零依赖 MV3 扩展（单文件硬编码目录映射）保留在 `docs/legacy/background.js` 作参考；其 plan/execute/repair 逻辑已迁移到 `packages/extension/src/background/plan-engine.ts`，保留「一键迁移」入口（popup 的 migrate:run-oneclick）。

## License

MIT
