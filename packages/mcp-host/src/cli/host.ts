import { Command } from 'commander';
import { connectToHost } from '../bridge/tcp-client.js';
import { waitForEndpointFile } from '../bridge/endpoint-file.js';
import type { EndpointInfo } from '../bridge/endpoint-file.js';
import type { TcpClient } from '../bridge/tcp-client.js';
import { runNmBridgeHost } from '../bridge/nm-bridge-host.js';

/**
 * host：以 host-B 模式运行（被 chrome.runtime.connectNative 通过 register 写入的
 * manifest 拉起；也可手动/doctor 自测 spawn）。
 *
 * 启动顺序：
 *   1. 读 rendezvous endpoint 文件（500ms 重试，最多 30s，超时 exit 1）；
 *   2. 连接 host-A 的 localhost TCP（127.0.0.1:<port>）；
 *   3. 连上后由 runNmBridgeHost 发出 {kind:'event', event:'connected'} 握手；
 *   4. 起双向桥：TCP request → NM (stdout→SW)，SW 的 NmResponse → TCP → host-A。
 *
 * ⚠️ 本进程 stdout 专用于 NM 协议，日志一律走 stderr（console.error）。
 */
export function hostCommand(): Command {
  return new Command('host')
    .argument('[origin]', 'caller chrome-extension:// origin (passed automatically when spawned via Native Messaging)')
    .description(
      'Run as the Native Messaging bridge host (spawned by chrome.runtime.connectNative; bridges host-A TCP to the extension service worker over Native Messaging)',
    )
    .allowExcessArguments(true)
    .action(async (origin?: string) => {
      if (origin) {
        console.error(`cborg-mcp-host: invoked by ${origin}`);
      }
      await runHostCommand();
    });
}

/** host-B 的完整启动流程（独立导出便于测试与复用）。 */
export async function runHostCommand(): Promise<void> {
  let endpoint: EndpointInfo;
  try {
    endpoint = await waitForEndpointFile();
  } catch (err) {
    console.error(`cborg-mcp-host: ${err instanceof Error ? err.message : String(err)}`);
    console.error('cborg-mcp-host: is host-A running? Start it with `cborg-mcp-host serve`.');
    process.exit(1);
  }

  let client: TcpClient;
  try {
    client = await connectToHost(endpoint.port);
  } catch (err) {
    console.error(
      `cborg-mcp-host: failed to connect to host-A on 127.0.0.1:${endpoint.port}: ${err instanceof Error ? err.message : String(err)}`,
    );
    console.error('cborg-mcp-host: stale endpoint? Restart `cborg-mcp-host serve`.');
    process.exit(1);
  }
  console.error(`cborg-mcp-host: connected to host-A on 127.0.0.1:${endpoint.port} — starting bridge`);

  const code = await runNmBridgeHost({ client });
  process.exit(code);
}
