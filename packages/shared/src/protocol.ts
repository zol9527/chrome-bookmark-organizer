/**
 * 扩展 SW ↔ MCP host 之间的 Native Messaging 消息协议。
 *
 * 传输层细节（32-bit 长度前缀 JSON、UTF-8）由 Chrome 与 host 的 NM runtime 处理，
 * 这里只定义应用层消息形状。所有消息都是 JSON 序列化的 NmMessage。
 */
export type NmMessage = NmRequest | NmResponse | NmEvent;

/**
 * host → SW：调用某个 MCP tool（host 把 MCP client 的请求转发过来）。
 */
export interface NmRequest {
  kind: 'request';
  /** 用于 response 配对的 correlation id */
  id: string;
  tool: McpToolName;
  args: Readonly<Record<string, unknown>> | null;
}

/**
 * SW → host：tool 调用的应答。
 */
export interface NmResponse {
  kind: 'response';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string; details?: unknown };
}

/**
 * 双向事件（不要求 response，用于状态广播）。
 *
 * - SW → host：plan 状态变化（pending/approved/executing/completed）
 * - host → SW：host_ready / host_shutdown（生命周期告知）
 */
export interface NmEvent {
  kind: 'event';
  event:
    | 'plan_created'
    | 'plan_updated'
    | 'plan_executing'
    | 'plan_completed'
    | 'host_ready'
    | 'host_shutdown';
  payload?: unknown;
}

/**
 * 暴露给外部 AI 客户端的 MCP tool 名清单（10 个）。
 *
 * 安全原则：写操作只通过 plan_execute 落地，且必须经 popup 确认；
 * 此处**不**包含裸 move/remove/create 工具，这是物理安全边界。
 */
export const MCP_TOOLS = [
  'bookmark_get_tree',
  'bookmark_list',
  'bookmark_search',
  'bookmark_count',
  'bookmark_find_duplicates',
  'plan_propose',
  'plan_get',
  'plan_cancel',
  'plan_execute',
  'plan_rollback',
] as const;

export type McpToolName = (typeof MCP_TOOLS)[number];

/**
 * MCP tool 参数类型映射（编译期契约，便于 host 和 SW 双方共享）。
 */
export interface McpToolArgs {
  bookmark_get_tree: { folderId?: string; depth?: number };
  bookmark_list: { folderId: string };
  bookmark_search: { query: string; limit?: number };
  bookmark_count: { folderId?: string };
  bookmark_find_duplicates: { folderId?: string; normalizeUrl?: boolean };
  plan_propose: {
    title: string;
    description?: string;
    actions: ReadonlyArray<
      Pick<import('./bookmark').PlanAction, 'op' | 'target' | 'rationale'>
    >;
  };
  plan_get: { planId: string };
  plan_cancel: { planId: string };
  plan_execute: { planId: string };
  plan_rollback: { snapshotId: string };
}

/**
 * MCP tool 结果类型映射。
 */
export interface McpToolResult {
  bookmark_get_tree: { trees: import('./bookmark').BookmarkNode[] };
  bookmark_list: { items: import('./bookmark').BookmarkNode[] };
  bookmark_search: { items: import('./bookmark').BookmarkNode[] };
  bookmark_count: { count: number };
  bookmark_find_duplicates: {
    groups: { url: string; nodes: import('./bookmark').BookmarkNode[] }[];
  };
  plan_propose: { planId: string; actions: import('./bookmark').PlanAction[] };
  plan_get: { plan: import('./bookmark').Plan | null };
  plan_cancel: { planId: string; cancelled: boolean };
  plan_execute: { report: import('./bookmark').PlanExecutionReport };
  plan_rollback: { restored: boolean; snapshotId: string };
}
