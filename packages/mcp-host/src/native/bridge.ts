import type { McpToolArgs, McpToolName, McpToolResult } from '@cborg/shared';

/**
 * MCP tool → 扩展 SW 的可插拔 transport。
 *
 * phase 2（本阶段）：transport 抽象 + in-memory mock 实现（mock-transport.ts）。
 * 真实 NM 桥留 phase 3。
 *
 * phase 3（三进程方案 B，详见 native/messaging.ts 头部注释）：
 * - 主 MCP server 进程（serve）作为 NM host 的父进程，spawn NM host 子进程；
 * - 真实 transport 实现为「NM host 子进程桥」：把 tool 调用编码为 NmRequest 发给
 *   NM host，由 host 经 chrome.runtime.connectNative 的 NM 通道转发给扩展 SW，
 *   收到 NmResponse 后按 correlation id 配对返回。
 * - SW 端由 fixer-A 在 packages/extension 实现。
 */
export interface ExtensionTransport {
  call<T extends McpToolName>(tool: T, args: McpToolArgs[T]): Promise<McpToolResult[T]>;
  close(): Promise<void>;
}

let activeTransport: ExtensionTransport | null = null;

/** 注入当前生效的 transport（serve --mock 或 phase 3 的真实 NM 桥会调用）。 */
export function setExtensionTransport(transport: ExtensionTransport): void {
  activeTransport = transport;
}

/** 清除当前 transport（主要供测试重置全局状态）。 */
export function clearExtensionTransport(): void {
  activeTransport = null;
}

/**
 * 把 MCP tool 调用分发给当前 transport。
 * 未配置 transport 时同步抛错（调用方均为 async 上下文，会转为 rejection）。
 */
export function dispatchToExtension<T extends McpToolName>(
  tool: T,
  args: McpToolArgs[T],
): Promise<McpToolResult[T]> {
  if (!activeTransport) {
    throw new Error('No extension transport configured — start the server with --mock, or wire the real transport in phase 3');
  }
  return activeTransport.call(tool, args);
}
