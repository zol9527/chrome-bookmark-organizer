import { MCP_TOOLS } from '@cborg/shared';
import type { McpToolName } from '@cborg/shared';

/**
 * host-A(serve) ↔ host-B(host 子命令) 之间的 localhost TCP 线协议。
 *
 * 帧格式：单行 UTF-8 JSON + `\n`（行分隔；半包由 LineReader 缓冲切分）。
 * 消息方向：
 * - host-A → host-B：{kind:'request'}（MCP tool 调用，id 为 host-A 生成的 correlation id）
 * - host-B → host-A：{kind:'response'}（SW 应答回传，id 与 request 一致）、{kind:'event'}
 * - host-B → host-A 握手：连上后发 {kind:'event', event:'connected'}
 */
export type WireMessage =
  | { kind: 'request'; id: string; tool: McpToolName; args: unknown }
  | { kind: 'response'; id: string; ok: true; result: unknown }
  | { kind: 'response'; id: string; ok: false; error: { code: string; message: string } }
  | { kind: 'event'; event: 'connected' | 'disconnected' | 'ready' };

/**
 * 结构化桥错误：code 是跨进程传播的错误标识
 * （EXTENSION_NOT_CONNECTED / TIMEOUT / NM_PROTOCOL_ERROR / ENDPOINT_NOT_FOUND）。
 */
export class BridgeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
  }
}

/** 线协议事件名集合（生命周期握手类；SW 的 plan_* NmEvent 无法用此联合类型表达，见 nm-bridge-host）。 */
export const WIRE_EVENTS = ['connected', 'disconnected', 'ready'] as const;

const TOOL_SET: ReadonlySet<string> = new Set(MCP_TOOLS);

/** 运行时形状校验：防止跨进程数据破坏类型契约（request.tool 必须是已注册 MCP tool）。 */
export function isWireMessage(value: unknown): value is WireMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.kind === 'request') {
    return typeof v.id === 'string' && typeof v.tool === 'string' && TOOL_SET.has(v.tool) && 'args' in v;
  }
  if (v.kind === 'response') {
    if (typeof v.id !== 'string' || typeof v.ok !== 'boolean') return false;
    if (v.ok === true) return 'result' in v;
    const err = v.error;
    return (
      typeof err === 'object' &&
      err !== null &&
      typeof (err as Record<string, unknown>).code === 'string' &&
      typeof (err as Record<string, unknown>).message === 'string'
    );
  }
  if (v.kind === 'event') {
    return v.event === 'connected' || v.event === 'disconnected' || v.event === 'ready';
  }
  return false;
}

/** 编码为「JSON + 换行」的行帧。 */
export function encodeWireMessage(msg: WireMessage): Buffer {
  return Buffer.concat([Buffer.from(JSON.stringify(msg), 'utf8'), Buffer.from('\n', 'utf8')]);
}

/** 解码并校验一行；形状非法抛 NM_PROTOCOL_ERROR。 */
export function parseWireMessage(line: string): WireMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch (err) {
    throw new BridgeError('NM_PROTOCOL_ERROR', `TCP wire protocol: invalid JSON: ${String(err)}`);
  }
  if (!isWireMessage(parsed)) {
    throw new BridgeError('NM_PROTOCOL_ERROR', 'TCP wire protocol: unexpected message shape');
  }
  return parsed;
}

/** 单条线消息上限（防御恶意/损坏对端撑爆内存；行内无换行即视为半包）。 */
const MAX_LINE_BYTES = 1024 * 1024;

/**
 * 半包缓冲的行切分器：把 socket 的 data chunk 按 `\n` 切成完整行再回调。
 * 空行直接跳过；缓冲超限抛 NM_PROTOCOL_ERROR（调用方应销毁对端 socket）。
 */
export class LineReader {
  private buffer = '';

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: Buffer | string): void {
    this.buffer += chunk.toString('utf8');
    if (this.buffer.length > MAX_LINE_BYTES) {
      this.buffer = '';
      throw new BridgeError('NM_PROTOCOL_ERROR', `TCP wire protocol: line exceeds ${MAX_LINE_BYTES} bytes`);
    }
    for (;;) {
      const idx = this.buffer.indexOf('\n');
      if (idx < 0) break;
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.length > 0) this.onLine(line);
    }
  }
}
