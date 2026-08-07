import { randomUUID } from 'node:crypto';
import type { Socket } from 'node:net';
import type { McpToolArgs, McpToolName, McpToolResult } from '@cborg/shared';
import type { ExtensionTransport } from '../native/bridge.js';
import { BridgeError, LineReader, encodeWireMessage, parseWireMessage } from './tcp-protocol.js';
import type { WireMessage } from './tcp-protocol.js';

interface PendingCall {
  /** 该请求发出时所在的 socket（连接被替换/关闭时只清本 socket 的挂起）。 */
  socket: Socket;
  timer: ReturnType<typeof setTimeout>;
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

/** 默认 30s：SW 侧自己的超时是 15s（见 extension/nm-bridge.ts），host-A 侧留足余量。 */
const DEFAULT_CALL_TIMEOUT_MS = 30_000;

export type WireEvent = Extract<WireMessage, { kind: 'event' }>;

/**
 * host-A 侧的 ExtensionTransport 实现（三进程桥的 host-A 半段）：
 *
 *   call(tool, args) → TCP request → host-B → NM → SW → NmResponse → TCP response
 *
 * - 当前无 host-B 连接 → 抛 EXTENSION_NOT_CONNECTED；
 * - 发 {kind:'request'} 并等待相同 correlation id 的 {kind:'response'}（30s 超时）；
 * - ok=false 时把 {code,message} 包装为 BridgeError 抛回；
 * - host-B 的 {kind:'event'} 透传给 onEvent 订阅者（serve 可选监听，仅日志）。
 */
export class TcpBridgeTransport implements ExtensionTransport {
  private socket: Socket | null = null;
  private readonly pending = new Map<string, PendingCall>();
  private readonly eventHandlers = new Set<(msg: WireEvent) => void>();
  private readonly lineReader = new LineReader((line) => this.onLine(line));
  private readonly callTimeoutMs: number;
  private closed = false;

  constructor(options: { callTimeoutMs?: number } = {}) {
    this.callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  }

  /** host-B 连接建立（或重连）时由 TCP server 注入 socket。 */
  attach(socket: Socket): void {
    this.socket = socket;
    socket.on('data', (chunk: Buffer) => {
      try {
        this.lineReader.push(chunk);
      } catch {
        socket.destroy();
      }
    });
    socket.on('close', () => this.onSocketClosed(socket));
    socket.on('error', () => socket.destroy());
  }

  /** 订阅 host-B 的握手事件（connected/disconnected），供 serve 打日志。 */
  onEvent(cb: (msg: WireEvent) => void): () => void {
    this.eventHandlers.add(cb);
    return () => {
      this.eventHandlers.delete(cb);
    };
  }

  private onLine(line: string): void {
    let msg: WireMessage;
    try {
      msg = parseWireMessage(line);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.failAllPending(error);
      this.socket?.destroy();
      return;
    }
    if (msg.kind === 'response') {
      this.onResponse(msg);
    } else if (msg.kind === 'event') {
      for (const handler of [...this.eventHandlers]) handler(msg);
    } else {
      // host-A 不会向 host-B 发 request；host-B 主动发 request 属协议异常，忽略
      console.error(`mcp-host: unexpected 'request' from host-B (id=${msg.id}), ignoring`);
    }
  }

  private onResponse(msg: Extract<WireMessage, { kind: 'response' }>): void {
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(msg.id);
    if (msg.ok === true) {
      entry.resolve(msg.result);
    } else {
      entry.reject(new BridgeError(msg.error.code, msg.error.message));
    }
  }

  private onSocketClosed(socket: Socket): void {
    if (this.socket === socket) this.socket = null;
    // 只清在「这个 socket」上发出的挂起请求（新连接可能已就位）
    for (const [id, entry] of this.pending) {
      if (entry.socket === socket) {
        clearTimeout(entry.timer);
        entry.reject(
          new BridgeError('EXTENSION_NOT_CONNECTED', 'Chrome extension not running or host-B not connected'),
        );
        this.pending.delete(id);
      }
    }
  }

  private failAllPending(err: Error): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
      this.pending.delete(id);
    }
  }

  call<T extends McpToolName>(tool: T, args: McpToolArgs[T]): Promise<McpToolResult[T]> {
    const socket = this.socket;
    if (!socket || socket.destroyed || this.closed) {
      return Promise.reject(
        new BridgeError('EXTENSION_NOT_CONNECTED', 'Chrome extension not running or host-B not connected'),
      );
    }
    const id = randomUUID();
    const msg: WireMessage = { kind: 'request', id, tool, args };
    return new Promise<McpToolResult[T]>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new BridgeError('TIMEOUT', `tool call '${tool}' timed out after ${this.callTimeoutMs}ms`));
        }
      }, this.callTimeoutMs);
      this.pending.set(id, {
        socket,
        timer,
        resolve: (result) => resolve(result as McpToolResult[T]),
        reject,
      });
      socket.write(encodeWireMessage(msg), (err) => {
        if (err) {
          const entry = this.pending.get(id);
          if (entry) {
            clearTimeout(entry.timer);
            this.pending.delete(id);
            reject(new BridgeError('EXTENSION_NOT_CONNECTED', `failed to send to host-B: ${err.message}`));
          }
        }
      });
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.failAllPending(new BridgeError('EXTENSION_NOT_CONNECTED', 'transport closed'));
    this.socket?.destroy();
    this.socket = null;
  }
}
