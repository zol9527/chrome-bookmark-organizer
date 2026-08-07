import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readEndpointFile,
  removeEndpointFile,
  waitForEndpointFile,
  writeEndpointFile,
} from '../../bridge/endpoint-file.js';

let tempDir: string | null = null;
afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

async function makePath(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), 'cborg-endpoint-'));
  return join(tempDir, 'endpoint');
}

describe('endpoint rendezvous file', () => {
  it('writes a version-1 JSON endpoint file and reads it back', async () => {
    const path = await makePath();
    const written = await writeEndpointFile({ port: 54321, pid: 12345, path });
    expect(written).toBe(path);
    const info = await readEndpointFile(path);
    expect(info).toMatchObject({ version: 1, port: 54321, pid: 12345 });
    expect(typeof info.startedAt).toBe('number');
  });

  it('defaults pid to process.pid', async () => {
    const path = await makePath();
    await writeEndpointFile({ port: 1, path });
    const info = await readEndpointFile(path);
    expect(info.pid).toBe(process.pid);
  });

  it('throws ENDPOINT_NOT_FOUND when the file is missing', async () => {
    const path = join(await makePath(), 'nope');
    await expect(readEndpointFile(path)).rejects.toMatchObject({ code: 'ENDPOINT_NOT_FOUND' });
  });

  it('rejects malformed content (invalid JSON and wrong shape)', async () => {
    const badJson = await makePath();
    await writeFile(badJson, 'not json', 'utf8');
    await expect(readEndpointFile(badJson)).rejects.toMatchObject({ code: 'ENDPOINT_NOT_FOUND' });

    const badShape = await makePath();
    await writeFile(badShape, JSON.stringify({ version: 1, port: 'x' }), 'utf8');
    await expect(readEndpointFile(badShape)).rejects.toMatchObject({ code: 'ENDPOINT_NOT_FOUND' });
  });

  it('waitForEndpointFile retries until the file appears', async () => {
    const path = await makePath();
    const pending = waitForEndpointFile({ path, timeoutMs: 5000, intervalMs: 20 });
    setTimeout(() => {
      void writeEndpointFile({ port: 7777, path });
    }, 60);
    const info = await pending;
    expect(info.port).toBe(7777);
  });

  it('waitForEndpointFile times out with ENDPOINT_NOT_FOUND', async () => {
    const path = await makePath();
    await expect(waitForEndpointFile({ path, timeoutMs: 150, intervalMs: 20 })).rejects.toMatchObject({
      code: 'ENDPOINT_NOT_FOUND',
    });
  });

  it('removeEndpointFile deletes best-effort and is idempotent', async () => {
    const path = await makePath();
    await writeEndpointFile({ port: 1, path });
    await removeEndpointFile(path);
    await expect(readEndpointFile(path)).rejects.toMatchObject({ code: 'ENDPOINT_NOT_FOUND' });
    await expect(removeEndpointFile(path)).resolves.toBeUndefined();
  });
});
