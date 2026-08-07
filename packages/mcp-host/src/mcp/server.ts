import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MCP_SERVER_INFO } from '@cborg/shared';
import { registerTools } from './tools.js';

/**
 * 创建并配置 MCP server（绑定全部 tool，元信息取自 shared 的 MCP_SERVER_INFO）。
 *
 * @param transport 'stdio'：可连接 StdioServerTransport（本阶段唯一模式）；
 *   'http'：phase 3 预留（三进程方案 B 中，NM host 子进程作为 localhost HTTP client
 *   连接此端点，见 native/messaging.ts 头部注释），当前抛 TODO。
 */
export function createMcpServer(transport: 'stdio' | 'http' = 'stdio'): McpServer {
  if (transport !== 'stdio') {
    throw new Error('TODO phase3: HTTP transport for MCP server (Streamable HTTP / SSE) is not implemented');
  }
  const server = new McpServer(MCP_SERVER_INFO);
  registerTools(server);
  return server;
}

/**
 * 启动 MCP server 并连接 transport。
 * stdio 模式下连接成功后进程保持存活，等待 AI client 的 JSON-RPC 消息（Ctrl+C 退出）；
 * stdin 关闭（EOF）时 StdioServerTransport 会自动断开连接。
 */
export async function startServer(options: { transport?: 'stdio' | 'http' } = {}): Promise<McpServer> {
  const mode = options.transport ?? 'stdio';
  const server = createMcpServer(mode);
  if (mode === 'stdio') {
    await server.connect(new StdioServerTransport());
  }
  return server;
}

/**
 * 停止 server 并断开 transport（幂等：已断开时 close 也是安全的）。
 */
export async function stopServer(server: McpServer): Promise<void> {
  await server.close().catch(() => undefined);
}
