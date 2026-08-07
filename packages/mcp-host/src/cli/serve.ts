import { Command } from 'commander';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { startServer, stopServer } from '../index.js';

/**
 * serve：启动 MCP server（stdio 模式，默认命令）。
 * 由 AI client spawn，stdin/stdout 传输 MCP JSON-RPC（StdioServerTransport 自动处理）。
 * ⚠️ 此模式 stdout 被 MCP 协议占用，日志只能走 stderr。
 */
export function serveCommand(): Command {
  return new Command('serve')
    .description(
      'Start the MCP server over stdio (default command). The AI client spawns this process and speaks JSON-RPC over stdin/stdout.',
    )
    .option('--transport <mode>', "transport mode: 'stdio' (default). 'http' is reserved for phase 2 and throws TODO.", 'stdio')
    .action(async (options: { transport?: string }) => {
      const transport = options.transport === 'http' ? 'http' : 'stdio';
      let server: McpServer;
      try {
        server = await startServer({ transport });
      } catch (err) {
        console.error(`mcp-host: failed to start MCP server: ${String(err)}`);
        process.exit(1);
      }
      console.error('mcp-host: MCP server listening on stdio (Ctrl+C to exit)');
      const shutdown = async (): Promise<void> => {
        await stopServer(server).catch(() => undefined);
        process.exit(0);
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    });
}
