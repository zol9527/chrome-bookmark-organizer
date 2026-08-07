# 安全模型

> 配套文档：[架构](architecture.md)（物理边界与协议层）/ [客户端配置](mcp-clients.md)（接入面）。

一句话：**写操作只通过 `plan_execute` 落地且必须经 popup 人工确认；协议层不暴露任何裸写工具；执行前自动快照、失败自动回滚。** 安全边界建在代码里，而不是依赖 AI 客户端的自律。

## 1. 威胁模型

| 威胁 | 载体 | 后果 |
| --- | --- | --- |
| 恶意书签内容（prompt injection） | 书签 title / url 来自任意网页，是**不可信输入** | AI 被诱导调用破坏性工具 / 输出错误指令 |
| AI 误判 | 大模型对书签结构理解偏差 | 方案错误、移动错目录 |
| 未授权访问 | 本机其他进程 / 被恶意页面利用 | 读取或篡改书签 |
| 误操作 / 部分失败 | 大批量 move/delete 执行中出错 | 书签丢失、目录结构破坏 |

## 2. 安全边界：三层

### 协议层（对外契约）

- **无裸写工具**：`MCP_TOOLS` 固定 10 个，写操作只有 `plan_propose / plan_get / plan_cancel / plan_execute / plan_rollback`，**没有** `bookmark_move` / `bookmark_remove` / `bookmark_create` 之类的直改工具（`packages/shared/src/protocol.ts:55-66`，注释即物理安全边界）。AI 客户端即使被诱导，也无工具可直改书签。
- **契约防漂移**：mcp-host 注册表运行时校验与 shared 的 `MCP_TOOLS` 完全一致（`src/mcp/tools.ts:144-150`），zod schema 显式标注为 `McpToolArgs[T]`，编译期保证参数形状（`src/mcp/tools.ts:12-17`）。
- **错误信息不含书签内容**：tool 失败只回 transport 的 `Error.message`，不拼接书签 title/url（`src/mcp/tools.ts:170-172` 注释）。

### UI 层（人工确认）

- **popup 是唯一执行入口**：`plan:confirm` 之后紧跟 `plan:execute`，都在用户点击按钮的同一事件里（`src/popup/Popup.tsx:20`）；AI 只能 propose，无法绕过确认。
- **diff 可读**：PlanCard 逐条渲染 `op → target` + `rationale`（`src/popup/components/PlanCard.tsx:13-16`），用户确认前可见全部变更内容。
- **状态机拒绝越权**：`executePlan` 只接受 `pending / approved` 状态（`src/background/plan-engine.ts:44,165-167`）；executing 中的 plan 不可 reject（`plan-engine.ts:107`）。

### 数据层（可回滚）

- **执行前快照**：`executePlan` 先 `takeSnapshot` 再执行（`src/background/plan-engine.ts:169`），快照存 `chrome.storage.session`（浏览器关闭即清，LRU 10 个，`src/background/snapshot-store.ts:9-10`）。
- **失败自动回滚**：任一 action 失败即中止并 `restoreSnapshot`（`src/background/plan-engine.ts:215-218`）；`restoreSnapshot` 做树 diff：删除新建节点、重建缺失节点、恢复标题/父目录/序号（`src/background/snapshot-store.ts:90-142`）。
- **手动回滚**：`plan_rollback` tool 与 `plan:rollback` RPC 均可按 snapshotId 恢复，成功后关联 plan 置为 `rolled_back`（`plan-engine.ts:224-240`）。

## 3. Prompt injection 防护

- **tool description 全部静态**：10 个 tool 的 description 是硬编码英文文本，**不含任何动态书签内容**（`src/mcp/tools.ts:47-141`），书签 title/url 永远不会被拼进 LLM 可见的工具元数据。
- **书签数据不进 prompt 模板**：书签只是 tool 的返回数据，由 AI client 自行处理；扩展侧不做任何 LLM 调用、不构造 prompt（manifest 无网络权限、无 host_permissions，`packages/extension/src/manifest.ts:9-11`）。
- **纵深防御**：即使 LLM 被诱导，协议层无裸写工具 + UI 层强制确认 + 数据层快照回滚，三重闸门逐层拦截。

