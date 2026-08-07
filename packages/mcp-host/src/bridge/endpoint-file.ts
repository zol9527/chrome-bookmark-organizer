import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { BridgeError } from './tcp-protocol.js';

/**
 * host-A ↔ host-B 的 rendezvous 文件（endpoint 文件）。
 *
 * host-A（serve）在 TCP server listen 成功后写入单行 JSON；host-B（host 子命令）
 * 启动时读取，拿到 host-A 的 TCP 端口后回连。host-A 退出时 best-effort 删除。
 *
 * 平台路径（协议约定，不要改）：
 * - macOS: ~/Library/Application Support/com.loyd.chrome_bookmark_organizer/endpoint
 * - Linux: ~/.config/chrome-bookmark-organizer/endpoint
 */
export interface EndpointInfo {
  version: 1;
  port: number;
  pid: number;
  startedAt: number;
}

export const ENDPOINT_VERSION = 1 as const;

/** 平台相关的 rendezvous 文件绝对路径。 */
export function endpointFilePath(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'com.loyd.chrome_bookmark_organizer', 'endpoint');
  }
  return join(homedir(), '.config', 'chrome-bookmark-organizer', 'endpoint');
}

function isEndpointInfo(value: unknown): value is EndpointInfo {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === ENDPOINT_VERSION &&
    typeof v.port === 'number' &&
    Number.isInteger(v.port) &&
    v.port > 0 &&
    typeof v.pid === 'number' &&
    typeof v.startedAt === 'number'
  );
}

/** 写入 endpoint 文件（目录不存在则创建）。返回写入的路径。 */
export async function writeEndpointFile(options: {
  port: number;
  pid?: number;
  path?: string;
}): Promise<string> {
  const path = options.path ?? endpointFilePath();
  const payload: EndpointInfo = {
    version: ENDPOINT_VERSION,
    port: options.port,
    pid: options.pid ?? process.pid,
    startedAt: Date.now(),
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(payload) + '\n', 'utf8');
  return path;
}

/** 读取并校验 endpoint 文件；不存在/损坏/形状非法统一抛 ENDPOINT_NOT_FOUND。 */
export async function readEndpointFile(path: string = endpointFilePath()): Promise<EndpointInfo> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new BridgeError('ENDPOINT_NOT_FOUND', `endpoint file not found: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new BridgeError('ENDPOINT_NOT_FOUND', `endpoint file is not valid JSON: ${path}`);
  }
  if (!isEndpointInfo(parsed)) {
    throw new BridgeError('ENDPOINT_NOT_FOUND', `endpoint file has unexpected shape: ${path}`);
  }
  return parsed;
}

/** 删除 endpoint 文件（best-effort，幂等；host-A 退出清理用）。 */
export async function removeEndpointFile(path: string = endpointFilePath()): Promise<void> {
  await rm(path, { force: true }).catch(() => undefined);
}

/**
 * 轮询等待 endpoint 文件出现（host-B 启动时用）。
 * 默认 500ms 重试、最多 30s；超时抛 ENDPOINT_NOT_FOUND（host-A 未在跑）。
 */
export async function waitForEndpointFile(options: {
  timeoutMs?: number;
  intervalMs?: number;
  path?: string;
} = {}): Promise<EndpointInfo> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 500;
  const path = options.path ?? endpointFilePath();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await readEndpointFile(path);
    } catch {
      if (Date.now() >= deadline) {
        throw new BridgeError('ENDPOINT_NOT_FOUND', `endpoint file not found after ${timeoutMs}ms: ${path}`);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}
