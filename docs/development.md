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

- 单测：vitest，各包 `src/__tests__/`。扩展侧用 `chrome-mock.ts` 模拟 `chrome.bookmarks` / `chrome.storage` API（`packages/extension/src/__tests__/chrome-mock.ts`）；mcp-host 侧覆盖工具 schema 一致性、NM 帧 IO、mock transport 桥（`packages/mcp-host/src/__tests__/`）。
- 端到端：计划中，尚未实现（TODO）——真实桥（phase 3）完成后应补「AI 提议 → popup 确认 → 执行 → 回滚」的 E2E。
- 手动验证路径：`serve --mock` + 管道模拟 client（见 [mcp-clients.md](mcp-clients.md) 通用调试）。

## 4. 添加新 MCP tool 的 checklist

工具集经 **三层转发**（AI client → mcp-host tools → SW nm-bridge），每层都要改：

1. **`packages/shared/src/protocol.ts`**：`MCP_TOOLS` 数组加 tool 名（:55），`McpToolArgs` / `McpToolResult` 各加参数/结果类型（:73/:95）。
2. **`packages/mcp-host/src/mcp/tools.ts`**：`TOOL_REGISTRY` 加 `ToolDef`（静态英文 description——**禁止含动态书签内容**，见 security.md §3；schema 标注为 `McpToolArgs[T]` 类型），并在 `registerTools` 里注册（:192）。`assertToolRegistryComplete`（:144）会强制 shared 与 registry 同步，漏改即抛错。
3. **`packages/extension/src/background/nm-bridge.ts`**：`dispatchNmRequest` 的 switch 加 case（:150），调 plan-engine / bookmarks-repo 后包装 `NmResponse`。
4. **`packages/mcp-host/src/native/mock-transport.ts`**：`defaultHandlers` 加默认 handler（:15），保证 `--mock` 演示可跑。
5. **测试**：`packages/mcp-host/src/__tests__/tools-schema.test.ts`（zod 校验）、`bridge.test.ts`（transport 转发）；写操作类 tool 在 security 评审里确认「只经 plan 系列落地」。

## 5. 添加新 InternalRequest 的 checklist

`packages/extension/src/shared/messaging.ts` 是 **popup/options ↔ SW 的 RPC 契约，已冻结**（文件头注释：新增 type 先回 orchestrator 讨论，防协议漂移）：

1. **`messaging.ts`**：`InternalRequest` 联合类型（:21）+ `InternalResponseData`（:48）各加一项；必要时加 `InternalEvent`（:75）。
2. **`packages/extension/src/background/index.ts`**：`handlers` 映射表加实现（:42），复用 plan-engine / bookmarks-repo / store。
3. **调用方**：popup / options 用 `shared/rpc-client.ts` 的 `rpc.call({ type: '...' })` 调用（如 `src/popup/hooks/useNmStatus.ts:17`）。

注意：`src/shared/nm-client.ts` 与 `src/shared/storage.ts` 是 phase 1 遗留 stub（均 `throw TODO phase2`），**未被 popup/options 使用**（实际走 rpc-client.ts），勿在它们上面扩展，清理项见 TODO。

## 6. 故障排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| popup 显示 Native Messaging 未连接 | host 未注册 / manifest 缺失 | 重跑 `cborg-mcp-host register`（需先 build）；popup 或 options 的「Test connection」触发 `nm:reconnect` |
| `connectNative` 立即断开，`doctor` 报 manifest 存在但 warn | **扩展 ID 仍是占位符** | `chrome://extensions` → Copy ID → 编辑 `~/Library/Application Support/<Browser>/NativeMessagingHosts/com.loyd.chrome_bookmark_organizer.json` 的 `allowed_origins`，替换 `EXTENSION_ID_PLACEHOLDER`（`src/cli/register.ts:9`）；options 页 Native Host 面板有「Copy ID」按钮 |
| `doctor` 报 manifest not found / 不可读 | 未 register 或路径错 | `register` 会逐个浏览器目录写入并打印路径（`src/cli/register.ts:66-81`）；核对 `path` 指向的 `bin/mcp-host.js` 存在且可执行 |
| `doctor` 报 host binary missing | 未 build | `pnpm --filter @cborg/mcp-host build`（`src/cli/doctor.ts:45-56`） |
| `doctor` 的 `NM host echo` 报 unexpected reply | 真实 NM 桥未实现（phase 3 TODO） | 当前预期失败：host 无 transport 时回 `NM_DISPATCH_ERROR`（`src/native/host.ts:44-58`）。桥实现后此检查应转绿 |
| tool 调用报 `No extension transport configured` | 未注入 transport | 联调用 `serve --mock`；真实桥见 TODO（`src/native/bridge.ts:42`） |
| **扩展 ID 变更后**（重新构建 / Store 重发） | manifest 绑定旧 ID | `cborg-mcp-host register --unregister` 清旧 manifest → 重新 `register` → 替换新扩展 ID → popup 里 `nm:reconnect` |
| 执行失败后书签错乱 | plan 部分失败 | 自动回滚已内置（`plan-engine.ts:215-218`）；可再调 `plan_rollback`（snapshotId 在执行报告里）手动恢复 |
