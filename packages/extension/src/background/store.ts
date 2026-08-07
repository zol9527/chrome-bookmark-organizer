/**
 * pending plans 的内存 + chrome.storage.local 同步存储。
 * 阶段 1 为 stub。
 */
import type { Plan } from '@cborg/shared';

/** 加载全部 pending plans */
export async function loadPlans(): Promise<Plan[]> {
  throw new Error('TODO phase2: load plans from storage');
}

/** 全量持久化 plans 列表 */
export async function savePlans(plans: Plan[]): Promise<void> {
  throw new Error('TODO phase2: persist plans');
}

/** 新增或更新单个 plan */
export async function upsertPlan(plan: Plan): Promise<void> {
  throw new Error('TODO phase2: upsert plan');
}

/** 删除单个 plan */
export async function removePlan(planId: string): Promise<void> {
  throw new Error('TODO phase2: remove plan');
}
