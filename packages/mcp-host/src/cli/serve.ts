import { Command, Option } from 'commander';
import { rmSync } from 'node:fs';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { startServer, stopServer } from '../index.js';
import { setExtensionTransport } from '../native/bridge.js';
import { createMockTransport } from '../native/mock-transport.js';
import { startTcpServer } from '../bridge/tcp-server.js';
import type { TcpServerHandle } from '../bridge/tcp-server.js';
import { TcpBridgeTransport } from '../bridge/tcp-transport.js';
import { endpointFilePath, removeEndpointFile, writeEndpointFile } from '../bridge/endpoint-file.js';

/**
 * serve：启动 MCP server（stdio 模式，默认命令），由 AI client spawn。
 * ⚠️ 此模式 stdout 被 MCP 协议占用，日志只能走 stderr。
 *
 * transport 注入（三进程方案 B，见 native/messaging.ts 头部注释）：
 * - 默认（无 --mock）：真实桥。启动 localhost TCP rendezvous server（动态端口），
 *   写入 endpoint 文件，注入 TcpBridgeTransport —— tool 调用经 TCP → host-B → NM → SW。
 * - --mock（隐藏 flag）：in-memory mock transport，返回 canned 数据，供演示/e2e。
 *
 * 启动顺序：1) TCP server listen(0) → 2) 写 endpoint 文件 → 3) 起 stdio MCP server
 * → 4) setExtensionTransport(TcpBridgeTransport) → 5) 进程退出 hook 清理。
 */
export function serveCommand(): Command {
  return new Command('serve')
    .description(
      'Start the MCP server over stdio (default command). The AI client spawns this process and speaks JSON-RPC over stdin/stdout.',
    )
    .option('--transport <mode>', "transport mode: 'stdio' (default). 'http' is reserved for phase 3 and throws TODO.", 'stdio')
    .addOption(
      new Option('--mock', 'inject the in-memory mock extension transport (demo/e2e only; default wires the real TCP↔Native-Messaging bridge)').hideHelp().default(false),
    )
    .action(async (options: { transport?: string; mock?: boolean }) => {
      // —— 真实桥（默认）：TCP rendezvous + TcpBridgeTransport ——
      let tcpServer: TcpServerHandle | null = null;
      let bridge: TcpBridgeTransport | null = null;
      let endpointPath = '';
      if (options.mock === true) {
        setExtensionTransport(createMockTransport());
        console.error('mcp-host: mock extension transport injected (demo mode)');
      } else {
        bridge = new TcpBridgeTransport();
        bridge.onEvent((msg) => {
          console.error(`mcp-host: host-B ${msg.event}`);
        });
        try {
          tcpServer = await startTcpServer({
            onConnection: (socket) => bridge?.attach(socket),
          });
        } catch (err) {
          console.error(`mcp-host: failed to start TCP rendezvous server: ${String(err)}`);
          process.exit(1);
        }
        setExtensionTransport(bridge);
        try {
          endpointPath = await writeEndpointFile({ port: tcpServer.port });
        } catch (err) {
          console.error(`mcp-host: failed to write endpoint file: ${String(err)}`);
          await tcpServer.close();
          process.exit(1);
        }
        console.error(`mcp-host: TCP rendezvous on 127.0.0.1:${tcpServer.port} (endpoint: ${endpointPath})`);
      }

      // —— stdio MCP server ——
      const mode = options.transport === 'http' ? 'http' : 'stdio';
      let server: McpServer;
      try {
        server = await startServer({ transport: mode });
      } catch (err) {
        console.error(`mcp-host: failed to start MCP server: ${String(err)}`);
        await cleanup(tcpServer, bridge, endpointPath);
        process.exit(1);
      }
      console.error('mcp-host: MCP server listening on stdio (Ctrl+C to exit)');

      // —— 退出清理：删 endpoint、关 TCP server、关 transport（best-effort）——
      const shutdown = async (): Promise<void> => {
        await cleanup(tcpServer, bridge, endpointPath);
        await stopServer(server);
        process.exit(0);
      };
      process.once('SIGINT', () => {
        void shutdown();
      });
      process.once('SIGTERM', () => {
        void shutdown();
      });
      // 自然退出（如 stdin EOF 导致事件循环排空）时的兜底
      process.once('beforeExit', () => {
        void cleanup(tcpServer, bridge, endpointPath);
      });
      // AI client 关闭 stdio（stdin EOF）→ MCP server 断开，但 TCP listener 仍持有事件循环，
      // 必须显式退出并清理（否则进程永不结束）
      process.stdin.on('end', () => {
        void shutdown();
      });
      // 任何路径都保证 endpoint 清理（同步，exit handler 内不能 await）
      process.once('exit', () => {
        if (endpointPath) {
          try {
            rmSync(endpointPath, { force: true });
          } catch {
            // best-effort
          }
        }
      });
    });
}

async function cleanup(
  tcpServer: TcpServerHandle | null,
  bridge: TcpBridgeTransport | null,
  endpointPath: string,
): Promise<void> {
  if (endpointPath) {
    await removeEndpointFile(endpointPath).catch(() => undefined);
  }
  await tcpServer?.close().catch(() => undefined);
  await bridge?.close().catch(() => undefined);
}
