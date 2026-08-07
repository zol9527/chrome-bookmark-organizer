# 架构

> 配套文档：[安全模型](security.md) / [客户端配置](mcp-clients.md) / [开发指南](development.md)。协议类型定义以 [`packages/shared`](../packages/shared/src/index.ts) 为唯一来源。

## 1. 进程拓扑

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 外部进程（用户机器上的独立 Node 进程）                                          │
│                                                                              │
│   AI client  ──stdio / MCP JSON-RPC──▶  mcp-host serve（进程 A）              │
│   (Claude Desktop / Cursor /                 │  写 endpoint 文件              │
│    opencode / Cline)                         │  (port/pid/startedAt)          │
│                                              ▼                               │
│                                    进程 B（host 命令） ◀── localhost TCP      │
│                                    （读 endpoint → 回连 host-A）              │
└──────────────────────────────────────────────────────────────────────────────┘
                                            │ chrome.runtime.connectNative
                                            │ Native Messaging（32-bit LE 长度前缀 + JSON）
                                            ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 扩展进程（Chrome 托管）                                                        │
│                                                                              │
│   Service Worker（src/background/index.ts）                                   │
│   ├── dispatcher     —— 路由 InternalRequest（popup/options 的 RPC）          │
│   ├── nm-bridge      —— 路由 NmRequest（来自 host-B 的 MCP tool 调用）          │
│   ├── plan-engine    —— create/confirm/execute/rollback + 一键迁移计划          │
│   ├── bookmarks-repo —— chrome.bookmarks 唯一访问层（写操作收敛于 applyAction） │
│   ├── snapshot-store —— 执行前快照（storage.session，LRU 10）                  │
│   └── store          —— plans 持久化（storage.local）+ 内部事件总线             │
│                                              │ chrome.bookmarks API           │
│                                              ▼                               │
│                                        浏览器书签树（唯一事实源）               │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **进程 A**：`serve` 子命令，AI client 以 stdio spawn，跑 MCP JSON-RPC（`src/mcp/server.ts` 的 `StdioServerTransport`）。stdout 被 MCP 协议占用，日志一律走 stderr。启动顺序（`src/cli/serve.ts:21-22`）：TCP server listen 动态端口 → 写 endpoint 文件（`src/bridge/endpoint-file.ts`）→ 起 stdio MCP server → 注入 `TcpBridgeTransport`（`src/bridge/tcp-transport.ts`）→ 退出 hook 清理。
- **进程 B**：`host` 子命令（`src/cli/host.ts`），由 Chrome 经 NM manifest 的 `path` 字段拉起（manifest 由 `register` 写入，path 是**纯 bin 路径**，`src/cli/register.ts:43-49`）。启动流程：读 endpoint 文件（500ms 重试、最多 30s，超时 exit 1，`src/bridge/endpoint-file.ts:93`）→ 回连 host-A TCP（`src/bridge/tcp-client.ts:83`）→ `runNmBridgeHost` 起双向桥（`src/bridge/nm-bridge-host.ts`）。Chrome 把调用方 origin 作为唯一 argv 传入，bin 入口检测 `chrome-extension://` 前缀自动注入 `host` 子命令（`src/cli/index.ts:20-27`）——这是对 Chrome NM「path 不拆参数」限制的规避。
- **扩展 SW**：`chrome.bookmarks` 的唯一访问者；UI 路径（popup↔SW）与远程路径（AI client→host-B→SW）最终都汇到 SW，但语义隔离（`src/shared/messaging.ts:8` 注释）。

**实现状态**：三进程桥已完整实现并测试通过（mcp-host 90 tests + extension 20 tests，共 110）。host-B 侧 `nm-bridge-host.ts` 与 SW 侧 `nm-bridge.ts` 形成闭合：host-A 的 tool 调用 → TCP request（id 为 host-A 生成的 callId）→ host-B 转 NmRequest（**id 沿用 callId**）→ NM 帧 → SW dispatch → NmResponse 原路返回（`src/bridge/nm-bridge-host.ts:90-119`）。`--mock` 仍保留为纯演示模式（`src/cli/serve.ts:38-40`），默认走真实桥。

## 2. 包职责

| 包 | 角色 | 关键约束 |
| --- | --- | --- |
| `@cborg/shared` | 协议契约单一来源 | 不依赖 `@types/chrome` 与 Node API，浏览器/Node 双侧可 import（`src/bookmark.ts:1`） |
| `@cborg/extension` | Chrome MV3 扩展（UI + SW） | manifest 权限仅 `bookmarks`/`nativeMessaging`/`storage`，无 `host_permissions`（`src/manifest.ts:9-11`） |
| `@cborg/mcp-host` | MCP server + NM host + CLI | 私有包未发布；CLI 是独立构建入口（`dist/cli`，`src/index.ts:8`） |

## 3. 关键协议（三层）

