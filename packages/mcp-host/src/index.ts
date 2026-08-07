/**
 * @cborg/mcp-host 公共 API 入口。
 *
 * - MCP server：createMcpServer / startServer / stopServer / registerTools
 * - Native Messaging：readMessage / writeMessage / runNmHost / dispatchToExtension
 * - 跨边界类型契约（直接转发自 @cborg/shared，供消费者引用）
 *
 * CLI（createCli / serve / register / doctor）是独立的构建入口（dist/cli），
 * 不从这里导出，避免主入口引入 commander 且与 cli 形成循环依赖。
 */
export { createMcpServer, startServer, stopServer } from './mcp/server.js';
export { registerTools } from './mcp/tools.js';
export { readMessage, writeMessage } from './native/messaging.js';
export { runNmHost } from './native/host.js';
export { dispatchToExtension } from './native/bridge.js';
export type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export type { McpToolArgs, McpToolName, McpToolResult, NmEvent, NmMessage, NmRequest, NmResponse } from '@cborg/shared';

import { startServer } from './mcp/server.js';
export default startServer;
