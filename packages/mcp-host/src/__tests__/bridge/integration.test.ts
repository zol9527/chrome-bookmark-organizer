import { afterEach, describe, expect, it } from 'vitest';
import { connect } from 'node:net';
import type { Socket } from 'node:net';
import type { NmMessage, NmRequest, NmResponse } from '@cborg/shared';
import { startTcpServer } from '../../bridge/tcp-server.js';
import type { TcpServerHandle } from '../../bridge/tcp-server.js';
import { TcpBridgeTransport } from '../../bridge/tcp-transport.js';
import { connectToHost } from '../../bridge/tcp-client.js';
import { runNmBridgeHost } from '../../bridge/nm-bridge-host.js';
import { LineReader, encodeWireMessage, parseWireMessage } from '../../bridge/tcp-protocol.js';
import type { WireMessage } from '../../bridge/tcp-protocol.js';

const teardowns: Array<() => void> = [];
afterEach(() => {
  for (const fn of teardowns.splice(0)) fn();
});

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('waitFor timeout');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * 测试用 server 助手：记录每次连接的 attach，提供 waitConnection(n) 确定性地等待
 * 第 n 个 host-B 连接已被 transport.attach（避免 client 'connect' 与 server
 * 'connection' 事件的时序竞态）。
 */
interface TestServer {
  server: TcpServerHandle;
  waitConnection(n: number): Promise<void>;
}

function makeServer(transport: TcpBridgeTransport): Promise<TestServer> {
  const waiters = new Map<number, () => void>();
  let count = 0;
  const server = startTcpServer({
    onConnection: (socket) => {
      transport.attach(socket);
      count += 1;
      const resolve = waiters.get(count);
      if (resolve) {
        waiters.delete(count);
        resolve();
      }
    },
  });
  teardowns.push(() => {
    void transport.close();
  });
  return server.then((s) => ({
    server: s,
    waitConnection: (n: number): Promise<void> => {
      if (n <= count) return Promise.resolve();
      return new Promise((resolve) => {
        waiters.set(n, resolve);
      });
    },
  }));
}

/** 模拟 host-B 的裸 TCP 客户端：连 host-A 的 server，收 request 回 response。 */
class FakeHostB {
  readonly socket: Socket;
  private readonly reader: LineReader;
  private readonly requestHandlers = new Set<(req: Extract<WireMessage, { kind: 'request' }>) => void>();

  constructor(port: number) {
    this.socket = connect({ host: '127.0.0.1', port });
    this.reader = new LineReader((line) => {
      const msg = parseWireMessage(line);
      if (msg.kind === 'request') {
        for (const handler of [...this.requestHandlers]) handler(msg);
      }
    });
    this.socket.on('data', (chunk: Buffer) => {
      try {
        this.reader.push(chunk);
      } catch {
        this.socket.destroy();
      }
    });
    this.socket.on('error', () => this.socket.destroy());
  }

  ready(): Promise<void> {
    return new Promise((resolve) => this.socket.once('connect', resolve));
  }

  onRequest(cb: (req: Extract<WireMessage, { kind: 'request' }>) => void): void {
    this.requestHandlers.add(cb);
  }

  send(msg: WireMessage): void {
    this.socket.write(encodeWireMessage(msg));
  }

  close(): void {
    this.socket.destroy();
  }
}

describe('TcpBridgeTransport (host-A side) over real TCP', () => {
  it('routes a call through the bridge and returns the response', async () => {
    const transport = new TcpBridgeTransport();
    const ts = await makeServer(transport);
    const fake = new FakeHostB(ts.server.port);
    await fake.ready();
    await ts.waitConnection(1);
    fake.onRequest((req) => {
      expect(req.tool).toBe('bookmark_count');
      fake.send({ kind: 'response', id: req.id, ok: true, result: { count: 42 } });
    });
    const result = await transport.call('bookmark_count', {});
    expect(result).toEqual({ count: 42 });
    fake.close();
  });

  it('rejects with EXTENSION_NOT_CONNECTED when no host-B is connected', async () => {
    const transport = new TcpBridgeTransport();
    await expect(transport.call('bookmark_count', {})).rejects.toMatchObject({
      code: 'EXTENSION_NOT_CONNECTED',
    });
    await transport.close();
  });

  it('propagates structured errors from the bridge', async () => {
    const transport = new TcpBridgeTransport();
    const ts = await makeServer(transport);
    const fake = new FakeHostB(ts.server.port);
    await fake.ready();
    await ts.waitConnection(1);
    fake.onRequest((req) => {
      fake.send({
        kind: 'response',
        id: req.id,
        ok: false,
        error: { code: 'NM_PROTOCOL_ERROR', message: 'sw exploded' },
      });
    });
    await expect(transport.call('bookmark_get_tree', {})).rejects.toMatchObject({
      code: 'NM_PROTOCOL_ERROR',
      message: 'sw exploded',
    });
    fake.close();
  });

  it('times out a call when no response arrives', async () => {
    const transport = new TcpBridgeTransport({ callTimeoutMs: 150 });
    const ts = await makeServer(transport);
    const fake = new FakeHostB(ts.server.port);
    await fake.ready();
    await ts.waitConnection(1);
    fake.onRequest(() => {
      // 故意不应答
    });
    await expect(transport.call('bookmark_count', {})).rejects.toMatchObject({ code: 'TIMEOUT' });
    fake.close();
  });

  it('rejects in-flight calls with EXTENSION_NOT_CONNECTED when the bridge disconnects', async () => {
    const transport = new TcpBridgeTransport();
    const ts = await makeServer(transport);
    const fake = new FakeHostB(ts.server.port);
    await fake.ready();
    await ts.waitConnection(1);
    fake.onRequest(() => {
      // 不应答，等连接被切断
    });
    const call = transport.call('bookmark_count', {});
    fake.close();
    await expect(call).rejects.toMatchObject({ code: 'EXTENSION_NOT_CONNECTED' });
  });

  it('accepts a new connection and replaces the previous one (single connection policy)', async () => {
    const transport = new TcpBridgeTransport();
    const ts = await makeServer(transport);
    const first = new FakeHostB(ts.server.port);
    await first.ready();
    await ts.waitConnection(1);
    const second = new FakeHostB(ts.server.port);
    await second.ready();
    await ts.waitConnection(2);
    await new Promise((resolve) => setImmediate(resolve)); // 等旧连接 close 传播
    second.onRequest((req) => {
      second.send({ kind: 'response', id: req.id, ok: true, result: { count: 9 } });
    });
    const result = await transport.call('bookmark_count', {});
    expect(result).toEqual({ count: 9 });
    // 旧连接应已被 server 销毁
    expect(first.socket.destroyed).toBe(true);
    first.close();
    second.close();
  });

  it('forwards host-B handshake events to onEvent subscribers', async () => {
    const transport = new TcpBridgeTransport();
    const events: string[] = [];
    transport.onEvent((msg) => events.push(msg.event));
    const ts = await makeServer(transport);
    const fake = new FakeHostB(ts.server.port);
    await fake.ready();
    await ts.waitConnection(1);
    fake.send({ kind: 'event', event: 'connected' });
    await waitFor(() => events.length > 0);
    expect(events).toEqual(['connected']);
    fake.close();
  });
});

