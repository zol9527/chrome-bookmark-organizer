import { connect } from 'node:net';
import type { Socket } from 'node:net';
import { BridgeError, LineReader, encodeWireMessage, parseWireMessage } from './tcp-protocol.js';
import type { WireMessage } from './tcp-protocol.js';

/**
 * host-B(host 子命令) 侧的 TCP 客户端封装：
 * 行协议解码（半包自动缓冲）+ send / onMessage / onClose / onError。
 */
export class TcpClient {
  readonly socket: Socket;
  private readonly lineReader: LineReader;
  private readonly messageHandlers = new Set<(msg: WireMessage) => void>();
  private readonly closeHandlers = new Set<() => void>();
  private readonly errorHandlers = new Set<(err: Error) => void>();
  private closed = false;

  constructor(socket: Socket) {
    this.socket = socket;
    this.lineReader = new LineReader((line) => {
      try {
        const msg = parseWireMessage(line);
        for (const handler of [...this.messageHandlers]) handler(msg);
      } catch {
        // 协议错误：对端不干净，断开
        this.socket.destroy();
      }
    });
    socket.on('data', (chunk: Buffer) => {
      try {
        this.lineReader.push(chunk);
      } catch {
        this.socket.destroy();
      }
    });
    socket.on('close', () => {
      if (this.closed) return;
      this.closed = true;
      for (const handler of [...this.closeHandlers]) handler();
    });
    socket.on('error', (err: Error) => {
      for (const handler of [...this.errorHandlers]) handler(err);
      this.socket.destroy();
    });
  }

  /** 订阅 host-A 发来的线消息；返回取消订阅函数。 */
  onMessage(cb: (msg: WireMessage) => void): () => void {
    this.messageHandlers.add(cb);
    return () => {
      this.messageHandlers.delete(cb);
    };
  }

  /** 订阅连接关闭；返回取消订阅函数。 */
  onClose(cb: () => void): () => void {
    this.closeHandlers.add(cb);
    return () => {
      this.closeHandlers.delete(cb);
    };
  }

  /** 订阅连接错误；返回取消订阅函数。 */
  onError(cb: (err: Error) => void): () => void {
    this.errorHandlers.add(cb);
    return () => {
      this.errorHandlers.delete(cb);
    };
  }

  /** 发送一条线协议消息；连接已关闭时静默丢弃（host-A 死后不再有意义）。 */
  send(msg: WireMessage): void {
    if (this.closed) return;
    this.socket.write(encodeWireMessage(msg));
  }

  close(): void {
    this.socket.destroy();
  }
}

/** 连接 host-A 的 TCP 端口；connect 失败或超时抛错。 */
export function connectToHost(
  port: number,
  options: { host?: string; timeoutMs?: number } = {},
): Promise<TcpClient> {
  const host = options.host ?? '127.0.0.1';
  const timeoutMs = options.timeoutMs ?? 10_000;
  return new Promise<TcpClient>((resolve, reject) => {
    const socket = connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new BridgeError('TCP_CONNECT_TIMEOUT', `connect to host-A ${host}:${port} timed out`));
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(new TcpClient(socket));
    });
    socket.once('error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
