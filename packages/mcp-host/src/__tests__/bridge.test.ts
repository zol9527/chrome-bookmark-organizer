import { afterEach, describe, expect, it } from 'vitest';
import { clearExtensionTransport, dispatchToExtension, setExtensionTransport } from '../native/bridge.js';
import { createMockTransport } from '../native/mock-transport.js';

describe('dispatchToExtension (pluggable transport)', () => {
  afterEach(() => clearExtensionTransport());

  it('throws synchronously when no transport is configured', () => {
    expect(() => dispatchToExtension('bookmark_count', {})).toThrow('No extension transport configured');
  });

  it('routes a typed call to the active transport and returns its result', async () => {
    const seen: Array<{ tool: string; args: unknown }> = [];
    setExtensionTransport(
      createMockTransport({
        bookmark_count: (args) => {
          seen.push({ tool: 'bookmark_count', args });
          return { count: 7 };
        },
      }),
    );
    const result = await dispatchToExtension('bookmark_count', {});
    expect(result).toEqual({ count: 7 });
    expect(seen).toEqual([{ tool: 'bookmark_count', args: {} }]);
  });

  it('propagates transport errors to the caller', async () => {
    setExtensionTransport(
      createMockTransport({
        bookmark_get_tree: () => {
          throw new Error('boom');
        },
      }),
    );
    await expect(dispatchToExtension('bookmark_get_tree', {})).rejects.toThrow('boom');
  });

  it('lets a newer transport replace the active one', async () => {
    setExtensionTransport(createMockTransport({ bookmark_count: () => ({ count: 1 }) }));
    await expect(dispatchToExtension('bookmark_count', {})).resolves.toEqual({ count: 1 });
    setExtensionTransport(createMockTransport({ bookmark_count: () => ({ count: 2 }) }));
    await expect(dispatchToExtension('bookmark_count', {})).resolves.toEqual({ count: 2 });
  });

  it('mock transport close() is a no-op and default handlers return contract-valid results', async () => {
    const t = createMockTransport();
    await expect(t.close()).resolves.toBeUndefined();
    setExtensionTransport(t);
    await expect(dispatchToExtension('bookmark_count', {})).resolves.toEqual({ count: 0 });
  });
});
