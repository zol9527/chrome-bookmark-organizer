import { describe, expect, it } from 'vitest';
import { Readable, Writable } from 'node:stream';
import type { NmRequest } from '@cborg/shared';
import { readMessage, writeMessage } from './messaging.js';

function encode(msg: NmRequest): Buffer {
  const payload = Buffer.from(JSON.stringify(msg), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

function bufferStream(buf: Buffer): Readable {
  return Readable.from([buf]);
}

class CollectingWritable extends Writable {
  public chunks: Buffer[] = [];

  override _write(chunk: Buffer, _encoding: BufferEncoding, cb: (err?: Error | null) => void): void {
    this.chunks.push(Buffer.from(chunk));
    cb();
  }

  get payload(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

describe('native messaging framing', () => {
  it('reads a single length-prefixed message', async () => {
    const msg: NmRequest = { kind: 'request', id: '1', tool: 'bookmark_count', args: null };
    const got = await readMessage(bufferStream(encode(msg)));
    expect(got).toEqual(msg);
  });

  it('handles two messages arriving in one chunk', async () => {
    const a: NmRequest = { kind: 'request', id: 'a', tool: 'bookmark_count', args: null };
    const b: NmRequest = { kind: 'request', id: 'b', tool: 'bookmark_search', args: { query: 'x' } };
    const stream = bufferStream(Buffer.concat([encode(a), encode(b)]));
    expect(await readMessage(stream)).toEqual(a);
    expect(await readMessage(stream)).toEqual(b);
  });

  it('writes a length-prefixed message', async () => {
    const msg: NmRequest = { kind: 'request', id: '2', tool: 'bookmark_get_tree', args: null };
    const out = new CollectingWritable();
    await writeMessage(msg, out);
    expect(out.payload.readUInt32LE(0)).toBe(out.payload.length - 4);
    expect(JSON.parse(out.payload.subarray(4).toString('utf8'))).toEqual(msg);
  });
});