## 4. Native Messaging 安全

- **allowed_origins 白名单绑定扩展 ID**：manifest 只允许 `chrome-extension://<32位扩展ID>/`，**Chrome 不支持通配符**（`src/cli/register.ts:50`；doctor 校验 ID 格式，`src/cli/doctor.ts:26`）。本机其他进程无法以你的扩展身份连 host。
- **localhost-only**：全链路 stdio / localhost / NM，无公网端口；扩展不做任何网络请求。
- **TCP wire 协议形状校验**：host-A ↔ host-B 的线协议逐帧运行时校验（`isWireMessage`，`src/bridge/tcp-protocol.ts:39`），单行上限 1MB 防恶意/损坏对端撑爆内存（`src/bridge/tcp-protocol.ts:82`）；TCP server 只监听 `127.0.0.1` 的动态端口（`src/bridge/tcp-server.ts:24,51`）。
- **host stdout 纪律**：host 模式 stdout 只写 NM 帧，任何 `console.log` 都会破坏协议，调试输出必须走 stderr（`src/native/messaging.ts:126-128`）。
- **超时与上限**：NM 请求 15s 超时（`src/background/nm-bridge.ts:35,114-116`）；单条消息上限 1MB，超限即协议错误退出（`src/native/messaging.ts:34-35,113-115`）。
- **优雅降级**：host 未注册时 `connectNative` 失败只记状态广播 `nm:status`，不抛异常、不影响扩展其余功能（`src/background/nm-bridge.ts:80-94`）。

## 5. 用户建议

- **API key 不进扩展**：扩展不调 LLM、无任何网络权限；所有 AI 逻辑在用户自己的 AI 客户端里，密钥留在客户端侧。
- **定期备份书签**：本工具提供快照回滚（session 级，浏览器关闭即失效），重要书签建议另用 Chrome 导出功能定期备份。
- **Chrome profile 隔离**：如与他人共用电脑，用独立 Chrome profile 安装本扩展；NM manifest 注册在用户级目录（`~/Library/Application Support/...`），跨 profile 可被访问。
- **扩展 ID 变更后重新授权**：换电脑、重新构建或 Store 重发后扩展 ID 可能变化，需重跑 `register` 并替换 `allowed_origins`，否则 host 拒绝连接（见 [development.md](development.md) 故障排查）。

## 6. 残余风险与 TODO

- **endpoint 文件权限**：endpoint 文件位于 `~/Library/Application Support/com.loyd.chrome_bookmark_organizer/endpoint`（macOS），内容仅 `{version, port, pid, startedAt}`，无明文敏感数据；`writeEndpointFile` 写入后显式 `chmod 0o600`（owner-only，不受 umask 影响，见 `packages/mcp-host/src/bridge/endpoint-file.ts:63`）。父目录权限默认取决于 umask（通常 755，可接受）。
- **扩展 ID 依赖手动替换**：`register` 写入的 manifest `allowed_origins` 是 `EXTENSION_ID_PLACEHOLDER`，需用户手动替换为真实扩展 ID（doctor 会以 warn 提示，见 [development.md](development.md) 故障排查）。占位符状态下 Chrome 拒绝拉起 host-B。
- **macOS 系统权限（TCC）**：进程读写 `~/Library/Application Support/` 与 NM 管道在部分 macOS 版本可能受 TCC 约束；属环境问题，非应用层可完全控制。
- **`chrome.bookmarks` 权限本身覆盖读写**：无浏览器级细粒度拆分；上述防线全部在应用层实现（协议层无裸写工具 + UI 层强制确认 + 数据层快照回滚）。
- **快照存 `storage.session`**：浏览器关闭即清，跨会话回滚能力有限（设计取舍，见 [architecture.md](architecture.md) 第 5 节）。
