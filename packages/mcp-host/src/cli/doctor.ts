import { access, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Command } from 'commander';
import { NM_HOST_NAME } from '@cborg/shared';
import { DEFAULT_HOST_BIN, EXTENSION_ID_PLACEHOLDER, NM_BROWSER_DIRS, PACKAGE_ROOT } from './register.js';
import { connectToHost } from '../bridge/tcp-client.js';
import type { TcpClient } from '../bridge/tcp-client.js';
import { endpointFilePath, readEndpointFile } from '../bridge/endpoint-file.js';
import type { EndpointInfo } from '../bridge/endpoint-file.js';

type CheckResult = { label: string; status: 'ok' | 'warn' | 'fail'; detail: string };

const SPAWN_WAIT_MS = 6000;
const TCP_PING_TIMEOUT_MS = 2000;

/** 检查 1：各浏览器 manifest 是否存在、扩展 ID 是否已替换占位符。 */
async function checkManifests(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const dir of NM_BROWSER_DIRS) {
    const target = join(homedir(), 'Library', 'Application Support', dir, `${NM_HOST_NAME}.json`);
    const label = `manifest (${dir.split('/')[0]})`;
    try {
      const raw = await readFile(target, 'utf8');
      const parsed = JSON.parse(raw) as { allowed_origins?: string[] };
      const origins = parsed.allowed_origins ?? [];
      if (origins.some((o) => /^chrome-extension:\/\/[a-p]{32}\/$/i.test(o))) {
        results.push({ label, status: 'ok', detail: target });
      } else if (origins.includes(`chrome-extension://${EXTENSION_ID_PLACEHOLDER}/`)) {
        results.push({
          label,
          status: 'warn',
          detail: `${target} — extension ID is still the placeholder, replace allowed_origins`,
        });
      } else {
        results.push({ label, status: 'warn', detail: `${target} — allowed_origins missing or unexpected` });
      }
    } catch {
      results.push({ label, status: 'fail', detail: 'manifest not found or unreadable' });
    }
  }
  return results;
}

/** 检查 2：host 二进制（manifest 的 path 里 <bin> 部分）存在且可执行。 */
async function checkHostBin(): Promise<CheckResult> {
  try {
    await access(DEFAULT_HOST_BIN, fsConstants.X_OK);
    return { label: 'host binary', status: 'ok', detail: `${DEFAULT_HOST_BIN} (executable)` };
  } catch {
    return {
      label: 'host binary',
      status: 'fail',
      detail: `${DEFAULT_HOST_BIN} missing or not executable — run \`pnpm --filter @cborg/mcp-host build\``,
    };
  }
}

/** 检查 3：host-A 的 rendezvous endpoint 文件存在且可解析。 */
async function checkEndpointFile(): Promise<CheckResult> {
  try {
    const info = await readEndpointFile();
    return {
      label: 'host-A endpoint',
      status: 'ok',
      detail: `${endpointFilePath()} — port ${info.port}, pid ${info.pid}`,
    };
  } catch {
    return {
      label: 'host-A endpoint',
      status: 'warn',
      detail: 'no endpoint file — host-A (serve) not running; start `cborg-mcp-host serve` first',
    };
  }
}

/**
 * 检查 4：TCP ping —— net.connect 到 endpoint.port，连上即 host-A 在跑。
 * ⚠️ host-A 是单连接策略（关旧接新），ping 会短暂替换当前 host-B 连接；
 * 若此刻 Chrome/SW 有真实桥在跑会被打断（SW 侧 port 断开，需重连）。
 */
