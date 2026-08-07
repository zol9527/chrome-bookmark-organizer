/**
 * 执行前快照 + 回滚存储。阶段 1 为 stub。
 * 快照存放于 chrome.storage.session（键见 @cborg/shared 的 STORAGE_AREAS.SNAPSHOTS），
 * 浏览器关闭即清，避免无限增长。
 */
import type { BookmarkSnapshot } from '@cborg/shared';

/** 对 plan 执行前的书签树拍快照，返回快照记录 */
export async function takeSnapshot(planId: string): Promise<BookmarkSnapshot> {
  throw new Error('TODO phase2: take pre-execution snapshot');
}

/** 按 id 读取快照，不存在返回 null */
export async function getSnapshot(id: string): Promise<BookmarkSnapshot | null> {
  throw new Error('TODO phase2: get snapshot');
}

/** 用快照恢复书签树（回滚），返回是否成功 */
export async function restoreSnapshot(id: string): Promise<boolean> {
  throw new Error('TODO phase2: restore bookmarks from snapshot');
}
