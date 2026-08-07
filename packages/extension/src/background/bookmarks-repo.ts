/**
 * chrome.bookmarks API 封装（只读查询 + applyAction 写操作收敛层）。
 * 阶段 1 全部为 stub，签名与 @cborg/shared 的 McpToolArgs/Result 对齐。
 */
import type { BookmarkNode, PlanAction } from '@cborg/shared';

/** 重复 URL 分组，与 McpToolResult['bookmark_find_duplicates'] 对齐 */
export interface DuplicateGroup {
  url: string;
  nodes: BookmarkNode[];
}

/** 整树查询：可指定起始 folderId 与最大深度 */
export async function getTree(folderId?: string, depth?: number): Promise<BookmarkNode[]> {
  throw new Error('TODO phase2: chrome.bookmarks.getTree');
}

/** 列出 folderId 的直接子节点 */
export async function list(folderId: string): Promise<BookmarkNode[]> {
  throw new Error('TODO phase2: chrome.bookmarks.getChildren');
}

/** 按 query 搜索书签，可选 limit */
export async function search(query: string, limit?: number): Promise<BookmarkNode[]> {
  throw new Error('TODO phase2: chrome.bookmarks.search');
}

/** 统计书签数量（folderId 缺省时为全树） */
export async function count(folderId?: string): Promise<number> {
  throw new Error('TODO phase2: count bookmarks');
}

/** 找出重复 URL 分组；normalizeUrl 时先做 URL 规范化 */
export async function findDuplicates(
  folderId?: string,
  normalizeUrl?: boolean,
): Promise<DuplicateGroup[]> {
  throw new Error('TODO phase2: find duplicate bookmarks');
}

/** 执行单个 plan action（move / create_folder / rename / merge / delete） */
export async function applyAction(action: PlanAction): Promise<void> {
  throw new Error('TODO phase2: apply single plan action');
}
