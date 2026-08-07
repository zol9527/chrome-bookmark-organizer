/**
 * Plan 引擎：create → confirm → execute → report / rollback 生命周期。
 * 阶段 1 全部为 stub，签名与 @cborg/shared 的 Plan / McpToolResult 对齐。
 */
import type { Plan, PlanAction, PlanExecutionReport } from '@cborg/shared';

/** 提案输入（与 MCP plan_propose 对齐：action 不含 id，由引擎分配） */
export type PlanProposal = Readonly<{
  title: string;
  description?: string;
  actions: ReadonlyArray<Pick<PlanAction, 'op' | 'target' | 'rationale'>>;
}>;

/** 创建 plan（pending 状态），返回完整 plan */
export async function createPlan(input: PlanProposal): Promise<Plan> {
  throw new Error('TODO phase2: create plan');
}

/** 按 id 查询 plan，不存在返回 null */
export async function getPlan(id: string): Promise<Plan | null> {
  throw new Error('TODO phase2: get plan');
}

/** 取消 pending plan，返回取消结果（与 MCP plan_cancel 对齐） */
export async function cancelPlan(id: string): Promise<{ planId: string; cancelled: boolean }> {
  throw new Error('TODO phase2: cancel plan');
}

/** 执行 plan（先快照后逐 action apply），onProgress 报告执行进度 */
export async function executePlan(
  id: string,
  onProgress?: (report: PlanExecutionReport) => void,
): Promise<PlanExecutionReport> {
  throw new Error('TODO phase2: execute plan');
}

/** 依据 snapshot 回滚整个 plan */
export async function rollback(
  snapshotId: string,
): Promise<{ restored: boolean; snapshotId: string }> {
  throw new Error('TODO phase2: rollback plan from snapshot');
}
