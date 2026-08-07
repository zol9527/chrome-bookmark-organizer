import type { McpToolArgs, McpToolName, McpToolResult } from '@cborg/shared';

/**
 * MCP tool → 扩展 SW 的桥。
 *
 * phase 2：通过 NM 通道（host 子进程 B，见 native/messaging.ts 顶部三进程注释）把
 * tool 调用转发给扩展 SW，等待 NmResponse 并按 correlation id 配对。
 * 脚手架阶段：所有调用抛 TODO phase2 错误，类型签名完整保留。
 */
export async function dispatchToExtension<T extends McpToolName>(
  tool: T,
  _args: McpToolArgs[T],
): Promise<McpToolResult[T]> {
  throw new Error(
    `TODO phase2: dispatchToExtension('${tool}') not implemented — wire up the Native Messaging bridge to the extension service worker`,
  );
}
