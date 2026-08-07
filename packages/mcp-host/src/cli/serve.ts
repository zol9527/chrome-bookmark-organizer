import { Command, Option } from 'commander';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { startServer, stopServer } from '../index.js';
import { setExtensionTransport } from '../native/bridge.js';
import { createMockTransport } from '../native/mock-transport.js';

/**
 * serve：启动 MCP server（stdio 模式，默认命令）。
 * 由 AI client spawn，stdin/stdout 传输 MCP JSON-RPC（StdioServerTransport 自动处理）。
 * ⚠️ 此模式 stdout 被 MCP 协议占用，日志只能走 stderr。
 *
 * transport 注入：
 * - 默认不注入 —— tool 调用会得到 "No extension transport configured" 错误；
 * - --mock（隐藏 flag）注入 in-memory mock transport，返回 canned 数据，供演示/e2e；
 * - phase 3：serve 进程 spawn NM host 子进程并把真实 NM 桥设为 transport
 *   （三进程方案 B，见 native/messaging.ts 头部注释）。
 */
export function serveCommand(): Command {
  return new Command('serve')
    .description(
      'Start the MCP server over stdio (default command). The AI client spawns this process and speaks JSON-RPC over stdin/stdout.',
    )
    .option('--transport <mode>', "transport mode: 'stdio' (default). 'http' is reserved for phase 3 and throws TODO.", 'stdio')
    .addOption(
      new Option('--mock', 'inject the in-memory mock extension transport (demo/e2e only; phase 3 wires the real Native Messaging bridge)').hideHelp().default(false),
    )
    .action(async (options: { transport?: string; mock?: boolean }) => {
      if (options.mock === true) {
        setExtensionTransport(createMockTransport());
        console.error('mcp-host: mock extension transport injected (demo mode)');
      }
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
        await stopServer(server);
        process.exit(0);
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    });
}
