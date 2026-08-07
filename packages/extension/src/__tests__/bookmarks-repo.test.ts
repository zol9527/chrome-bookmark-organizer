import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import {
  applyAction,
  count,
  findDuplicates,
  getTree,
  list,
  search,
} from '../background/bookmarks-repo';

beforeEach(() => {
  installChromeMock();
});

async function addFolder(title: string, parentId = '1'): Promise<string> {
  return (await chrome.bookmarks.create({ parentId, title })).id;
}

async function addBookmark(title: string, url: string, parentId = '1'): Promise<string> {
  return (await chrome.bookmarks.create({ parentId, title, url })).id;
}

describe('bookmarks-repo', () => {
  it('getTree 支持 folderId 起始与 depth 截断', async () => {
    const a = await addFolder('A');
    await addBookmark('a1', 'https://a.com', a);

    // 全树：3 个根
    expect(await getTree()).toHaveLength(3);

    // depth=1：A 可见但无 children
    const shallow = await getTree('1', 1);
    expect(shallow[0]!.title).toBe('Bookmarks bar');
    const aShallow = shallow[0]!.children![0]!;
    expect(aShallow.title).toBe('A');
    expect(aShallow.children).toBeUndefined();

    // depth=2：A 的子书签可见
    const deeper = await getTree('1', 2);
    expect(deeper[0]!.children![0]!.children![0]!.url).toBe('https://a.com');

    // depth=0：完全截断 children
    const zero = await getTree('1', 0);
    expect(zero[0]!.children).toBeUndefined();
  });

  it('search 支持 limit 截断与 URL 匹配', async () => {
    await addBookmark('github-1', 'https://github.com/a');
    await addBookmark('github-2', 'https://github.com/b');
    await addBookmark('other', 'https://x.com');

    expect(await search('github')).toHaveLength(2);
    expect(await search('github', 1)).toHaveLength(1);
    expect(await search('github.com/b')).toHaveLength(1);
    expect((await search('github.com/b'))[0]!.title).toBe('github-2');
  });

  it('count 递归统计书签数（folderId 缺省为全树）', async () => {
    const a = await addFolder('A');
    await addBookmark('b1', 'https://b1.com', a);
    await addBookmark('b2', 'https://b2.com');

    expect(await count()).toBe(2);
    expect(await count(a)).toBe(1);
    expect(await count('2')).toBe(0);
  });

  it('findDuplicates 按原始 URL 与归一化 URL 分组', async () => {
    await addBookmark('d1', 'HTTPS://Example.com/docs/');
    await addBookmark('d2', 'https://example.com/docs#section');
    await addBookmark('d3', 'https://example.com/docs?q=1');
    await addBookmark('unique', 'https://example.com/other');

    // 不归一化：3 条 URL 各不相同，无重复组
    expect(await findDuplicates('1', false)).toHaveLength(0);

    // 归一化（去 fragment/末尾斜杠/协议小写，去 query）：三条并入一组
    const groups = await findDuplicates('1', true);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.nodes.map((n) => n.title).sort()).toEqual(['d1', 'd2', 'd3']);
  });

  it('applyAction 覆盖 move / create_folder(幂等) / rename / merge / delete', async () => {
    const dest = await addFolder('Dest');
    const src = await addFolder('Src');
    const bm = await addBookmark('link', 'https://l.com', src);

    // move：书签移入 Dest
    await applyAction({ id: 'a1', op: 'move', target: { id: bm, newParentId: dest }, rationale: '' });
    expect((await list(dest)).map((n) => n.title)).toEqual(['link']);

    // create_folder 幂等：同名已存在则复用，不重复建
    const createdId = await applyAction({
      id: 'a2',
      op: 'create_folder',
      target: { newParentId: '1', newTitle: 'Dest' },
      rationale: '',
    });
    expect(createdId).toBe(dest);

    // rename
    await applyAction({ id: 'a3', op: 'rename', target: { id: src, newTitle: 'Renamed' }, rationale: '' });
    expect((await chrome.bookmarks.get(src))[0]!.title).toBe('Renamed');

    // merge：把 src(Renamed) 的内容并入 Dest 并删除空壳
    await applyAction({ id: 'a4', op: 'merge', target: { id: src, newParentId: dest }, rationale: '' });
    expect(await chrome.bookmarks.get(src)).toHaveLength(0);
    expect((await list(dest)).map((n) => n.title)).toEqual(['link']);

    // delete
    const tmp = await addFolder('Tmp');
    await applyAction({ id: 'a5', op: 'delete', target: { id: tmp }, rationale: '' });
    expect(await chrome.bookmarks.get(tmp)).toHaveLength(0);

    // 非法目标父目录 → 拒绝
    await expect(
      applyAction({ id: 'a6', op: 'move', target: { id: bm, newParentId: '99999' }, rationale: '' }),
    ).rejects.toThrow();
  });
});
