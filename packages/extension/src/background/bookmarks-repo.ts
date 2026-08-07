/**
 * chrome.bookmarks API 封装（只读查询 + applyAction 写操作收敛层）。
 *
 * 阶段 2 填实：所有对 chrome.bookmarks 的调用都收敛在本模块；
 * 写操作统一通过 applyAction(action) 落地，不允许上层直接调 move/create/remove。
 */
import type { BookmarkNode, PlanAction } from '@cborg/shared';

/** 重复 URL 分组，与 McpToolResult['bookmark_find_duplicates'] 对齐 */
export interface DuplicateGroup {
  url: string;
  nodes: BookmarkNode[];
}

/** 书签栏的可能标题（中英兼容，与原 legacy 一致） */
export const DEFAULT_BOOKMARK_BAR_NAMES = ['Bookmarks bar', '书签栏', '收藏夹'] as const;

/**
 * BFS 定位书签栏：优先 id==='1'（Chrome 固定根），其次按标题匹配。
 * 与 legacy findBookmarkBar 行为一致，但标题集合可配置。
 */
export function findBookmarkBar(
  tree: BookmarkNode[],
  names: readonly string[] = DEFAULT_BOOKMARK_BAR_NAMES,
): BookmarkNode | null {
  const titleSet = new Set(names);
  const queue = [...tree];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node.id === '1' || titleSet.has(node.title)) return node;
    queue.push(...(node.children ?? []));
  }
  return null;
}

/** 在 parentId 的直接子节点中查找同名文件夹（无 url），返回 id 或 null */
export async function findChildFolder(parentId: string, title: string): Promise<string | null> {
  const children = await chrome.bookmarks.getChildren(parentId);
  const hit = children.find((c) => !c.url && c.title === title);
  return hit?.id ?? null;
}

/** 按 depth 截断 children：depth<=0 丢弃全部 children */
function truncate(node: BookmarkNode, depth: number): BookmarkNode {
  if (depth <= 0) {
    const { children: _dropped, ...rest } = node;
    return rest;
  }
  return { ...node, children: (node.children ?? []).map((c) => truncate(c, depth - 1)) };
}

/** 整树查询：可指定起始 folderId 与最大深度（默认全量） */
export async function getTree(folderId?: string, depth?: number): Promise<BookmarkNode[]> {
  const nodes = folderId != null ? await chrome.bookmarks.getSubTree(folderId) : await chrome.bookmarks.getTree();
  if (depth === undefined) return nodes;
  return nodes.map((n) => truncate(n, depth));
}

/** 列出 folderId 的直接子节点 */
export async function list(folderId: string): Promise<BookmarkNode[]> {
  return chrome.bookmarks.getChildren(folderId);
}

/** 按 query 搜索书签，默认 limit 200 */
export async function search(query: string, limit?: number): Promise<BookmarkNode[]> {
  const max = limit ?? 200;
  const items = await chrome.bookmarks.search(query);
  return items.slice(0, max);
}

/** 统计书签数量（folderId 缺省时为全树；只数含 url 的节点，与 legacy countBookmarks 一致） */
export async function count(folderId?: string): Promise<number> {
  const trees = await getTree(folderId);
  let total = 0;
  const walk = (nodes: BookmarkNode[]): void => {
    for (const n of nodes) {
      if (n.url) total += 1;
      else walk(n.children ?? []);
    }
  };
  walk(trees);
  return total;
}

/**
 * URL 归一化：去 fragment、去末尾斜杠、协议/主机名小写；
 * normalizeUrl=true 时还去 query。非法 URL 走字符串兜底路径。
 */
function normalizeUrlForCompare(raw: string, stripQuery: boolean): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    if (stripQuery) u.search = '';
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    let path = u.pathname;
    while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    const port = u.port ? `:${u.port}` : '';
    return `${u.protocol}//${u.hostname}${port}${path}`;
  } catch {
    let s = raw.trim().split('#')[0] ?? '';
    if (stripQuery) s = s.split('?')[0] ?? '';
    while (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
    const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(s);
    if (m) s = m[1]!.toLowerCase() + s.slice(m[1]!.length);
    return s;
  }
}