| 层 | 路径 | 帧格式 | 定义位置 |
| --- | --- | --- | --- |
| MCP tool | AI client ↔ 进程 A | stdio JSON-RPC（SDK 处理） | `packages/shared/src/protocol.ts:55`（`MCP_TOOLS`）+ `src/mcp/tools.ts`（zod schema） |
| Wire Message | 进程 A ↔ 进程 B | localhost TCP，单行 JSON + `\n`（LineReader 缓冲半包），单行上限 1MB | `src/bridge/tcp-protocol.ts:5-107` |
| NmMessage | 进程 B ↔ SW | 32-bit 小端长度前缀 + UTF-8 JSON，单条上限 1MB | `packages/shared/src/protocol.ts:7` + `src/native/messaging.ts:107-136` |

`NmMessage` 三种形状（`protocol.ts:12-47`）：

- `NmRequest`（host → SW）：`{ kind:'request', id, tool, args }`，correlation id 配对应答。
- `NmResponse`（SW → host）：`{ kind:'response', id, ok, result|error }`，错误含 `{ code, message, details }`。
- `NmEvent`（双向，无应答）：`plan_created / plan_updated / plan_executing / plan_completed / host_ready / host_shutdown`。

`WireMessage` 三种形状（`src/bridge/tcp-protocol.ts:13-17`）：`request`（host-A → host-B，tool 调用，id 为 host-A 生成的 callId）/ `response`（host-B → host-A，id 与 request 一致，`ok` 判别联合，错误带结构化 `{code, message}`）/ `event`（`connected / disconnected / ready` 握手，`src/bridge/tcp-protocol.ts:34`）。运行时形状校验 `isWireMessage` 防止跨进程数据破坏契约（`src/bridge/tcp-protocol.ts:39`）。注意：SW 的 `plan_*` NmEvent **不能**用 wire 协议的 event 表达（联合类型只有握手事件），host-B 收到后记日志丢弃，不发明新 wire 事件名（`src/bridge/nm-bridge-host.ts:155-158`）。

扩展内部另有 `InternalRequest`（popup/options ↔ SW，`src/shared/messaging.ts:21-42`，15 种类型）——与 NmMessage 不同层，UI 路径不暴露给 AI。

## 4. 数据流：AI 提议 → 人工确认 → 执行 → 报告

```
1. AI client        tools.call('plan_propose', { title, description, actions })
2. 进程 A           dispatchToExtension → TcpBridgeTransport.call → TCP request
                    （src/bridge/tcp-transport.ts:119，id = randomUUID callId）
3. 进程 B           nm-bridge-host：TCP request → NmRequest（id 沿用 callId）→ NM stdout → SW
                    （src/bridge/nm-bridge-host.ts:90-94）
4. SW nm-bridge     dispatchNmRequest('plan_propose') → plan-engine.createPlan
                    （src/background/nm-bridge.ts:168）→ 返回 { planId, actions }
5. SW store         savePlan + emitInternalEvent('plan:created') → 广播 popup
6. popup            usePendingPlans 收到事件，渲染 PlanCard（op → target + rationale diff）
7. 用户             popup 点 Confirm → plan:confirm（pending→approved）→ plan:execute
                    （src/popup/Popup.tsx:20）
8. SW plan-engine   executePlan：先 takeSnapshot（storage.session）→ 逐条 applyAction
                    → 成功 completed / 失败自动 restoreSnapshot（src/background/plan-engine.ts:169-220）
9. 报告回流         NmResponse（id=callId）→ host-B 转 TCP response → host-A resolve →
                    MCP 结果回 AI client（src/bridge/nm-bridge-host.ts:95-103）
```

执行状态机（`src/bookmark.ts:64-71`）：`pending → approved → executing → completed`，`pending → rejected`，`executing → failed → rolled_back`（自动或 `plan_rollback`）。

## 5. 生命周期

- **扩展启动**：SW `boot()` 绑定 runtime 事件、订阅内部事件、`startNmBridge()` 尝试 `connectNative`（`src/background/index.ts:149-155`）。host 未注册时 port 立即断开，记录状态并广播 `nm:status`，**不抛异常**（`src/background/nm-bridge.ts:80-94`）。
- **SW 休眠唤醒**：SW 无状态，全部状态在 `chrome.storage`（plans → local，snapshots → session，options → local，`src/constants.ts:21-25`）；popup/options 经 RPC 重新拉取。
- **host-A 启动**：AI client spawn `serve` → TCP server listen 动态端口 → 写 endpoint 文件（`src/bridge/endpoint-file.ts:47`）→ 起 stdio MCP server → 注入 `TcpBridgeTransport`（`src/cli/serve.ts:42-62`）。stdin EOF 时 transport 自动断开并触发 shutdown（`src/cli/serve.ts:95-97`）；SIGINT/SIGTERM/beforeExit/exit 均清理 endpoint 文件与 TCP server（`src/cli/serve.ts:78-107`）。
- **host-B 启动（rendezvous）**：Chrome 在 `connectNative` 时拉起（manifest 的 `path` 是纯 bin 路径，argv 是调用方 `chrome-extension://<id>/` origin）→ bin 入口自动注入 `host` 子命令（`src/cli/index.ts:20-27`）→ `waitForEndpointFile` 轮询 endpoint 文件（500ms 重试、最多 30s，超时 exit 1，`src/bridge/endpoint-file.ts:93`）→ `connectToHost(endpoint.port)` 回连 host-A（`src/cli/host.ts:36-56`）→ 发 `connected` 握手并进入双向桥循环（`src/bridge/nm-bridge-host.ts:175`）。
- **host-B 退出**：两种正常退出（均 exit 0）——SW 断开（NM EOF，`nm-bridge-host.ts:138-139`）或 host-A 的 TCP 关闭（`nm-bridge-host.ts:168`）；协议/IO 错误 exit 1。host stdout 只写 NM 帧，调试走 stderr（`src/native/messaging.ts:126`）。旧版 in-process host 循环（`native/host.ts` 的 `runNmHost`）已不在 CLI 路径上，保留导出仅为 API 兼容。
- **清理**：`register --unregister` 删除各浏览器 manifest（`src/cli/register.ts:82-94`）；host-A 退出 best-effort 删除 endpoint 文件（`src/bridge/endpoint-file.ts:85`）；快照存 session 区域，浏览器关闭即清（`src/constants.ts:18`）。

