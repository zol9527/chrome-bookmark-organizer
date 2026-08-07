# Chrome Bookmark Organizer

![status](https://img.shields.io/badge/status-pre--alpha-orange)

一个 Chrome MV3 扩展 + MCP server 的组合：让外部 AI 客户端（Claude Desktop / Cursor / opencode / Cline 等）通过 MCP 协议**读取你的书签、提出整理方案**，但**任何写操作都必须经过扩展 popup 的人工确认**才落地（plan-then-confirm）。

AI 只负责「看」和「提议」，用户负责「拍板」。整理书签这类高破坏性操作不交给 AI 全权代理，这是本项目区别于一般「AI 自动整理」方案的核心安全设计。

## 架构：三进程拓扑

```
┌──────────────┐  stdio / MCP JSON-RPC   ┌─────────────────┐  A↔B 桥(TODO)  ┌──────────────────┐
│ AI client    │ ──────────────────────▶ │ mcp-host serve  │ ─────────────▶ │ NM host 子进程     │
│ (Claude/Cursor│ ◀────────────────────── │ (进程 A, Node)  │ ◀───────────── │ (进程 B, Node)    │
│  /opencode…   │     结果回流            └─────────────────┘                └──────────────────┘
└──────────────┘                                                                    │ chrome.runtime
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

- **进程 A**（`@cborg/mcp-host` 的 `serve` 命令）：由 AI client 以 stdio 拉起，跑 MCP JSON-RPC，暴露 10 个 tool。
- **进程 B**（`host` 命令）：由 Chrome 的 `chrome.runtime.connectNative` 拉起，跑 Native Messaging 协议，与扩展 SW 双向通信。
- **扩展 SW**：`chrome.bookmarks` 的唯一入口；写操作收敛在 plan-engine + snapshot-store 内。

> **实现状态**：SW 侧 NM 桥（`packages/extension/src/background/nm-bridge.ts`）与 mcp-host 的 NM 纯 IO 层（`packages/mcp-host/src/native/messaging.ts`）、`register`/`doctor` CLI 均已实现；进程 A ↔ B 的真实桥接为 TODO（当前 `serve --mock` 用 in-memory transport 演示）。详见 [docs/architecture.md](docs/architecture.md)。

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
│       ├── src/native/      # messaging.ts（NM 帧 IO）/ host.ts（host 模式）/ bridge.ts（transport 抽象）
│       └── src/cli/         # serve（默认）/ register / doctor + 隐藏命令 host
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