describe('nm-bridge-host (host-B side) over real TCP + fake NM', () => {
  it('bridges a TCP request to NM and returns the SW response', async () => {
    const transport = new TcpBridgeTransport();
    const ts = await makeServer(transport);

    // host-B：真实 TcpClient 连 host-A
    const client = await connectToHost(ts.server.port);
    await ts.waitConnection(1);
    teardowns.push(() => client.close());

    // fake SW（NM 侧）：只读一条请求后应答
    // 用对象属性承载状态：TS 不对属性做闭包 CFA 收窄，避免 let 捕获变量的 narrowing 陷阱
    const sw = {
      receivedNm: null as NmRequest | null,
      respond: null as ((resp: NmResponse) => void) | null,
    };
    const fakeReadNm = (): Promise<NmMessage> =>
      new Promise((resolve) => {
        sw.respond = resolve;
      });
    const fakeWriteNm = async (msg: NmMessage): Promise<void> => {
      sw.receivedNm = msg as NmRequest;
    };
    const bridgePromise = runNmBridgeHost({ client, readNm: fakeReadNm, writeNm: fakeWriteNm, logger: () => {} });

    const call = transport.call('bookmark_search', { query: 'react' });
    await waitFor(() => sw.receivedNm !== null);
    expect(sw.receivedNm?.kind).toBe('request');
    expect(sw.receivedNm?.tool).toBe('bookmark_search');
    expect(sw.receivedNm?.id.length).toBeGreaterThan(0);
    // 用同一个 id 应答（链路追踪的关键）
    sw.respond?.({ kind: 'response', id: sw.receivedNm!.id, ok: true, result: { items: [] } });

    const result = await call;
    expect(result).toEqual({ items: [] });

    client.close();
    const code = await bridgePromise;
    expect(code).toBe(0);
  });

  it('sends a TIMEOUT error back to host-A when the SW does not answer', async () => {
    const transport = new TcpBridgeTransport();
    const ts = await makeServer(transport);
    const client = await connectToHost(ts.server.port);
    await ts.waitConnection(1);
    teardowns.push(() => client.close());

    const bridgePromise = runNmBridgeHost({
      client,
      readNm: () => new Promise(() => {}),
      writeNm: async () => {},
      requestTimeoutMs: 100,
      logger: () => {},
    });

    const call = transport.call('bookmark_count', {});
    // host-B 侧 100ms 超时 → 回 TIMEOUT error → host-A 的 transport 应拿到该 code
    await expect(call).rejects.toMatchObject({ code: 'TIMEOUT' });
    client.close();
    void bridgePromise;
  });

  it('exits with code 0 on NM EOF (SW disconnect)', async () => {
    const server = await startTcpServer();
    teardowns.push(() => void server.close());
    const client = await connectToHost(server.port);
    teardowns.push(() => client.close());

    const bridgePromise = runNmBridgeHost({
      client,
      readNm: () => Promise.reject(new Error('NM EOF: input closed before length prefix')),
      writeNm: async () => {},
      logger: () => {},
    });
    const code = await bridgePromise;
    expect(code).toBe(0);
  });

  it('exits with code 0 when host-A closes the TCP connection', async () => {
    const server = await startTcpServer();
    teardowns.push(() => void server.close());
    const client = await connectToHost(server.port);
    teardowns.push(() => client.close());

    const bridgePromise = runNmBridgeHost({
      client,
      readNm: () => new Promise(() => {}),
      writeNm: async () => {},
      logger: () => {},
    });
    await server.close(); // 销毁连接 → host-B 应退出 0
    const code = await bridgePromise;
    expect(code).toBe(0);
  });
});
