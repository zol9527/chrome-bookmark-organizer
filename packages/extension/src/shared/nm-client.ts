/**
 * UI 侧 RPC client：封装 chrome.runtime.sendMessage 与 SW 通信。
 * 阶段 1 为 stub；类型契约与 messaging.ts 的 InternalRequest 对齐。
 */
import type { Plan } from '@cborg/shared';
import type { InternalRequest } from './messaging';

/** 通用 RPC：发送 InternalRequest，返回解包后的 data */
export async function sendRpc<T = unknown>(request: InternalRequest): Promise<T> {
  throw new Error('TODO phase2: chrome.runtime.sendMessage RPC');
}

/** 查询 NM host 连接状态 */
export async function getNmStatus(): Promise<{ connected: boolean }> {
  throw new Error('TODO phase2: rpc nm:status');
}

/** 拉取 pending plans */
export async function listPlans(): Promise<Plan[]> {
  throw new Error('TODO phase2: rpc plan:list');
}

/** 确认 plan（进入 approved，等待执行） */
export async function confirmPlan(planId: string): Promise<Plan> {
  throw new Error('TODO phase2: rpc plan:confirm');
}

/** 拒绝 plan */
export async function rejectPlan(planId: string): Promise<Plan> {
  throw new Error('TODO phase2: rpc plan:reject');
}

/** 触发 plan 执行 */
export async function executePlan(planId: string): Promise<Plan> {
  throw new Error('TODO phase2: rpc plan:execute');
}
