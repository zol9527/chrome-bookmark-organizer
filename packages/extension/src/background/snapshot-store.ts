/**
 * 执行前快照 + 回滚存储。
 * 快照存放于 chrome.storage.session（键前缀 'snapshot:'，见 @cborg/shared 的
 * STORAGE_AREAS.SNAPSHOTS 约定），浏览器关闭即清，LRU 限制 10 个。
 */
import type { BookmarkNode, BookmarkSnapshot } from '@cborg/shared';
import { applyAction, getTree } from './bookmarks-repo';

const KEY_PREFIX = 'snapshot:';
const MAX_SNAPSHOTS = 10;

function keyOf(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

/** 对 plan 执行前的书签树拍快照，返回快照记录（超限时淘汰最旧） */
export async function takeSnapshot(planId: string): Promise<BookmarkSnapshot> {
  const trees = await getTree();
  const snapshot: BookmarkSnapshot = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    planId,
    trees,
  };
  await chrome.storage.session.set({ [keyOf(snapshot.id)]: snapshot });
  await evictIfNeeded();
  return snapshot;
}

async function evictIfNeeded(): Promise<void> {
  const snaps = await listSnapshots();
  const overflow = snaps.length - MAX_SNAPSHOTS;
  if (overflow <= 0) return;
  for (const oldest of snaps.slice(0, overflow)) {
    await chrome.storage.session.remove(keyOf(oldest.id));
  }
}

/** 按 id 读取快照，不存在返回 null */
export async function getSnapshot(id: string): Promise<BookmarkSnapshot | null> {
  const stored = await chrome.storage.session.get(keyOf(id));
  const snap = stored[keyOf(id)] as BookmarkSnapshot | undefined;
  return snap ?? null;
}

/** 列出全部快照（按创建时间升序） */
export async function listSnapshots(): Promise<BookmarkSnapshot[]> {
  const all = await chrome.storage.session.get(null);
  const snaps = Object.entries(all)
    .filter(([k]) => k.startsWith(KEY_PREFIX))
    .map(([, v]) => v as BookmarkSnapshot);
  return snaps.sort((a, b) => a.createdAt - b.createdAt);
}

/** 建立 id → 节点 的索引（跨整树） */
function indexTree(trees: BookmarkNode[]): Map<string, BookmarkNode> {
  const map = new Map<string, BookmarkNode>();
  const walk = (nodes: BookmarkNode[]): void => {
    for (const n of nodes) {
      map.set(n.id, n);
      walk(n.children ?? []);
    }
  };
  walk(trees);
  return map;
}

/** 节点在树中的深度（BFS）；找不到返回 -1 */
function depthOf(trees: BookmarkNode[], id: string): number {
  const queue: Array<[BookmarkNode, number]> = trees.map((n) => [n, 0]);
  while (queue.length > 0) {
    const [node, d] = queue.shift()!;
    if (node.id === id) return d;
    queue.push(...(node.children ?? []).map((c) => [c, d + 1] as [BookmarkNode, number]));
  }
  return -1;
}

/**
 * 用快照恢复书签树（回滚），返回是否成功。
 *
 * 流程：diff 当前树 vs 快照 → 生成反向操作：
 *   1. 快照后新建的节点 → removeTree（先深后浅）
 *   2. 快照中有而当前缺失的节点 → 重建（先浅后深；父节点重建后 id 会变，用 map 关联）
 *   3. 两边都有的节点 → 恢复标题（rename）、父目录与序号（move）
 *
 * 说明：重建与删除走 chrome.bookmarks 直接调用，而不是 applyAction ——
 * applyAction 的 create_folder 带幂等语义（同名复用），不适合精确恢复。
 */
export async function restoreSnapshot(id: string): Promise<boolean> {
  const snapshot = await getSnapshot(id);
  if (!snapshot) return false;

  const current = await getTree();
  const snapById = indexTree(snapshot.trees);
  const curById = indexTree(current);
  const ROOTS = new Set(['1', '2', '3']);

  // 1) 快照后新建的节点 → 删除（先深后浅，保证子节点先于父节点删除）
  const created = [...curById.values()]
    .filter((n) => !snapById.has(n.id) && !ROOTS.has(n.id))
    .sort((a, b) => depthOf(current, b.id) - depthOf(current, a.id));
  for (const node of created) {
    await chrome.bookmarks.removeTree(node.id).catch(() => {});
  }

  // 2) 快照中有而当前缺失的节点 → 重建（先浅后深），记录 snapId → 新 chrome id
  const recreated = new Map<string, string>();
  const deleted = [...snapById.values()]
    .filter((n) => !curById.has(n.id) && !ROOTS.has(n.id))
    .sort((a, b) => depthOf(snapshot.trees, a.id) - depthOf(snapshot.trees, b.id));
  for (const node of deleted) {
    const parentId = node.parentId ? (recreated.get(node.parentId) ?? node.parentId) : undefined;
    const createdNode = await chrome.bookmarks.create({
      parentId: parentId ?? '1',
      title: node.title,
      ...(node.url ? { url: node.url } : {}),
      ...(node.index != null ? { index: node.index } : {}),
    });
    recreated.set(node.id, createdNode.id);
  }

  // 3) 两边都有的节点 → 恢复标题 / 父目录 / 序号
  for (const snapNode of snapById.values()) {
    const curNode = curById.get(snapNode.id);
    if (!curNode) continue;
    if (snapNode.title !== curNode.title) {
      await chrome.bookmarks.update(snapNode.id, { title: snapNode.title });
    }
    const wantParent = snapNode.parentId
      ? (recreated.get(snapNode.parentId) ?? snapNode.parentId)
      : undefined;
    if (wantParent && (curNode.parentId !== wantParent || curNode.index !== snapNode.index)) {
      await applyAction({
        id: `restore-${snapNode.id}`,
        op: 'move',
        target: { id: snapNode.id, newParentId: wantParent, newIndex: snapNode.index },
        rationale: 'snapshot restore',
      });
    }
  }
  return true;
}