/** 找出重复 URL 分组；normalizeUrl 时先做 URL 规范化 */
export async function findDuplicates(folderId?: string, normalizeUrl = false): Promise<DuplicateGroup[]> {
  const trees = await getTree(folderId);
  const nodes: BookmarkNode[] = [];
  const walk = (ns: BookmarkNode[]): void => {
    for (const n of ns) {
      if (n.url) nodes.push(n);
      walk(n.children ?? []);
    }
  };
  walk(trees);

  const groups = new Map<string, BookmarkNode[]>();
  for (const n of nodes) {
    const key = normalizeUrl ? normalizeUrlForCompare(n.url!, normalizeUrl) : n.url!;
    const bucket = groups.get(key);
    if (bucket) bucket.push(n);
    else groups.set(key, [n]);
  }
  return [...groups.entries()]
    .filter(([, bucket]) => bucket.length > 1)
    .map(([url, bucket]) => ({ url, nodes: bucket }));
}

/** 校验 id 指向一个存在的文件夹（无 url），否则抛错 */
async function getFolderOrThrow(id: string): Promise<void> {
  const nodes = await chrome.bookmarks.get(id);
  const node = nodes[0];
  if (!node || node.url) throw new Error(`Parent folder not found: ${id}`);
}

/**
 * 解析目标父 id：
 * - 数字 id（真实 chrome 节点 id）→ 校验存在后直接使用（AI plan 路径）
 * - 非数字（legacy 迁移路径的目标根目录标题）→ 在书签栏下按标题 ensure（幂等建目录）
 */
async function resolveParentId(parentId: string): Promise<string> {
  if (/^\d+$/.test(parentId)) {
    await getFolderOrThrow(parentId);
    return parentId;
  }
  const trees = await chrome.bookmarks.getTree();
  const bar = findBookmarkBar(trees);
  if (!bar) throw new Error('Could not find the Chrome bookmarks bar.');
  const existing = await findChildFolder(bar.id, parentId);
  if (existing) return existing;
  const created = await chrome.bookmarks.create({ parentId: bar.id, title: parentId });
  return created.id;
}

/**
 * 执行单个 plan action（move / create_folder / rename / merge / delete）。
 * 返回新节点 id（create_folder）或受影响节点 id（move/rename/merge/delete）。
 * create_folder 幂等：同父下同名文件夹已存在时直接复用，不重复创建。
 */
export async function applyAction(action: PlanAction): Promise<string> {
  const { op, target } = action;
  switch (op) {
    case 'move': {
      if (!target.id || !target.newParentId) {
        throw new Error(`move action missing id/newParentId: ${action.id}`);
      }
      const parentId = await resolveParentId(target.newParentId);
      const moved = await chrome.bookmarks.move(target.id, {
        parentId,
        ...(target.newIndex != null ? { index: target.newIndex } : {}),
      });
      return moved.id;
    }
    case 'create_folder': {
      if (!target.newParentId || !target.newTitle) {
        throw new Error(`create_folder action missing newParentId/newTitle: ${action.id}`);
      }
      const parentId = await resolveParentId(target.newParentId);
      const existing = await findChildFolder(parentId, target.newTitle);
      if (existing) return existing; // 幂等：同名目录已存在
      const created = await chrome.bookmarks.create({
        parentId,
        title: target.newTitle,
        ...(target.url ? { url: target.url } : {}),
      });
      return created.id;
    }
    case 'rename': {
      if (!target.id || !target.newTitle) {
        throw new Error(`rename action missing id/newTitle: ${action.id}`);
      }
      const updated = await chrome.bookmarks.update(target.id, { title: target.newTitle });
      return updated.id;
    }
    case 'merge': {
      // merge：把 target 的所有子节点移入 newParentId，然后删除空壳 target
      if (!target.id || !target.newParentId) {
        throw new Error(`merge action missing id/newParentId: ${action.id}`);
      }
      const parentId = await resolveParentId(target.newParentId);
      const children = await chrome.bookmarks.getChildren(target.id);
      for (const child of children) {
        await chrome.bookmarks.move(child.id, { parentId });
      }
      await chrome.bookmarks.removeTree(target.id);
      return target.id;
    }
    case 'delete': {
      if (!target.id) {
        throw new Error(`delete action missing id: ${action.id}`);
      }
      await chrome.bookmarks.removeTree(target.id);
      return target.id;
    }
    default: {
      const exhaustive: never = op;
      throw new Error(`Unknown action op: ${String(exhaustive)}`);
    }
  }
}
