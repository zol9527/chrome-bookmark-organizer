import type { NmMessage, NmResponse } from '@cborg/shared';
import type { TcpClient } from './tcp-client.js';
import { readMessage, writeMessage } from '../native/messaging.js';
import { BridgeError } from './tcp-protocol.js';
import type { WireMessage } from './tcp-protocol.js';

/**
 * host-B(host 子命令) 的双向桥：host-A(TCP) ↔ 扩展 SW(Native Messaging)。
 *
 * 方向：
 * - TCP request → NM：host-A 的 tool 调用 → NmRequest（**id 沿用 TCP 的 callId**，
 *   整条链路 host-A→host-B→SW 用同一 id 追踪）→ writeMessage 到 stdout → 等 SW 回
 *   NmResponse（kind:'response', id 同 callId）→ 转 TCP response 发回 host-A。
 * - NM response → TCP：按 id 查 pending Map，resolve/reject 对应 promise，
 *   应答由发起方（handleTcpRequest）转成 TCP response 写回 host-A。
 * - NM event → TCP：SW 主动推的 NmEvent。⚠️ TCP wire 协议的 event 联合类型只有
 *   connected/disconnected/ready（协议设计如此），SW 的 plan_* 事件无法表达，
 *   这里记录日志并丢弃（不发明新的 wire 事件名）。
 * - TCP socket disconnect → 退出（host-A 死，host-B 无意义），exit 0。
 * - NM EOF（SW 断开 connectNative）→ 退出，exit 0。
 *
 * ⚠️ 本进程 stdout 专用于 NM 协议，日志一律走 stderr（默认 logger = console.error）。
 */
export interface NmBridgeHostOptions {
  /** host-A 的 TCP 连接（由 connectToHost 建立）。 */
  client: TcpClient;
  /** 默认 readMessage(process.stdin)。 */
  readNm?: () => Promise<NmMessage>;
  /** 默认 writeMessage(process.stdout)。 */
  writeNm?: (msg: NmMessage) => Promise<void>;
  /** 单次 NM 请求等待 SW 应答的超时（默认 30s，超时回 TIMEOUT 给 host-A）。 */
  requestTimeoutMs?: number;
  logger?: (line: string) => void;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

interface PendingNm {
  timer: ReturnType<typeof setTimeout>;
  resolve: (msg: NmResponse) => void;
  reject: (err: Error) => void;
}

/** NmRequest.args 是对象（McpToolArgs 均为对象）；非对象统一归一为 null。 */
function toNmArgs(args: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof args === 'object' && args !== null && !Array.isArray(args)) {
    return args as Readonly<Record<string, unknown>>;
  }
  return null;
}

/** NmResponse → TCP response（ok 为 boolean 非判别联合，显式判断；result undefined 归 null）。 */
function responseToWire(resp: NmResponse): Extract<WireMessage, { kind: 'response' }> {
  if (resp.ok === true) {
    return { kind: 'response', id: resp.id, ok: true, result: resp.result ?? null };
  }
  const error = resp.error ?? { code: 'NM_PROTOCOL_ERROR', message: 'SW returned error without code' };
  return { kind: 'response', id: resp.id, ok: false, error: { code: error.code, message: error.message } };
}

/**
 * 运行双向桥，返回进程退出码（host-A 死 / SW 断开 → 0；协议/IO 错误 → 1）。
 * 该 Promise 由退出路径 resolve；NM 读循环可能永久阻塞在 readNm 上（无碍，由调用方 exit）。
 */