async function checkTcpPing(): Promise<CheckResult> {
  let info: EndpointInfo;
  try {
    info = await readEndpointFile();
  } catch {
    return { label: 'host-A TCP ping', status: 'warn', detail: 'skipped (no endpoint file — run `serve` first)' };
  }
  let client: TcpClient | null = null;
  try {
    const c = await connectToHost(info.port, { timeoutMs: TCP_PING_TIMEOUT_MS });
    client = c;
    return {
      label: 'host-A TCP ping',
      status: 'ok',
      detail: `127.0.0.1:${info.port} reachable (host-A serve alive)`,
    };
  } catch (err) {
    return {
      label: 'host-A TCP ping',
      status: 'fail',
      detail: `127.0.0.1:${info.port} unreachable — stale endpoint or host-A down: ${String(err)}`,
    };
  } finally {
    client?.close();
  }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 检查 5：自 spawn 一个 host-B（隐藏 `host` 命令）验证启动路径。
 *
 * 现在的 host-B 需要 host-A 在跑（读 endpoint → 连 TCP → 进桥循环），与旧版
 * in-process echo 不同：
 * - host-A 未在跑：host-B 应快速以 exit 1 退出（ENDPOINT_NOT_FOUND），记为 warn（正常态）；
 * - host-A 在跑：host-B 应连上 host-A 的 TCP 并保持存活，记为 ok。
 */
async function checkSpawnEcho(): Promise<CheckResult> {
  const distCli = join(PACKAGE_ROOT, 'dist', 'cli', 'index.js');
  try {
    await access(distCli, fsConstants.F_OK);
  } catch {
    return {
      label: 'host-B self-spawn',
      status: 'fail',
      detail: 'dist build missing — run `pnpm --filter @cborg/mcp-host build` first',
    };
  }
  let endpointPresent = false;
  try {
    await readEndpointFile();
    endpointPresent = true;
  } catch {
    endpointPresent = false;
  }

  // host-A 未在跑：host-B 会按协议轮询 endpoint 最多 30s 才退出，doctor 不等那么久——
  // 该场景下 self-spawn 没有意义，直接跳过（记为 warn，不是 fail）。
  if (!endpointPresent) {
    return {
      label: 'host-B self-spawn',
      status: 'warn',
      detail: 'skipped (host-A not running — start `cborg-mcp-host serve` first)',
    };
  }

  const child = spawn(process.execPath, [DEFAULT_HOST_BIN, 'host'], {
    stdio: ['pipe', 'pipe', 'pipe'] as const,
  });
  let stderrTail = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-500);
  });

  try {
    // host-A 在跑：等 host-B 连上 host-A 的 TCP（或退出）
    const deadline = Date.now() + SPAWN_WAIT_MS;
    while (Date.now() < deadline) {
      const code = child.exitCode;
      if (code !== null) {
        return {
          label: 'host-B self-spawn',
          status: 'fail',
          detail: `host-B exited early (${code}): ${stderrTail}`,
        };
      }
      if (stderrTail.includes('connected to host-A')) {
        return {
          label: 'host-B self-spawn',
          status: 'ok',
          detail: 'spawned, read endpoint, connected to host-A TCP bridge',
        };
      }
      await delay(100);
    }
    return {
      label: 'host-B self-spawn',
      status: 'fail',
      detail: `host-B neither connected nor exited within ${SPAWN_WAIT_MS}ms: ${stderrTail}`,
    };
  } finally {
    child.kill();
  }
}

function printTable(results: CheckResult[]): void {
  const width = Math.max(...results.map((r) => r.label.length), 12) + 2;
  console.log('');
  console.log(`  ${'CHECK'.padEnd(width)}STATUS   DETAIL`);
  console.log(`  ${'-'.repeat(width)}-------   ${'-'.repeat(64)}`);
  for (const r of results) {
    console.log(`  ${r.label.padEnd(width)}${r.status.padEnd(8)}${r.detail}`);
  }
  console.log('');
}

/**
 * doctor：诊断 NM host 环境（manifest / host 二进制 / endpoint / TCP ping / host-B 自 spawn）。
 * 任一检查 fail 则退出码为 1。
 */
export function doctorCommand(): Command {
  return new Command('doctor')
    .description(
      'Diagnose the Native Messaging bridge setup (manifest, extension ID, binary, host-A endpoint, TCP ping, host-B self-spawn)',
    )
    .action(async () => {
      const results: CheckResult[] = [
        ...(await checkManifests()),
        await checkHostBin(),
        await checkEndpointFile(),
        await checkTcpPing(),
        await checkSpawnEcho(),
      ];
      printTable(results);
      process.exitCode = results.some((r) => r.status === 'fail') ? 1 : 0;
    });
}
