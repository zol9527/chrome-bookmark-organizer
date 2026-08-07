/**
 * Chrome 书签节点的纯类型投影，与 chrome.bookmarks.BookmarkTreeNode 同构。
 * 不直接依赖 @types/chrome，让 shared 包能在 Node（mcp-host）侧使用。
 */
export interface BookmarkNode {
  id: string;
  parentId?: string;
  index?: number;
  url?: string;
  title: string;
  dateAdded?: number;
  dateGroupModified?: number;
  children?: BookmarkNode[];
}

/**
 * Chrome 固定的根文件夹 ID 约定。
 */
export const ROOT_IDS = {
  BOOKMARKS_BAR: '1',
  OTHER_BOOKMARKS: '2',
  MOBILE_BOOKMARKS: '3',
} as const;

export type RootId = (typeof ROOT_IDS)[keyof typeof ROOT_IDS];

/**
 * Plan action 的操作类型。
 * 设计原则：所有写操作都收敛为 PlanAction，不暴露裸的 move/remove/create。
 */
export type PlanActionOp = 'move' | 'create_folder' | 'rename' | 'merge' | 'delete';

/**
 * 单个 plan action —— PlanEngine（迁移自现 background.js 的硬编码规则引擎）与
 * AI 提议（plan_propose）共同的产物。
 */
export interface PlanAction {
  /** 局部唯一 id（plan 范围内） */
  id: string;
  op: PlanActionOp;
  target: {
    /** 操作的源 bookmark/folder id（move/rename/merge/delete 必填） */
    id?: string;
    /** move/merge 的目标父文件夹 id */
    newParentId?: string;
    /** move 的目标同级序号 */
    newIndex?: number;
    /** rename / create_folder / merge 的新标题 */
    newTitle?: string;
    /** 预留：未来支持更新 url */
    url?: string;
  };
  /** 人可读理由；AI 提议时必填，便于 popup diff 显示 */
  rationale: string;
}

/**
 * Plan 生命周期状态。
 *
 * pending → approved → executing → completed
 *                 ↘ rejected
 * executing → failed → rolled_back（自动或手动）
 */
export type PlanStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'rolled_back';

/**
 * Plan 来源。legacy-migrator 保留对原 background.js 一键迁移逻辑的兼容路径。
 */
export type PlanOrigin = 'ai' | 'manual' | 'legacy-migrator';

/**
 * 完整 plan。pending plans 列表持久化在 chrome.storage.local。
 */
export interface Plan {
  id: string;
  title: string;
  description?: string;
  actions: PlanAction[];
  status: PlanStatus;
  createdAt: number;
  updatedAt: number;
  createdBy: PlanOrigin;
  /** 仅在 status 进入 executing 之后填充 */
  executionReport?: PlanExecutionReport;
}

/**
 * plan_execute 的返回报告，也作为 popup 通知用户和 AI 客户端的依据。
 */
export interface PlanExecutionReport {
  startedAt: number;
  finishedAt: number;
  /** 成功执行的 action id 列表 */
  applied: string[];
  /** 被拒绝（校验失败、目标不存在等）的 action */
  rejected: { actionId: string; reason: string }[];
  /** 关联的执行前快照 id（用于 plan_rollback） */
  snapshotId?: string;
  success: boolean;
}

/**
 * 执行前的全树快照。轻量反序列化形态（不存 chrome 节点引用）。
 */
export interface BookmarkSnapshot {
  id: string;
  createdAt: number;
  planId: string;
  /** 根级别树（通常 3 棵：bar / other / mobile） */
  trees: BookmarkNode[];
}
