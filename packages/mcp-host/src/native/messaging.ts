/**
 * Native Messaging (NM) host 底层 IO：32-bit 小端长度前缀 + UTF-8 JSON。
 *
 * ⚠️ STDOUT/STDIN 冲突与三进程方案（phase 2 实现真桥接，本文件仅为纯 IO 层）：
 *
 * 本包同时承担两个角色，且两者都依赖 stdin/stdout：
 *   1. MCP server（stdio transport）——与 AI client 的 JSON-RPC 通信
 *   2. NM host ——与扩展 SW 的 chrome.runtime.connectNative 通信
 *
 * 二者不能共用一个进程的 stdin/stdout，否则消息会互相污染。
 * 方案 B（三进程，采纳，见研究文档）：
 *
 *   ┌──────────────┐  stdio/MCP   ┌─────────────────┐  child_process  ┌──────────────────┐
 *   │ AI client    │ ───────────▶ │ mcp-host serve  │ ──────────────▶ │ NM host 子进程     │
 *   │ (Claude/...) │ ◀─────────── │ (进程 A)        │ ◀────────────── │ (进程 B)         │
 *   └──────────────┘              └─────────────────┘                 └──────────────────┘
 *                                                                           ▲
 *   Chrome 通过 connectNative 拉起「另一个」host 实例（进程 B'）───────┘
 *
 *   - 进程 A：MCP server（serve 子命令），由 AI client spawn，用 stdio 跑 MCP JSON-RPC。
 *     它不直接读写 NM 帧；tool 调用经 bridge.ts 转发给 NM 子进程（child_process）。
 *   - 进程 B / B'：NM host（host 子命令），分别由进程 A 和 Chrome 拉起，
 *     用 stdin/stdout 跑 NM 协议，转发给扩展 SW。两个实例互不冲突。
 *   - register 子命令写的 manifest path 就是 host 二进制（Chrome 侧拉起 B' 用）。
 *
 * TODO phase2：进程 A ↔ 进程 B 的 child_process 桥接 + SW 侧 SW ↔ B 的转发，
 *   全部基于本文件的消息帧实现。
 *
 * 脚手架阶段：本文件只实现可独立测试的纯 IO 函数，不启动任何进程。
 */
import type { NmMessage } from '@cborg/shared';
import type { Readable, Writable } from 'node:stream';

/** Chrome NM 单条消息上限（Chrome 102+ 为 64MB，这里保守取 1MB）。 */
const MAX_MESSAGE_BYTES = 1024 * 1024;

/**
 * 每个输入流暂存的残余字节。
 * 一次底层 read 可能取到多条消息的字节，剩余部分缓存起来供下一次 readMessage 使用，
 * 避免丢失字节（NM 无消息边界标记，只能靠长度前缀切分）。
 */
const pendingBuffers = new WeakMap<Readable, Buffer>();

/** 拉取下一块数据；EOF 返回 null。拿到数据后立刻 pause，防止流内剩余字节被丢弃。 */
function pullChunk(stream: Readable): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer | string): void => {
      cleanup();
      resolve(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    };
    const onEnd = (): void => {
      cleanup();
      resolve(null);
    };
    const onError = (err: Error): void => {
      cleanup();
      reject(err);
    };
    const cleanup = (): void => {
      stream.pause();
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('error', onError);
    };
    stream.on('data', onData);
    stream.once('end', onEnd);
    stream.once('error', onError);
    // 流可能在我们挂监听之前就 EOF 了（'end' 不会重发）：直接判空返回。
    if (stream.readableEnded && stream.readableLength === 0) {
      cleanup();
      resolve(null);
      return;
    }
    stream.resume();
  });
}

/** 从流中精确读取 length 字节（消费 pendingBuffers 残余）；EOF 返回 null。 */
async function readExactly(stream: Readable, length: number): Promise<Buffer | null> {
  let buffered = pendingBuffers.get(stream) ?? Buffer.alloc(0);
  while (buffered.length < length) {
    const chunk = await pullChunk(stream);
    if (chunk === null) {
      pendingBuffers.delete(stream);
      return null;
    }
    buffered = Buffer.concat([buffered, chunk]);
  }
  const out = Buffer.from(buffered.subarray(0, length));
  const rest = buffered.subarray(length);
  if (rest.length > 0) {
    pendingBuffers.set(stream, Buffer.from(rest));
  } else {
    pendingBuffers.delete(stream);
  }
  return out;
}

/**
 * 从输入流读取一条 NM 消息（默认 process.stdin）。
 *
 * 帧格式：4 字节小端无符号长度 + UTF-8 JSON。
 * 注：macOS Intel/ARM 均为小端，统一用 readUInt32LE，无需 OS 检测。
 *
 * EOF（Chrome 关闭端口）或协议错误时抛错，host 主循环据此退出。
 */
export async function readMessage(input: Readable = process.stdin): Promise<NmMessage> {
  const header = await readExactly(input, 4);
  if (header === null) {
    throw new Error('NM EOF: input closed before length prefix');
  }
  const length = header.readUInt32LE(0);
  if (length > MAX_MESSAGE_BYTES) {
    throw new Error(`NM protocol error: message of ${length} bytes exceeds limit ${MAX_MESSAGE_BYTES}`);
  }
  const payload = await readExactly(input, length);
  if (payload === null) {
    throw new Error('NM EOF: input closed mid-message');
  }
  return JSON.parse(payload.toString('utf8')) as NmMessage;
}

/**
 * 向输出流写一条 NM 消息（默认 process.stdout）。
 *
 * ⚠️ host 模式下 stdout 只允许写 NM 帧——任何 console.log 都会破坏协议，
 * 调试输出请走 stderr。
 */
export function writeMessage(msg: NmMessage, output: Writable = process.stdout): Promise<void> {
  const payload = Buffer.from(JSON.stringify(msg), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return new Promise((resolve, reject) => {
    output.write(Buffer.concat([header, payload]), (err) => (err ? reject(err) : resolve()));
  });
}
