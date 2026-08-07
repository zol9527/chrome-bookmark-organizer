# 开发指南

> 配套文档：[架构](architecture.md)（进程拓扑与协议）/ [安全模型](security.md)（边界与评审要点）/ [客户端配置](mcp-clients.md)（联调入口）。

## 1. 开发环境

- Node ≥ 20（root `package.json` engines 声明）、pnpm ≥ 10（本仓库固定 `pnpm@11.10.0`，`packageManager` 字段）。
- Chrome（或 Edge/Brave/Arc/Zen）用于加载扩展与 NM 联调。
- macOS（NM manifest 注册路径与 `register` CLI 均按 macOS 实现，`packages/mcp-host/src/cli/register.ts:12-18`）。

```bash
pnpm install
pnpm build          # 构建全部包；mcp-host 需先 build 才能跑 CLI（bin 指向 dist）
```

## 2. pnpm 脚本

Root（`package.json:11-19`，`-r` 递归全部 workspace）：

| 脚本 | 作用 |
| --- | --- |
| `pnpm dev` | 各包并行 watch（extension Vite HMR + mcp-host tsx watch） |
| `pnpm build` | 全部包构建 |
| `pnpm test` | 全部包 vitest |
| `pnpm typecheck` | 全部包 `tsc --noEmit` |
| `pnpm lint` | eslint |
| `pnpm format` / `format:check` | prettier 写盘 / 校验 |

按包执行（`pnpm --filter`）：

```bash
pnpm --filter @cborg/mcp-host build        # tsup → dist（index + cli/index，ESM+CJS，dts）
pnpm --filter @cborg/mcp-host test
pnpm --filter @cborg/mcp-host exec cborg-mcp-host register   # 注册 NM host（需先 build）
pnpm --filter @cborg/mcp-host exec cborg-mcp-host doctor     # 环境诊断
pnpm --filter @cborg/extension build       # crxjs 打包 → dist/（含 manifest.json）
pnpm --filter @cborg/extension test
```

说明：`@cborg/shared` 无 build 步骤（源码 .ts 直接作为包入口，`packages/shared/package.json:6-13`）；mcp-host 构建时用 `noExternal: ['@cborg/shared']` 内联（`packages/mcp-host/tsup.config.ts:16`）。

## 3. 测试

- 单测与集成：vitest，各包 `src/__tests__/`。扩展侧用 `chrome-mock.ts` 模拟 `chrome.bookmarks` / `chrome.storage` API（`packages/extension/src/__tests__/chrome-mock.ts`）；mcp-host 覆盖工具 schema 一致性、NM 帧 IO、桥接集成（endpoint / TCP 线协议 / host-B 双向桥，25 个 bridge 测试，`packages/mcp-host/src/bridge/` 与 `__tests__/bridge.test.ts`）。当前共 **110 tests**（mcp-host 90 + extension 20）。
- 端到端：真实 Chrome 联调（AI 提议 → popup 确认 → 执行 → 回滚）需手动执行，见下方「手动测试 / 端到端验证」。

## 4. 手动测试 / 端到端验证

### Unit + integration tests

```bash
pnpm test            # 全包，110 tests
pnpm --filter @cborg/mcp-host test   # 只跑 mcp-host（90 tests，含 bridge integration）
```

### 三进程桥手动验证

bridge 的三个进程（host-A / host-B / SW）可以脱离真实 Chrome 验证。

**关键技巧**：直接 background 启动 serve 会让 stdin 立即 EOF（shell `&` 重定向 stdin 到 /dev/null）触发 shutdown。需要用 `sleep N |` 保持 stdin 不 EOF：

