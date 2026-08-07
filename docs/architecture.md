# 架构

> 配套文档：[安全模型](security.md) / [客户端配置](mcp-clients.md) / [开发指南](development.md)。协议类型定义以 [`packages/shared`](../packages/shared/src/index.ts) 为唯一来源。

## 1. 进程拓扑

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 外部进程（用户机器上的独立 Node 进程）                                          │
│                                                                              │
│   AI client  ──stdio / MCP JSON-RPC──▶  mcp-host serve（进程 A）              │
│   (Claude Desktop / Cursor /                 │  register 写的 manifest        │
│    opencode / Cline)                         │  path 指向 bin/mcp-host.js      │
│                                              ▼                               │
│                                    进程 B（host 命令） ◀── child_process/TCP  │
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

- **进程 A**：`serve` 子命令，AI client 以 stdio spawn，跑 MCP JSON-RPC（`src/mcp/server.ts` 的 `StdioServerTransport`）。stdout 被 MCP 协议占用，日志一律走 stderr。
- **进程 B**：隐藏的 `host` 子命令（`src/cli/index.ts:27`），由 Chrome 经 NM manifest 的 `path` 字段拉起（manifest 由 `register` 写入，`src/cli/register.ts:37` 的 `DEFAULT_HOST_BIN`）。以 NM 帧与 SW 通信，主循环见 `src/native/host.ts:22`。
- **扩展 SW**：`chrome.bookmarks` 的唯一访问者；UI 路径（popup↔SW）与远程路径（AI client→host-B→SW）最终都汇到 SW，但语义隔离（`src/shared/messaging.ts:8` 注释）。

**实现状态**：SW 侧 NM 桥（`src/background/nm-bridge.ts`，全 10 个 tool 的 dispatch）与 mcp-host 的 NM 帧 IO（`src/native/messaging.ts`）均已实现；**进程 A ↔ B 的真实桥接为 TODO**（`src/native/messaging.ts:26`、`src/mcp/server.ts:15`、`src/native/bridge.ts:42`），当前 `serve --mock` 注入 in-memory transport 演示（`src/cli/serve.ts:28`）。设计细节（A 侧 spawn B、A↔B 用 child_process 管道或 localhost TCP，B 侧同时连 A 的 HTTP 端点）见 `src/native/messaging.ts:11-29` 与 `src/native/host.ts:14-18`。

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
| Wire Message | 进程 A ↔ 进程 B | 未定（child_process 管道或 localhost TCP），TODO | `src/native/messaging.ts:11-29` 设计注释 |
| NmMessage | 进程 B ↔ SW | 32-bit 小端长度前缀 + UTF-8 JSON，单条上限 1MB | `packages/shared/src/protocol.ts:7` + `src/native/messaging.ts:107-136` |

`NmMessage` 三种形状（`protocol.ts:12-47`）：

- `NmRequest`（host → SW）：`{ kind:'request', id, tool, args }`，correlation id 配对应答。
- `NmResponse`（SW → host）：`{ kind:'response', id, ok, result|error }`，错误含 `{ code, message, details }`。
- `NmEvent`（双向，无应答）：`plan_created / plan_updated / plan_executing / plan_completed / host_ready / host_shutdown`。

扩展内部另有 `InternalRequest`（popup/options ↔ SW，`src/shared/messaging.ts:21-42`，15 种类型）——与 NmMessage 不同层，UI 路径不暴露给 AI。

## 4. 数据流：AI 提议 → 人工确认 → 执行 → 报告

