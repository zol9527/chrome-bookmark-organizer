# Chrome Bookmark Organizer

![status](https://img.shields.io/badge/status-alpha-green)

> 状态：alpha —— 三进程桥（stdio MCP ↔ localhost TCP ↔ Native Messaging ↔ SW）已接通，110 个测试通过，等待真实 Chrome 手动联调确认。

一个 Chrome MV3 扩展 + MCP server 的组合：让外部 AI 客户端（Claude Desktop / Cursor / opencode / Cline 等）通过 MCP 协议**读取你的书签、提出整理方案**，但**任何写操作都必须经过扩展 popup 的人工确认**才落地（plan-then-confirm）。

AI 只负责「看」和「提议」，用户负责「拍板」。整理书签这类高破坏性操作不交给 AI 全权代理，这是本项目区别于一般「AI 自动整理」方案的核心安全设计。

## 目录

- [快速开始（4 步走通）](#快速开始4-步走通)
- [如何使用（首次用户体验）](#如何使用首次用户体验)
- [Make 命令](#make-命令)
- [架构：三进程拓扑](#架构三进程拓扑)
- [项目结构](#项目结构)
- [安全模型（一句话）](#安全模型一句话)
- [故障排查](#故障排查)
- [文档导航](#文档导航)

## 快速开始（4 步走通）

下面按「装好就能用」的顺序走一遍：装依赖 → 构建 → 导入 Chrome → 注册本地桥 → 接入 AI 客户端。全程约 10 分钟。

| 步骤 | 做什么 | 命令 / 操作 | 产出 |
| --- | --- | --- | --- |
| 第一步 | 装依赖并构建 | `make install` + `make build` | `packages/extension/dist/`（扩展产物） |
| 第二步 | 导入 Chrome | `make load` → Load unpacked → 复制扩展 ID | 扩展加载完成，拿到 32 位 ID |
| 第三步 | 注册 NM host | `make register` → 替换 manifest 里的扩展 ID | 本地桥可被 Chrome 拉起 |
| 第四步 | 接入 AI 客户端 | 配置 MCP server 指向 `packages/mcp-host/bin/mcp-host.js` | AI 客户端能调 `bookmark_*` / `plan_*` 工具 |

**依赖**：Node ≥ 20（`package.json` engines）、pnpm ≥ 10（本仓库用 pnpm 11）、macOS（支持 Chrome / Edge / Brave / Arc / Zen）。

### 第一步：装依赖并构建

```bash
git clone <repo> && cd chrome-bookmark-organizer
make install
make build
```

`make install` 安装 pnpm workspace 全部依赖；`make build` 构建所有包。构建完成后：

- `packages/extension/dist/` —— Chrome 扩展产物，下一步 Load unpacked 就选它；
- `packages/mcp-host/dist/` —— MCP host 产物，第四步接入 AI 客户端时使用。

### 第二步：把扩展导入 Chrome（macOS）

```bash
make load    # 自动打开 chrome://extensions/
```

然后在打开的页面里按顺序操作：

1. 打开右上角 **Developer mode**（开发者模式）；
2. 点 **Load unpacked**（加载已解压的扩展程序），选择 `packages/extension/dist/`；
3. 在扩展卡片上点 **Copy ID**（复制 ID），复制出的 32 位字符串下一步要用（形如 `abcdefghijklmnopqrstuvwxyz123456`）。

### 第三步：注册 Native Messaging host

```bash
make register
```

`register` 会在 macOS 各 Chrome 系浏览器的 `NativeMessagingHosts` 目录写一份 manifest，例如 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.loyd.chrome_bookmark_organizer.json`。用 Edge / Brave / Arc / Zen 时，路径在对应浏览器目录下，register 运行时也会逐个打印实际路径。

**关键步骤**：register 写入的 `allowed_origins` 是 `EXTENSION_ID_PLACEHOLDER`，**必须手动编辑 manifest** 把它替换成第二步复制的真实扩展 ID，否则 Chrome 会拒绝拉起本地 host。注册完可以跑 `make doctor` 校验环境。

### 第四步：把 MCP server 接入你的 AI 客户端

最简配置（Claude Desktop，配置文件 `~/Library/Application Support/Claude/claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "bookmarks": {
      "command": "node",
      "args": ["/绝对路径/to/packages/mcp-host/bin/mcp-host.js"]
    }
  }
}
```

`command`/`args` 指向本仓库的 CLI 入口：`@cborg/mcp-host` 是私有 workspace 包、未发布到 npm，必须用本地**绝对路径**，不能用 `npx`。其他客户端（Cursor / opencode / Cline）的配置文件位置、格式与验证方法见 [docs/mcp-clients.md](docs/mcp-clients.md)。

配置完成后重启 AI 客户端，对话里问「你能访问我的书签吗」，应能看到 `bookmark_*` / `plan_*` 工具被调用。

**接入自检**（按顺序排查，确认每一步再进下一步）：

1. AI 客户端能列出 10 个 `bookmark_*` / `plan_*` 工具 → 说明客户端 ↔ host-A 链路通；
2. 调一个只读 tool（如 `bookmark_count`）不报 `EXTENSION_NOT_CONNECTED` → 说明 host-B ↔ 扩展 SW 链路通；
3. popup 显示绿色 "host: connected" → 说明 NM 链路通。

任何一步失败，先跑 `make doctor`，再看下方[故障排查](#故障排查)。

> 只想先验证客户端 ↔ host-A 链路、不想碰真实书签？给配置的 `args` 末尾追加 `--mock` 走演示模式（canned 数据，不接真实书签），联调确认后再去掉。见 [docs/mcp-clients.md](docs/mcp-clients.md)「通用调试」。

### 手动验证（桥接自检，无需 Chrome）

三进程桥（host-A ↔ host-B ↔ 扩展 SW）可以脱离真实 Chrome 验证，完整命令见 [docs/development.md](docs/development.md)「手动测试 / 端到端验证」。一句话版：`sleep 30 | make serve` 启动 host-A（保持 stdin 不 EOF），然后 `make doctor` 检查 endpoint / TCP 链路。

**不再使用时**：`make unregister` 移除 NM host manifest；扩展本身到 `chrome://extensions/` 移除即可。

## 如何使用（首次用户体验）

扩展装好、AI 客户端接好后，完整链路是这样的。先认识一下 popup（点击扩展图标打开的面板）——它是整个系统的**确认中心**：

- **NM host 状态徽章**：顶部显示 "host: connected"（绿）或 "host: not connected"（红）；
- **pending plans 列表**：AI 提出的待确认整理方案，每张 plan 卡片可展开；
- **逐条 diff**：展开后是 move / rename / merge / delete 的每一步变更预览；
- **Confirm / Reject 按钮**：你的拍板入口。

1. **看连接状态**：点扩展图标打开 popup，应看到绿色 **"host: connected"** 徽章。如果显示 "host: not connected"，先看下方故障排查。
2. **让 AI 读书签**：在 AI 客户端里说「列一下我的书签」。AI 会调 `bookmark_get_tree` 等只读 tool，**无需确认**，直接返回书签树。
3. **让 AI 提方案**：说「按主题分类提个整理方案」。AI 调 `plan_propose` 生成一份 plan（move / rename / merge / delete 的逐条 diff），**扩展 popup 会出现新的待确认 plan 卡片**。
4. **人工拍板**：点开 plan 卡片，逐条查看每一步 diff，点 **Confirm** 或 **Reject**。
5. **执行与回传**：Confirm 后扩展执行 plan（执行前自动拍快照；任何步骤失败自动 rollback），执行结果回传给 AI 客户端。

> **安全语义**：AI 不能直接改书签。所有写操作必须经过 popup 确认才落地；协议层不暴露任何裸 move/remove/create tool。威胁模型与三层安全边界详见 [docs/security.md](docs/security.md)。

### 常见场景

| 场景 | 操作 | 是否需要确认 |
| --- | --- | --- |
| 盘点书签现状 | 说「列一下我的书签」/「统计有多少书签」 | 否（只读 tool） |
| 提出整理方案 | 说「按主题分类提个整理方案」→ popup 查看 plan | 方案本身不需要，**执行需要** |
| 执行 / 放弃方案 | popup 点 Confirm / Reject | — |
| 执行后反悔 | 调 `plan_rollback`（snapshotId 在执行报告里） | 是（同 plan 确认机制） |

**举个完整例子**：你在 AI 客户端说「把工作相关的书签整理进 10_Work_Projects」→ AI 调 `plan_propose` 生成 move 序列 → popup 出现待确认 plan 卡片 → 你展开逐条看 diff，点 **Confirm** → 扩展执行（自动快照），完成后 AI 汇报结果。全程书签树只在你本机、只被 popup 确认过的 plan 触碰。

**plan 机制说明**：AI 只能「提议」，不能「动手」。`plan_propose` 生成的是 move / rename / merge / delete 的 diff 序列（即「整理方案」），popup 确认前不产生任何真实变更；`plan_execute` 落地前自动拍书签快照，任何一步失败自动回滚，执行报告里带 `snapshotId`，需要时可用 `plan_rollback` 手动恢复。

### 工具速览（AI 客户端暴露的 10 个 MCP tool）

| Tool | 用途 | 读 / 写 |
| --- | --- | --- |
| `bookmark_get_tree` | 读取整棵书签树（可按 folderId / depth 裁剪） | 只读 |
| `bookmark_list` | 列出指定目录下的书签 | 只读 |
| `bookmark_search` | 按关键词搜索书签 | 只读 |
| `bookmark_count` | 统计书签数量 | 只读 |
| `bookmark_find_duplicates` | 查找重复书签 | 只读 |
| `plan_propose` | 生成整理方案（diff 序列） | 提议（不落盘） |
| `plan_get` | 查看某个 plan 的详情 | 只读 |
| `plan_cancel` | 取消 pending 的 plan | 写（仅内存） |
| `plan_execute` | 执行已确认的 plan | **写（需 popup 确认）** |
| `plan_rollback` | 用快照回滚已执行的 plan | **写（需 popup 确认）** |

协议层只暴露这 10 个 tool，**没有**裸 move/remove/create 工具——写操作被物理隔离在 plan 流程里，这是安全边界的关键一环（见 [docs/security.md](docs/security.md)）。

### 目录映射（书签会整理到哪里）

扩展内置一份**默认目录映射**（`packages/shared/src/constants.ts`，可在扩展 options 页编辑，编辑后的映射作为首选、内置表作 fallback）：

| 原书签目录关键词 | 归入顶层目录 |
| --- | --- |
| 收藏夹 / 收藏 / 置顶 | `01_Favorites` |
| 工作 | `10_Work_Projects` |
| 学习 / 开发 / 编程 | `20_Development_Engineering` |
| 工具 / 效率 | `30_Tooling` |
| 阅读 / 文章 | `40_Reading` |
| 影音 / 视频 | `50_Media` |
| 社交 | `60_Social` |
| 购物 | `70_Shopping` |
| 其他 / 未分类 | `90_Inbox` |

标准顶层目录共 10 个：`00_Inbox`、`01_Favorites`、`10_Work_Projects`、`20_Development_Engineering`、`30_Tooling`、`40_Reading`、`50_Media`、`60_Social`、`70_Shopping`、`90_Inbox`。AI 提议的整理方案会落到这套结构里：映射表命中的按表归类，未命中的目录统一收进 `00_Inbox`；你想改成自己的命名，到 options 页改目录映射即可（改过的映射作为首选，内置表作 fallback）。

## Make 命令

所有命令从仓库根目录运行，按需挑选：

| 命令 | 说明 |
| --- | --- |
| `make install` | 装依赖（pnpm workspace 全包） |
| `make build` | 构建所有包（重点是 `packages/extension/dist/` 可 Load unpacked） |
| `make extension` | 只构建 Chrome 扩展 |
| `make mcp-host` | 只构建 MCP host |
| `make dev` | 开发模式（extension HMR + mcp-host watch 并行） |
| `make test` | 跑测试（110 tests） |
| `make typecheck` | TS 类型检查 |
| `make lint` | ESLint |
| `make format` | Prettier |
| `make clean` | 清理 `dist/` `.vite/` `*.tsbuildinfo` |
| `make register` | 注册 NM host manifest（需先 `make build` + 拿扩展 ID） |
| `make unregister` | 移除 NM host manifest |
| `make doctor` | 诊断 NM 环境（manifest / endpoint / TCP ping） |
| `make load` | macOS 在 Chrome 打开 `chrome://extensions/` |
| `make serve` | 启动 stdio MCP server（调试用；真实使用由 AI client 自动 spawn） |
| `make help` | 列出所有 target |

完整的 target 列表与说明随时用 `make help` 查看。

**常用流程组合**：

```text
首次安装：make install → make build → make load（Load unpacked + Copy ID）
        → make register（替换 manifest 扩展 ID）→ 配置 AI 客户端（第四步）
日常开发：make dev（HMR）→ make test → make typecheck → make lint → make format
环境诊断：make doctor（定位问题）→ make unregister → make register（重注册）
```

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

> 拓扑图只是概览。进程拓扑、三层协议（MCP / Wire / NM）、数据流、生命周期与关键设计决策详见 [docs/architecture.md](docs/architecture.md)。

> **实现状态**：三进程桥已完整实现并通过 110 个测试（mcp-host 90 + extension 20），含桥接集成测试；进程 A ↔ B 走 line-delimited JSON over localhost TCP（`src/bridge/tcp-protocol.ts`），host-A 侧注入 `TcpBridgeTransport`（`src/cli/serve.ts:42`）。真实 Chrome 联调待手动执行（见 [docs/development.md](docs/development.md)「手动测试 / 端到端验证」）。

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

## 故障排查

| 现象 | 处理 |
| --- | --- |
| popup 显示 "host: not connected" | 跑 `make doctor` 诊断；通常是 host-A（serve）没启动或 endpoint 文件过期，popup 里点 "Reconnect" 重连。 |
| AI 调 tool 返回 `EXTENSION_NOT_CONNECTED` | host-A 没起：检查 AI 客户端是否正确 spawn 了 `serve`（第四步配置是否生效、路径是否绝对）。 |
| Chrome `connectNative` 失败 | manifest 的 `allowed_origins` 扩展 ID 没替换：编辑 `~/Library/Application Support/<Browser>/NativeMessagingHosts/com.loyd.chrome_bookmark_organizer.json`，把 `EXTENSION_ID_PLACEHOLDER` 换成真实扩展 ID。 |
| NM host 启动后立即退出 | endpoint 文件不存在（host-A 没起）：先启动 `make serve` 再重试。 |
| 扩展 ID 变更后（重新构建 / 商店重发） | manifest 仍绑定旧 ID：`make unregister` 清掉 → 重新 `make register` → 替换新 ID → popup 里触发 `nm:reconnect`。 |

更多排查项（含扩展 ID 变更、doctor 各项告警的含义）见 [docs/development.md](docs/development.md)「故障排查」。

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