```bash
# 终端 1：启动 host-A（stdio MCP + TCP server），保持 stdin open 30s
sleep 30 | pnpm --filter @cborg/mcp-host exec cborg-mcp-host serve &

# 等 1-2 秒后检查 endpoint 文件
cat "$HOME/Library/Application Support/com.loyd.chrome_bookmark_organizer/endpoint"
# 预期：{"version":1,"port":XXXXX,"pid":XXXXX,"startedAt":XXX}

# 验证 stdio MCP 响应（tools/list 应返回 10 个 tool）
echo '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}' | \
  pnpm --filter @cborg/mcp-host exec cborg-mcp-host serve

# 验证 NM auto-detection：模拟 Chrome NM 调用（chrome-extension://<id>/ argv）
pnpm --filter @cborg/mcp-host exec cborg-mcp-host chrome-extension://test-id-aaaaaaaaaaaaaaaaaa/
# 预期：stderr 显示 "invoked by chrome-extension://..." + "connected to host-A" + 启动 NM 桥
# 无真 SW 时立即 NM EOF，exit 0
```

### 真实 Chrome 联调（必须用户手动）

代码层验证完成后，需要真实 Chrome 验证完整链路（含 SW 端 nm-bridge.ts ↔ plan-engine）：

1. **加载扩展**：`chrome://extensions` → Developer mode → Load unpacked → 选 `packages/extension/dist/`
2. **拿扩展 ID**：扩展卡片上 "Copy ID"，形如 `abcdefghijklmnopqrstuvwxyz123456`
3. **注册 NM host**：
   ```bash
   pnpm --filter @cborg/mcp-host exec cborg-mcp-host register
   # 写 manifest 到各浏览器 NativeMessagingHosts 目录（allowed_origins 是 placeholder）
   # 手动编辑 manifest 把 EXTENSION_ID_PLACEHOLDER 替换成上一步的 ID
   ```
4. **doctor 自检**：`cborg-mcp-host doctor` 应全绿（除 host-A TCP ping，因为 serve 还没起）
5. **启动 serve**：让 AI client 启动（见 mcp-clients.md 各客户端配置）
6. **打开 popup**：扩展图标 → 应显示 "host: connected" 状态徽章
7. **AI 调 plan_propose**：在 AI client 里说"列我的书签"，AI 调 bookmark_get_tree → 看 popup 不显示 plan（read-only 不需要确认）→ 说"按可读分类提个整理方案" → AI 调 plan_propose → popup 出现新 plan 卡片
8. **Confirm 执行**：点 popup 的 Confirm → plan_execute → 看报告

### 故障排查

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| popup 显示 "host: not connected" | serve 未启动 / endpoint 文件过期 | 启动 serve；popup 点 "Reconnect" |
| host-B 启动后立即 exit 1 | endpoint 文件不存在（host-A 没跑） | 先启动 serve |
| host-B 启动后 NM EOF exit 0 | SW 未连（manifest 没注册 / 扩展 ID 不匹配） | 跑 register，确认 allowed_origins 含真实 ID |
| AI client 调 tool 返回 EXTENSION_NOT_CONNECTED | host-B 未连 host-A | 看 serve 日志是否 "host-B connected"；看 endpoint 文件是否过期 |
| Chrome console 报 "Native Messaging host tried to send a message > 1MB" | NM 协议限制 | 不需要改代码（chrome.bookmarks tree < 1MB 是常态） |

## 5. 添加新 MCP tool 的 checklist

工具集经 **三层转发**（AI client → mcp-host tools → SW nm-bridge），每层都要改：

1. **`packages/shared/src/protocol.ts`**：`MCP_TOOLS` 数组加 tool 名（:55），`McpToolArgs` / `McpToolResult` 各加参数/结果类型（:73/:95）。
2. **`packages/mcp-host/src/mcp/tools.ts`**：`TOOL_REGISTRY` 加 `ToolDef`（静态英文 description——**禁止含动态书签内容**，见 security.md §3；schema 标注为 `McpToolArgs[T]` 类型），并在 `registerTools` 里注册（:192）。`assertToolRegistryComplete`（:144）会强制 shared 与 registry 同步，漏改即抛错。
3. **`packages/extension/src/background/nm-bridge.ts`**：`dispatchNmRequest` 的 switch 加 case（:150），调 plan-engine / bookmarks-repo 后包装 `NmResponse`。
4. **`packages/mcp-host/src/native/mock-transport.ts`**：`defaultHandlers` 加默认 handler（:15），保证 `--mock` 演示可跑。
5. **测试**：`packages/mcp-host/src/__tests__/tools-schema.test.ts`（zod 校验）、`bridge.test.ts`（transport 转发）；写操作类 tool 在 security 评审里确认「只经 plan 系列落地」。