```
1. AI client        tools.call('plan_propose', { title, description, actions })
2. 进程 A           dispatchToExtension →（TODO 真实桥）→ NmRequest
3. SW nm-bridge     dispatchNmRequest('plan_propose') → plan-engine.createPlan
                    （src/background/nm-bridge.ts:168）→ 返回 { planId, actions }
4. SW store         savePlan + emitInternalEvent('plan:created') → 广播 popup
5. popup            usePendingPlans 收到事件，渲染 PlanCard（op → target + rationale diff）
6. 用户             popup 点 Confirm → plan:confirm（pending→approved）→ plan:execute
                    （src/popup/Popup.tsx:20）
7. SW plan-engine   executePlan：先 takeSnapshot（storage.session）→ 逐条 applyAction
                    → 成功 completed / 失败自动 restoreSnapshot（src/background/plan-engine.ts:169-220）
8. 报告回流         plan:completed 事件 → popup 显示 PlanExecutionReport；
                    远程路径（TODO）经 NmResponse 返回 AI client（plan_get / plan_execute 可查）
```

执行状态机（`src/bookmark.ts:64-71`）：`pending → approved → executing → completed`，`pending → rejected`，`executing → failed → rolled_back`（自动或 `plan_rollback`）。

## 5. 生命周期

- **扩展启动**：SW `boot()` 绑定 runtime 事件、订阅内部事件、`startNmBridge()` 尝试 `connectNative`（`src/background/index.ts:149-155`）。host 未注册时 port 立即断开，记录状态并广播 `nm:status`，**不抛异常**（`src/background/nm-bridge.ts:80-94`）。
- **SW 休眠唤醒**：SW 无状态，全部状态在 `chrome.storage`（plans → local，snapshots → session，options → local，`src/constants.ts:21-25`）；popup/options 经 RPC 重新拉取。
- **host-A 启动**：AI client spawn `serve`，连接 stdio 后等待 JSON-RPC；stdin EOF 时 transport 自动断开（`src/mcp/server.ts:22-34`）；SIGINT/SIGTERM 优雅关闭（`src/cli/serve.ts:41-46`）。
- **host-B 启动/退出**：Chrome 在 `connectNative` 时拉起，port 断开（EOF）即退出（`src/native/host.ts:23-30`）；NM 帧超 1MB 或协议错误同样退出。host stdout 只写 NM 帧，调试走 stderr（`src/native/messaging.ts:126`）。
- **清理**：`register --unregister` 删除各浏览器 manifest（`src/cli/register.ts:61-88`）；快照存 session 区域，浏览器关闭即清（`src/constants.ts:18`）。

## 6. 关键设计决策

- **plan-then-confirm 的物理边界在协议层**：`MCP_TOOLS` 不包含裸 `move/remove/create`（`src/protocol.ts:52-53` 注释），写操作只经 `plan_execute`；即使 AI 客户端被诱导，也无工具可直改书签。
- **本地 TCP 不暴露公网**：拓扑全部走本地（stdio / localhost / NM），manifest 无 `host_permissions`，扩展不做任何网络请求（`src/manifest.ts:11`）。
- **rendezvous 机制**：NM manifest 是 Chrome 拉起 host-B 的会合点——`register` 写入 manifest 的 `name`（`com.loyd.chrome_bookmark_organizer`，与扩展侧 `connectNative` 同名）与 `path`（host 二进制绝对路径），`allowed_origins` 绑定扩展 ID 完成双向信任（`src/cli/register.ts:44-52`；doctor 校验 ID 格式 `chrome-extension://[a-p]{32}/`，`src/cli/doctor.ts:26`）。
- **写操作收敛**：SW 侧所有 `chrome.bookmarks` 写调用都在 `bookmarks-repo.applyAction`（`src/background/bookmarks-repo.ts:165`）与 `restoreSnapshot`（`src/background/snapshot-store.ts:90`），不允许上层直调 move/create/remove（`src/background/bookmarks-repo.ts:5` 注释）。
- **计划引擎可配置**：目录映射与顶层目录命名参数化（`DEFAULT_FOLDER_MAP` / `DEFAULT_TOP_LEVEL_FOLDERS`，`src/constants.ts:31-64`），AI 提议与 legacy 一键迁移共用同一 PlanAction 结构（`src/background/plan-engine.ts:21-26`）。
