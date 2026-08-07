/**
 * pending plans 的内存缓存 + chrome.storage.local 持久化（key 用 STORAGE_AREAS.PLANS）。
 *
 * 同时承载 SW 内部的模块级 pub/sub：
 * - subscribe(listener)：plan 列表变化通知（save / delete）
 * - onInternalEvent(listener) / emitInternalEvent(event)：InternalEvent 广播总线，
 *   plan-engine / nm-bridge 发事件，index.ts 订阅后转发给 popup/options。
 */
import { STORAGE_AREAS } from '@cborg/shared';
import type { Plan } from '@cborg/shared';
import type { InternalEvent } from '../shared/messaging';

const STORAGE_KEY = STORAGE_AREAS.PLANS;

/** 内存缓存；null 表示尚未从 storage 加载 */
let cache: Plan[] | null = null;
const listeners = new Set<(plans: Plan[]) => void>();
const eventListeners = new Set<(event: InternalEvent) => void>();

async function ensureLoaded(): Promise<void> {
  if (cache) return;
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const raw = stored[STORAGE_KEY];
  cache = Array.isArray(raw) ? (raw as Plan[]) : [];
}

async function persist(): Promise<void> {
  if (!cache) return;
  await chrome.storage.local.set({ [STORAGE_KEY]: cache });
}

function notify(): void {
  if (!cache) return;
  const snapshot = [...cache];
  for (const listener of [...listeners]) listener(snapshot);
}

/** 加载全部 plans */
export async function getPlans(): Promise<Plan[]> {
  await ensureLoaded();
  return [...cache!];
}

/** 按 id 查询 plan，不存在返回 null */
export async function getPlan(id: string): Promise<Plan | null> {
  const plans = await getPlans();
  return plans.find((p) => p.id === id) ?? null;
}

/** 新增或更新单个 plan（内存缓存 + 持久化 + 通知订阅者） */
export async function savePlan(plan: Plan): Promise<void> {
  await ensureLoaded();
  const index = cache!.findIndex((p) => p.id === plan.id);
  if (index >= 0) cache![index] = plan;
  else cache!.push(plan);
  await persist();
  notify();
}

/** 删除单个 plan */
export async function deletePlan(planId: string): Promise<void> {
  await ensureLoaded();
  cache = cache!.filter((p) => p.id !== planId);
  await persist();
  notify();
}

// ─────────────────────────────────────────────────────────────────────────────
// 保留阶段 1 stub 的导出签名（loadPlans/savePlans/upsertPlan/removePlan），
// 作为上面新 API 的别名，避免破坏既有引用。
// ─────────────────────────────────────────────────────────────────────────────

/** 加载全部 pending plans（旧签名别名） */
export async function loadPlans(): Promise<Plan[]> {
  return getPlans();
}

/** 全量持久化 plans 列表（旧签名别名） */
export async function savePlans(plans: Plan[]): Promise<void> {
  await ensureLoaded();
  cache = plans;
  await persist();
  notify();
}

/** 新增或更新单个 plan（旧签名别名） */
export async function upsertPlan(plan: Plan): Promise<void> {
  return savePlan(plan);
}

/** 删除单个 plan（旧签名别名） */
export async function removePlan(planId: string): Promise<void> {
  return deletePlan(planId);
}

// ─────────────────────────────────────────────────────────────────────────────
// SW 内部模块级 pub/sub
// ─────────────────────────────────────────────────────────────────────────────

/** 订阅 plan 列表变化，返回取消订阅函数 */
export function subscribe(listener: (plans: Plan[]) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 订阅内部事件（plan:created / plan:updated / nm:status 等），返回取消订阅函数 */
export function onInternalEvent(listener: (event: InternalEvent) => void): () => void {
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
}

/** 广播内部事件（SW 模块间） */
export function emitInternalEvent(event: InternalEvent): void {
  for (const listener of [...eventListeners]) listener(event);
}

/** 测试辅助：清空内存缓存，模拟 SW 重启后从 storage 重新加载 */
export function resetStoreCache(): void {
  cache = null;
}
