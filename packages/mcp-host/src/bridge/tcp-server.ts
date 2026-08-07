import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';

/**
 * host-A(serve) 侧的 localhost TCP rendezvous server。
 *
 * 单连接策略（host-B 是单一长连接）：新连接到达时若已有连接，**关闭旧的、接受新的**——
 * 这样 SW 重启 / host-B 崩溃重连后 host-A 能自动恢复，无需重启 serve。
 * （另一种做法是拒绝新连接，但旧连接可能已是死链，会导致 host-A 永久失联，故不采用。）
 */
export interface TcpServerHandle {
  /** 实际监听的端口（listen(0) 由 OS 分配）。 */
  readonly port: number;
  /** 订阅新连接（可多次订阅）；返回取消订阅函数。 */
  onConnection(cb: (socket: Socket) => void): () => void;
  /** 关闭 server（先销毁当前连接，等待 server.close 回调）。 */
  close(): Promise<void>;
}

export function startTcpServer(options: {
  host?: string;
  onConnection?: (socket: Socket) => void;
} = {}): Promise<TcpServerHandle> {
  const host = options.host ?? '127.0.0.1';
  const listeners = new Set<(socket: Socket) => void>();
  if (options.onConnection) listeners.add(options.onConnection);

  return new Promise<TcpServerHandle>((resolve, reject) => {
    const server: Server = createServer();
    let current: Socket | null = null;

    server.on('connection', (socket: Socket) => {
      // 单连接策略：替换旧连接
      if (current && !current.destroyed) current.destroy();
      current = socket;
      socket.on('close', () => {
        if (current === socket) current = null;
      });
      socket.on('error', () => socket.destroy());
      for (const cb of [...listeners]) {
        try {
          cb(socket);
        } catch {
          // 单个订阅者抛错不阻断 accept 循环
        }
      }
    });

    const onError = (err: Error): void => reject(err);
    server.on('error', onError);
    server.listen({ host, port: 0 }, () => {
      server.off('error', onError);
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      resolve({
        port,
        onConnection: (cb: (socket: Socket) => void): (() => void) => {
          listeners.add(cb);
          return () => {
            listeners.delete(cb);
          };
        },
        close: (): Promise<void> =>
          new Promise((resolveClose) => {
            if (!server.listening) {
              resolveClose();
              return;
            }
            if (current && !current.destroyed) current.destroy();
            server.close(() => resolveClose());
          }),
      });
    });
  });
}