## 6. 关键设计决策

- **plan-then-confirm 的物理边界在协议层**：`MCP_TOOLS` 不包含裸 `move/remove/create`（`src/protocol.ts:52-53` 注释），写操作只经 `plan_execute`；即使 AI 客户端被诱导，也无工具可直改书签。
- **本地 TCP 不暴露公网**：拓扑全部走本地（stdio / localhost / NM），manifest 无 `host_permissions`，扩展不做任何网络请求（`src/manifest.ts:11`）。
- **rendezvous 文件而非 Unix socket（host-A ↔ host-B）**：host-A 把 TCP 端口写进单行 JSON 文件（`~/Library/Application Support/com.loyd.chrome_bookmark_organizer/endpoint`，macOS；Linux 走 `~/.config/...`，`src/bridge/endpoint-file.ts:12-15`），host-B 轮询读取后回连。选文件而非 Unix socket 的理由：跨平台（macOS/Linux 同一逻辑）、可调试（`cat` 即可看 port/pid/startedAt）、对 TCP ping 友好（doctor 直接 `net.connect` 验证 host-A 存活，`src/cli/doctor.ts:84`）。
- **NM invocation auto-detection（Chrome ↔ host-B）**：Chrome 的 `connectNative` 把 manifest 的 `path` 当**单一可执行文件**原样 spawn、**不拆参数**——因此 path 只能写纯 bin 路径，不能写 `<bin> host`（`src/cli/register.ts:35-42`）。解法：bin 入口检测 argv 含 `chrome-extension://` 前缀且无显式子命令时自动注入 `host`（`src/cli/index.ts:20-27`）；`host` 子命令接受 `[origin]` 参数并 `allowExcessArguments`（`src/cli/host.ts:22-26`）。
- **TCP 单连接（关旧接新）**：host-A 的 TCP server 只维护一条 host-B 长连接，新连接到达时**关闭旧的、接受新的**（`src/bridge/tcp-server.ts:32-38`）。简化协议（无多路复用状态），SW 重启 / host-B 崩溃重连后 host-A 自动恢复，无需重启 serve。代价：doctor 的 TCP ping 会短暂替换当前连接（SW 侧 port 断开需重连，`src/cli/doctor.ts:80-83` 注释）。
- **id 贯穿**：一次 tool 调用在整条链路上用同一个 correlation id——host-A 的 callId = TCP request.id = NmRequest.id = NmResponse.id（`src/bridge/tcp-transport.ts:126` → `src/bridge/nm-bridge-host.ts:91` → SW `nm-bridge.ts` 的 pending map）。跨进程追踪只需 grep 一个 id。
- **NM manifest 绑定扩展 ID（Chrome 信任边界）**：`register` 写入 manifest 的 `name`（`com.loyd.chrome_bookmark_organizer`，与扩展侧 `connectNative` 同名）与 `path`（纯 bin 绝对路径），`allowed_origins` 绑定扩展 ID 完成双向信任（`src/cli/register.ts:56-64`；doctor 校验 ID 格式 `chrome-extension://[a-p]{32}/`，`src/cli/doctor.ts:29`）。
- **写操作收敛**：SW 侧所有 `chrome.bookmarks` 写调用都在 `bookmarks-repo.applyAction`（`src/background/bookmarks-repo.ts:165`）与 `restoreSnapshot`（`src/background/snapshot-store.ts:90`），不允许上层直调 move/create/remove（`src/background/bookmarks-repo.ts:5` 注释）。
- **计划引擎可配置**：目录映射与顶层目录命名参数化（`DEFAULT_FOLDER_MAP` / `DEFAULT_TOP_LEVEL_FOLDERS`，`src/constants.ts:31-64`），AI 提议与 legacy 一键迁移共用同一 PlanAction 结构（`src/background/plan-engine.ts:21-26`）。
