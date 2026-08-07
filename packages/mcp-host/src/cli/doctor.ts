import { access, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Command } from 'commander';
import { NM_HOST_NAME } from '@cborg/shared';
import type { NmMessage, NmRequest } from '@cborg/shared';
import { readMessage, writeMessage } from '../native/messaging.js';
import { DEFAULT_HOST_BIN, EXTENSION_ID_PLACEHOLDER, NM_BROWSER_DIRS, PACKAGE_ROOT } from './register.js';

type CheckResult = { label: string; status: 'ok' | 'warn' | 'fail'; detail: string };

const ECHO_TIMEOUT_MS = 5000;

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

/** 检查 2：host 二进制（manifest 的 path 目标）存在且可执行。 */
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

/** 检查 3：自 spawn 一个 NM host（隐藏 `host` 命令），走一遍 echo 往返。 */
async function checkSpawnEcho(): Promise<CheckResult> {
  const distCli = join(PACKAGE_ROOT, 'dist', 'cli', 'index.js');
  try {
    await access(distCli, fsConstants.F_OK);
  } catch {
    return {
      label: 'NM host echo',
      status: 'fail',
      detail: 'dist build missing — run `pnpm --filter @cborg/mcp-host build` first',
    };
  }
  const child = spawn(process.execPath, [DEFAULT_HOST_BIN, 'host'], {
    stdio: ['pipe', 'pipe', 'inherit'] as const,
  });
  try {
    const req: NmRequest = { kind: 'request', id: 'doctor-echo-1', tool: 'bookmark_count', args: null };
    const echo = (async (): Promise<NmMessage> => {
      await writeMessage(req, child.stdin);
      return readMessage(child.stdout);
    })();
    echo.catch(() => undefined); // 竞速后到达的失败（如 EPIPE）不产生 unhandled rejection
    const reply = await Promise.race([
      echo,
      new Promise<NmMessage>((_, reject) => {
        setTimeout(() => reject(new Error(`echo timeout after ${ECHO_TIMEOUT_MS}ms`)), ECHO_TIMEOUT_MS);
      }),
    ]);
    if (reply.kind === 'response' && reply.ok) {
      return { label: 'NM host echo', status: 'ok', detail: `round-trip ${req.tool} → ok` };
    }
    return { label: 'NM host echo', status: 'fail', detail: 'unexpected reply shape' };
  } catch (err) {
    return { label: 'NM host echo', status: 'fail', detail: String(err) };
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
 * doctor：诊断 NM host 环境。任一检查 fail 则退出码为 1。
 */
export function doctorCommand(): Command {
  return new Command('doctor')
    .description('Diagnose the Native Messaging host setup (manifest, extension ID, binary, spawn echo)')
    .action(async () => {
      const results: CheckResult[] = [
        ...(await checkManifests()),
        await checkHostBin(),
        await checkSpawnEcho(),
      ];
      printTable(results);
      process.exitCode = results.some((r) => r.status === 'fail') ? 1 : 0;
    });
}