export function runNmBridgeHost(options: NmBridgeHostOptions): Promise<number> {
  const client = options.client;
  const readNm = options.readNm ?? readMessage;
  const writeNm = options.writeNm ?? writeMessage;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const logger = options.logger ?? ((line: string): void => console.error(line));

  return new Promise<number>((resolveExit) => {
    const pending = new Map<string, PendingNm>();
    let settled = false;

    const exit = (code: number, reason: string): void => {
      if (settled) return;
      settled = true;
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(new BridgeError('NM_PROTOCOL_ERROR', `bridge exiting: ${reason}`));
        pending.delete(id);
      }
      client.close();
      if (reason) logger(`nm-bridge-host: exiting(${code}) — ${reason}`);
      resolveExit(code);
    };

    // —— TCP request → NM：把 host-A 的 tool 调用投递给 SW，等应答后写回 host-A ——
    const handleTcpRequest = async (msg: Extract<WireMessage, { kind: 'request' }>): Promise<void> => {
      const nmRequest: NmMessage = { kind: 'request', id: msg.id, tool: msg.tool, args: toNmArgs(msg.args) };
      try {
        // 关键：先经 NM stdout 把请求发给 SW（Chrome 的 connectNative 管道）
        await writeNm(nmRequest);
        const reply = await new Promise<NmResponse>((resolve, reject) => {
          const timer = setTimeout(() => {
            if (pending.delete(msg.id)) {
              reject(new BridgeError('TIMEOUT', `NM request '${msg.tool}' timed out after ${requestTimeoutMs}ms`));
            }
          }, requestTimeoutMs);
          pending.set(msg.id, { timer, resolve, reject });
        });
        client.send(responseToWire(reply));
      } catch (err) {
        const entry = pending.get(msg.id);
        if (entry) {
          clearTimeout(entry.timer);
          pending.delete(msg.id);
        }
        // 保留结构化 code（BridgeError 的 code 如 TIMEOUT 原样传播）；非 BridgeError 归 NM_PROTOCOL_ERROR
        const code = err instanceof BridgeError ? err.code : 'NM_PROTOCOL_ERROR';
        client.send({
          kind: 'response',
          id: msg.id,
          ok: false,
          error: { code, message: err instanceof Error ? err.message : String(err) },
        });
      }
    };

    const handleTcpMessage = (msg: WireMessage): void => {
      if (msg.kind === 'request') {
        // 并发安全：每个 request 独立 pending 条目
        void handleTcpRequest(msg);
      } else {
        logger(`nm-bridge-host: unexpected message from host-A (kind='${msg.kind}'), ignoring`);
      }
    };

    // —— NM 读循环：SW 的应答 → resolve pending；事件/协议异常 → 记录或退出 ——
    const nmReadLoop = async (): Promise<void> => {
      for (;;) {
        let msg: NmMessage;
        try {
          msg = await readNm();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.startsWith('NM EOF')) {
            exit(0, 'SW disconnected (NM EOF)');
          } else {
            logger(`nm-bridge-host: NM read error: ${message}`);
            exit(1, message);
          }
          return;
        }
        if (msg.kind === 'response') {
          const entry = pending.get(msg.id);
          if (entry) {
            clearTimeout(entry.timer);
            pending.delete(msg.id);
            entry.resolve(msg);
          } else {
            logger(`nm-bridge-host: NmResponse for unknown id '${msg.id}' — dropping`);
          }
        } else if (msg.kind === 'event') {
          logger(
            `nm-bridge-host: NmEvent('${msg.event}') from SW dropped (not representable on TCP wire protocol)`,
          );
        } else {
          logger('nm-bridge-host: unexpected NmRequest from SW — host-B is a bridge, not a dispatcher; ignoring');
        }
      }
    };

    // TCP 断开（host-A 死）→ host-B 无意义，exit 0。
    // error（如 ECONNRESET）只记录日志：TcpClient 的 error 处理会随后 destroy socket，
    // 由 'close' 统一驱动退出——避免把 host-A 宕机误判为协议错误(exit 1)。
    client.onClose(() => exit(0, 'host-A TCP connection closed'));
    client.onError((err: Error) => {
      logger(`nm-bridge-host: TCP error: ${err.message}`);
    });
    client.onMessage(handleTcpMessage);

    // 握手：告知 host-A 已连接（host-A 可选监听，仅日志）
    client.send({ kind: 'event', event: 'connected' });

    void nmReadLoop();
  });
}