## 6. 添加新 InternalRequest 的 checklist

`packages/extension/src/shared/messaging.ts` 是 **popup/options ↔ SW 的 RPC 契约，已冻结**（文件头注释：新增 type 先回 orchestrator 讨论，防协议漂移）：

1. **`messaging.ts`**：`InternalRequest` 联合类型（:21）+ `InternalResponseData`（:48）各加一项；必要时加 `InternalEvent`（:75）。
2. **`packages/extension/src/background/index.ts`**：`handlers` 映射表加实现（:42），复用 plan-engine / bookmarks-repo / store。
3. **调用方**：popup / options 用 `shared/rpc-client.ts` 的 `rpc.call({ type: '...' })` 调用（如 `src/popup/hooks/useNmStatus.ts:17`）。

注意：`src/shared/nm-client.ts` 与 `src/shared/storage.ts` 是 phase 1 遗留 stub（均 `throw TODO phase2`），**未被 popup/options 使用**（实际走 rpc-client.ts），勿在它们上面扩展，清理项见 TODO。

## 7. 故障排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| popup 显示 Native Messaging 未连接 | host 未注册 / manifest 缺失 | 重跑 `cborg-mcp-host register`（需先 build）；popup 或 options 的「Test connection」触发 `nm:reconnect` |
| `connectNative` 立即断开，`doctor` 报 manifest 存在但 warn | **扩展 ID 仍是占位符** | `chrome://extensions` → Copy ID → 编辑 `~/Library/Application Support/<Browser>/NativeMessagingHosts/com.loyd.chrome_bookmark_organizer.json` 的 `allowed_origins`，替换 `EXTENSION_ID_PLACEHOLDER`（`src/cli/register.ts:9`）；options 页 Native Host 面板有「Copy ID」按钮 |
| `doctor` 报 manifest not found / 不可读 | 未 register 或路径错 | `register` 会逐个浏览器目录写入并打印路径（`src/cli/register.ts:66-81`）；核对 `path` 指向的 `bin/mcp-host.js` 存在且可执行 |
| `doctor` 报 host binary missing | 未 build | `pnpm --filter @cborg/mcp-host build`（`src/cli/doctor.ts:45-56`） |
| `doctor` 报 `host-B self-spawn` skipped（warn） | host-A 未在跑 | 属正常态：host-B 依赖 endpoint 文件，先启动 `serve` 再跑 doctor 才会真正自 spawn 验证（`src/cli/doctor.ts:142-148`） |
| `doctor` 报 `host-A TCP ping` fail | endpoint 文件过期 / host-A 已退出 | 重启 `serve`；ping 会短暂替换当前 host-B 连接（单连接策略），若真实桥在跑会被打断，SW 侧需重连 |
| tool 调用报 `EXTENSION_NOT_CONNECTED` | host-B 未连上 host-A（serve 没起）或 SW 未连（扩展没加载 / manifest 没注册） | 先起 `serve`；再确认扩展已加载、manifest 的 allowed_origins 是真实扩展 ID（`src/bridge/tcp-transport.ts:123`） |
| **扩展 ID 变更后**（重新构建 / Store 重发） | manifest 绑定旧 ID | `cborg-mcp-host register --unregister` 清旧 manifest → 重新 `register` → 替换新扩展 ID → popup 里 `nm:reconnect` |
| 执行失败后书签错乱 | plan 部分失败 | 自动回滚已内置（`plan-engine.ts:215-218`）；可再调 `plan_rollback`（snapshotId 在执行报告里）手动恢复 |
