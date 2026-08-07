import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import {
  getSnapshot,
  listSnapshots,
  restoreSnapshot,
  takeSnapshot,
} from '../background/snapshot-store';

beforeEach(() => {
  installChromeMock();
});

async function addFolder(title: string, parentId = '1'): Promise<string> {
  return (await chrome.bookmarks.create({ parentId, title })).id;
}

async function addBookmark(title: string, url: string, parentId = '1'): Promise<string> {
  return (await chrome.bookmarks.create({ parentId, title, url })).id;
}

describe('snapshot-store', () => {
  it('takeSnapshot 存入 session 并可读取；LRU 超限淘汰最旧', async () => {
    const first = await takeSnapshot('plan-0');
    expect(first.planId).toBe('plan-0');
    expect(first.trees).toHaveLength(3);
    expect((await getSnapshot(first.id))?.id).toBe(first.id);

    for (let i = 1; i < 12; i++) {
      await takeSnapshot(`plan-${i}`);
    }

    // 容量 10：最早 2 个被淘汰
    const all = await listSnapshots();
    expect(all).toHaveLength(10);
    expect(await getSnapshot(first.id)).toBeNull();
    expect(await getSnapshot(all[0]!.id)).not.toBeNull();
  });

  it('restoreSnapshot 恢复 move / rename / create / delete 四类变更', async () => {
    const dest = await addFolder('Dest');
    const src = await addFolder('Src');
    const bm = await addBookmark('link', 'https://l.com', src);
    const toDelete = await addBookmark('temp', 'https://t.com'); // 快照内，稍后删除

    const snap = await takeSnapshot('p1');

    // 快照之后的变更
    await chrome.bookmarks.move(bm, { parentId: dest });
    await chrome.bookmarks.update(src, { title: 'Renamed' });
    const created = await addFolder('NewFolder');
    await chrome.bookmarks.remove(toDelete);

    const ok = await restoreSnapshot(snap.id);
    expect(ok).toBe(true);

    // 移动撤销：bm 回到 Src
    expect((await chrome.bookmarks.get(bm))[0]!.parentId).toBe(src);
    // 重命名还原
    expect((await chrome.bookmarks.get(src))[0]!.title).toBe('Src');
    // 快照后新建的文件夹被删除
    expect(await chrome.bookmarks.get(created)).toHaveLength(0);
    // 快照后被删除的书签被重建（url 匹配）
    expect((await chrome.bookmarks.search('https://t.com'))[0]!.title).toBe('temp');
  });

  it('restoreSnapshot 对不存在的快照返回 false', async () => {
    expect(await restoreSnapshot('nope')).toBe(false);
  });
});
