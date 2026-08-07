import { describe, expect, it } from 'vitest';
import {
  BridgeError,
  LineReader,
  encodeWireMessage,
  isWireMessage,
  parseWireMessage,
} from '../../bridge/tcp-protocol.js';
import type { WireMessage } from '../../bridge/tcp-protocol.js';

describe('tcp wire protocol', () => {
  it('round-trips all four message kinds', () => {
    const msgs: WireMessage[] = [
      { kind: 'request', id: '1', tool: 'bookmark_count', args: { folderId: '2' } },
      { kind: 'request', id: '2', tool: 'bookmark_search', args: null },
      { kind: 'response', id: '3', ok: true, result: { count: 3 } },
      { kind: 'response', id: '4', ok: false, error: { code: 'TIMEOUT', message: 'slow' } },
      { kind: 'event', event: 'connected' },
      { kind: 'event', event: 'ready' },
    ];
    for (const msg of msgs) {
      const line = encodeWireMessage(msg).toString('utf8');
      expect(line.endsWith('\n')).toBe(true);
      expect(parseWireMessage(line.trimEnd())).toEqual(msg);
    }
  });

  it('rejects unknown tool names in requests', () => {
    expect(isWireMessage({ kind: 'request', id: '1', tool: 'nope', args: {} })).toBe(false);
    expect(isWireMessage({ kind: 'request', id: 1, tool: 'bookmark_count', args: {} })).toBe(false);
  });

  it('rejects malformed response shapes', () => {
    // ok:true 但缺 result
    expect(isWireMessage({ kind: 'response', id: '1', ok: true })).toBe(false);
    // ok:false 但 error 缺 message
    expect(isWireMessage({ kind: 'response', id: '1', ok: false, error: { code: 'X' } })).toBe(false);
    // ok 不是 boolean
    expect(isWireMessage({ kind: 'response', id: '1', ok: 'yes', result: 1 })).toBe(false);
  });

  it('rejects unknown event names', () => {
    expect(isWireMessage({ kind: 'event', event: 'plan_updated' })).toBe(false);
  });

  it('parseWireMessage throws BridgeError NM_PROTOCOL_ERROR on garbage', () => {
    expect(() => parseWireMessage('{not json')).toThrow(BridgeError);
    expect(() => parseWireMessage('{"kind":"nope"}')).toThrow(BridgeError);
    expect(() => parseWireMessage('42')).toThrow(BridgeError);
  });

  it('LineReader handles partial chunks, multiple lines per chunk, and empty lines', () => {
    const lines: string[] = [];
    const reader = new LineReader((line) => lines.push(line));
    reader.push('{"kind":"event","event":"connected"}\n{"kind":"ev');
    reader.push('ent","event":"ready"}\n\n{"kind":"event","event":"disconnected"}');
    reader.push('\n');
    expect(lines).toEqual([
      '{"kind":"event","event":"connected"}',
      '{"kind":"event","event":"ready"}',
      '{"kind":"event","event":"disconnected"}',
    ]);
  });

  it('LineReader throws when a single line exceeds the 1MB cap', () => {
    const reader = new LineReader(() => undefined);
    expect(() => reader.push('x'.repeat(1024 * 1024 + 10))).toThrow(BridgeError);
  });
});
