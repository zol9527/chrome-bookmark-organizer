/**
 * 扩展内部消息协议（popup / options ↔ service worker）。
 *
 * 这是 UI 层与 SW 的 RPC 契约，**已被冻结**：阶段 2 实现时不要修改本文件，
 * 如需新增 type 请先回到 orchestrator 讨论 —— 它由 fixer-A（SW server 端）
 * 与 designer-C（UI client 端）共享，任何一边的协议漂移都会导致另一边编译失败。
 *
 * 与 @cborg/shared 的 NmMessage（SW ↔ native host）是不同层，勿混淆：
 *   NmMessage     —— AI client 经 MCP → host → NM → SW 这条远程路径
 *   InternalRequest —— popup/options 经 chrome.runtime → SW 这条本地 UI 路径
 *
 * 两条路径最终都到 SW 的 dispatcher，但语义不同：UI 路径只服务扩展自己的界面，
 * 不暴露给 AI；远程路径的 tool 是对外契约。
 */
import type { BookmarkNode, Plan, PlanExecutionReport } from '@cborg/shared';

// ─────────────────────────────────────────────────────────────────────────────
// popup / options → SW 的请求（RPC 风格，经 chrome.runtime.sendMessage 发送）
// ─────────────────────────────────────────────────────────────────────────────

export type InternalRequest =
  // native messaging host 状态
  | { type: 'nm:status' }
  // 用户主动触发 SW 重连 host（host 安装后 / 连接断开后）
  | { type: 'nm:reconnect' }
  // plan 管理
  | { type: 'plan:list' }
  | { type: 'plan:get'; planId: string }
  | { type: 'plan:confirm'; planId: string }
  | { type: 'plan:reject'; planId: string }
  | { type: 'plan:execute'; planId: string }
  | { type: 'plan:rollback'; snapshotId: string }
  // 书签只读
  | { type: 'bookmark:count'; folderId?: string }
  | { type: 'bookmark:get_tree'; folderId?: string; depth?: number }
  | { type: 'bookmark:search'; query: string; limit?: number }
  | { type: 'bookmark:duplicates'; folderId?: string }
  // legacy 一键迁移（迁移自原 background.js 的 plan/execute 按钮）
  | { type: 'migrate:run-oneclick' }
  // options 配置读写
  | { type: 'option:get'; key: string }
  | { type: 'option:set'; key: string; value: unknown };

// ─────────────────────────────────────────────────────────────────────────────
// 响应数据类型（按 InternalRequest.type 索引；契约层不允许遗漏）
// ─────────────────────────────────────────────────────────────────────────────

export interface InternalResponseData {
  'nm:status': { connected: boolean; hostVersion?: string; lastError?: string };
  'nm:reconnect': { connected: boolean; hostVersion?: string; lastError?: string };
  'plan:list': { plans: Plan[] };
  'plan:get': { plan: Plan | null };
  'plan:confirm': { plan: Plan };
  'plan:reject': { plan: Plan };
  'plan:execute': { report: PlanExecutionReport };
  'plan:rollback': { restored: boolean; snapshotId: string };
  'bookmark:count': { count: number };
  'bookmark:get_tree': { trees: BookmarkNode[] };
  'bookmark:search': { items: BookmarkNode[] };
  'bookmark:duplicates': { groups: { url: string; nodes: BookmarkNode[] }[] };
  'migrate:run-oneclick': { planId: string; actionCount: number };
  'option:get': { value: unknown };
  'option:set': { ok: true };
}

/** SW → UI 的响应信封（类型保留 data 形状） */
export type InternalResponse<T extends InternalRequest['type'] = InternalRequest['type']> =
  | { ok: true; data: InternalResponseData[T] }
  | { ok: false; error: string };

// ─────────────────────────────────────────────────────────────────────────────
// SW → popup / options 的主动事件（无需响应，用于状态广播）
// ─────────────────────────────────────────────────────────────────────────────

export type InternalEvent =
  | { type: 'plan:created'; plan: Plan }
  | { type: 'plan:updated'; plan: Plan }
  | { type: 'plan:executing'; planId: string; snapshotId: string }
  | { type: 'plan:completed'; planId: string; report: PlanExecutionReport }
  | { type: 'nm:status'; connected: boolean; hostVersion?: string };

// ─────────────────────────────────────────────────────────────────────────────
// 类型化的 client / server 辅助（避免 popup 与 SW 各写一遍类型断言）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * UI 侧调用的 client helper（popup/options 直接用，不需要自己 wrap sendMessage）。
 * 实现由 designer-C 在 packages/extension/src/shared/rpc-client.ts 完成。
 */
export type RpcCall = <T extends InternalRequest['type']>(
  request: Extract<InternalRequest, { type: T }>,
) => Promise<InternalResponseData[T]>;

/** SW 侧 dispatcher 函数签名（fixer-A 实现） */
export type RpcHandler = (
  request: InternalRequest,
  sender: chrome.runtime.MessageSender,
) => Promise<InternalResponse>;
