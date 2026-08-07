/**
 * Plan 引擎：create → confirm → execute → report / rollback 生命周期。
 *
 * 迁移自 docs/legacy/background.js 的 makePlan / executePlan / repairDuplicateTargets，
 * 但把硬编码目录映射参数化：folderMap / topLevelFolders / bookmarksBarNames 均可配置，
 * 默认值来自 @cborg/shared 的 DEFAULT_FOLDER_MAP / DEFAULT_TOP_LEVEL_FOLDERS。
 */
import { DEFAULT_FOLDER_MAP, DEFAULT_TOP_LEVEL_FOLDERS } from '@cborg/shared';
import type { Plan, PlanAction, PlanExecutionReport, PlanOrigin, PlanStatus } from '@cborg/shared';
import {
  DEFAULT_BOOKMARK_BAR_NAMES,
  applyAction,
  findBookmarkBar,
  findChildFolder,
  getTree,
  list,
} from './bookmarks-repo';
import { emitInternalEvent, getPlan as getStoredPlan, getPlans, savePlan } from './store';
import { getSnapshot, restoreSnapshot, takeSnapshot } from './snapshot-store';

/** 提案输入（与 MCP plan_propose 对齐：action 不含 id，由引擎分配） */
export type PlanProposal = Readonly<{
  title: string;
  description?: string;
  actions: ReadonlyArray<Pick<PlanAction, 'op' | 'target' | 'rationale'>>;
}>;

/** listPlans 的可选过滤条件 */
export interface PlanFilter {
  status?: PlanStatus;
  createdBy?: PlanOrigin;
}

/** buildMigrationPlan 的配置（均为可选，缺省用 @cborg/shared 默认值） */
export interface MigrationPlanOptions {
  /** 源目录名 → 目标根目录名 */
  folderMap?: Record<string, string>;
  /** 目标根目录集合（书签栏下这些目录视为已整理，跳过不迁移） */
  topLevelFolders?: readonly string[];
  /** 书签栏可能标题（中英兼容） */
  bookmarksBarNames?: string[];
}

const VALID_EXECUTE_STATUSES: ReadonlySet<PlanStatus> = new Set(['pending', 'approved']);

function now(): number {
  return Date.now();
}

/** 持久化并广播 plan:created（createPlan 与 buildMigrationPlan 共用） */
async function persistPlan(plan: Plan): Promise<void> {
  await savePlan(plan);
  emitInternalEvent({ type: 'plan:created', plan });
}

/** 创建 plan（pending 状态），返回完整 plan */
export async function createPlan(input: PlanProposal): Promise<Plan> {
  const plan: Plan = {
    id: crypto.randomUUID(),
    title: input.title,
    description: input.description,
    actions: input.actions.map(
      (a, i): PlanAction => ({ id: `act_${i + 1}`, op: a.op, target: a.target, rationale: a.rationale }),
    ),
    status: 'pending',
    createdAt: now(),
    updatedAt: now(),
    createdBy: 'ai',
  };
  await persistPlan(plan);
  return plan;
}

/** 按 id 查询 plan，不存在返回 null */
export async function getPlan(id: string): Promise<Plan | null> {
  return getStoredPlan(id);
}

/** 列出 plans，可按 status / createdBy 过滤 */
export async function listPlans(filter?: PlanFilter): Promise<Plan[]> {
  const plans = await getPlans();
  if (!filter) return plans;
  return plans.filter(
    (p) =>
      (filter.status === undefined || p.status === filter.status) &&
      (filter.createdBy === undefined || p.createdBy === filter.createdBy),
  );
}

/** 确认 plan（pending → approved），广播 plan:updated */
export async function confirmPlan(id: string): Promise<Plan> {
  const plan = await getPlan(id);
  if (!plan) throw new Error(`Plan not found: ${id}`);
  if (plan.status === 'rejected' || plan.status === 'completed' || plan.status === 'failed' || plan.status === 'executing') {
    throw new Error(`Cannot confirm plan in status "${plan.status}"`);
  }
  const updated: Plan = { ...plan, status: 'approved', updatedAt: now() };
  await savePlan(updated);
  emitInternalEvent({ type: 'plan:updated', plan: updated });
  return updated;
}

/** 拒绝/取消 pending plan（→ rejected），广播 plan:updated；与 MCP plan_cancel 对齐 */
export async function cancelPlan(id: string): Promise<{ planId: string; cancelled: boolean }> {
  const plan = await getPlan(id);
  if (!plan) return { planId: id, cancelled: false };
  if (plan.status === 'executing') throw new Error('Cannot reject a plan that is executing');
  if (plan.status === 'rejected' || plan.status === 'completed' || plan.status === 'failed') {
    return { planId: id, cancelled: false };
  }
  const updated: Plan = { ...plan, status: 'rejected', updatedAt: now() };
  await savePlan(updated);
  emitInternalEvent({ type: 'plan:updated', plan: updated });
  return { planId: id, cancelled: true };
}

/**
 * 迁移 pre-flight（照搬 legacy repairDuplicateTargets 核心 + executePlan 的 ensureFolder 循环）：
 * 1. 书签栏下同名目标根目录壳 → 合并（子节点移入权威目录，删除空壳）
 * 2. 确保每个目标根目录存在（幂等）
 * 仅在 legacy-migrator 一键迁移计划上执行，AI plan 不做结构预置。
 */
async function repairDuplicateTargets(): Promise<void> {
  const trees = await getTree();
  const bar = findBookmarkBar(trees, DEFAULT_BOOKMARK_BAR_NAMES);
  if (!bar) throw new Error('Could not find the Chrome bookmarks bar.');

  const children = await list(bar.id);
  const topLevel = new Set<string>(DEFAULT_TOP_LEVEL_FOLDERS);
  const canonical = new Map<string, string>();
  const duplicates: string[] = [];
  for (const node of children) {
    if (node.url || !topLevel.has(node.title)) continue;
    if (!canonical.has(node.title)) canonical.set(node.title, node.id);
    else duplicates.push(node.id);
  }
  for (const dupId of duplicates) {
    const dup = (await chrome.bookmarks.get(dupId))[0]!;
    const destId = canonical.get(dup.title)!;
    const kids = await list(dupId);
    for (const kid of kids) {
      await chrome.bookmarks.move(kid.id, { parentId: destId });
    }
    await chrome.bookmarks.removeTree(dupId);
  }
  for (const title of DEFAULT_TOP_LEVEL_FOLDERS) {
    if (canonical.has(title)) continue;
    const existing = await findChildFolder(bar.id, title);
    if (existing) continue;
    await chrome.bookmarks.create({ parentId: bar.id, title });
  }
}

/**
 * 执行 plan（先快照后逐 action apply），onProgress 报告执行进度。
 * 全部成功 → completed；任何失败 → failed + 自动回滚（restoreSnapshot），
 * 最后统一广播 plan:completed 并返回 PlanExecutionReport。
 */
export async function executePlan(
  id: string,
  onProgress?: (report: PlanExecutionReport) => void,
): Promise<PlanExecutionReport> {
  const plan = await getPlan(id);
  if (!plan) throw new Error(`Plan not found: ${id}`);
  if (!VALID_EXECUTE_STATUSES.has(plan.status)) {
    throw new Error(`Cannot execute plan in status "${plan.status}"`);
  }

  const snapshot = await takeSnapshot(plan.id);

  // 一键迁移 pre-flight：合并重复目标根目录壳（仅 legacy-migrator）
  if (plan.createdBy === 'legacy-migrator') {
    await repairDuplicateTargets();
  }

  const executing: Plan = { ...plan, status: 'executing', updatedAt: now() };
  await savePlan(executing);
  emitInternalEvent({ type: 'plan:executing', planId: plan.id, snapshotId: snapshot.id });

  const startedAt = now();
  const applied: string[] = [];
  const rejected: { actionId: string; reason: string }[] = [];
  let success = true;

  const buildReport = (): PlanExecutionReport => ({
    startedAt,
    finishedAt: now(),
    applied: [...applied],
    rejected: [...rejected],
    snapshotId: snapshot.id,
    success,
  });

  for (const action of plan.actions) {
    try {
      await applyAction(action);
      applied.push(action.id);
    } catch (error) {
      rejected.push({ actionId: action.id, reason: error instanceof Error ? error.message : String(error) });
      success = false;
      break;
    }
    onProgress?.(buildReport());
  }

  const report = buildReport();
  const final: Plan = {
    ...executing,
    status: success ? 'completed' : 'failed',
    updatedAt: now(),
    executionReport: report,
  };
  await savePlan(final);

  if (!success) {
    // 自动回滚：尽量恢复；回滚失败也保留 failed 报告
    await restoreSnapshot(snapshot.id).catch(() => {});
  }
  emitInternalEvent({ type: 'plan:completed', planId: plan.id, report });
  return report;
}

/** 依据 snapshot 回滚，并将关联 plan 置为 rolled_back（若状态允许） */
export async function rollback(
  snapshotId: string,
): Promise<{ restored: boolean; snapshotId: string }> {
  const restored = await restoreSnapshot(snapshotId);
  if (restored) {
    const snapshot = await getSnapshot(snapshotId);
    if (snapshot) {
      const plan = await getPlan(snapshot.planId);
      if (plan && plan.status !== 'pending' && plan.status !== 'approved' && plan.status !== 'rejected') {
        const updated: Plan = { ...plan, status: 'rolled_back', updatedAt: now() };
        await savePlan(updated);
        emitInternalEvent({ type: 'plan:updated', plan: updated });
      }
    }
  }
  return { restored, snapshotId };
}

/**
 * 一键迁移计划（迁移自 legacy makePlan）：
 * 书签栏下非目标根目录的文件夹按 folderMap 映射移入目标根（未映射 → 收件箱）；
 * 书签栏直排书签移入收件箱。目标根目录一律跳过。
 * 目标根目录以「标题」作为 move 目标（newParentId），执行时按标题 ensure 幂等建目录。
 */
export async function buildMigrationPlan(options: MigrationPlanOptions = {}): Promise<Plan> {
  const folderMap = options.folderMap ?? DEFAULT_FOLDER_MAP;
  const topLevelFolders = options.topLevelFolders ?? DEFAULT_TOP_LEVEL_FOLDERS;
  const bookmarksBarNames = options.bookmarksBarNames ?? [...DEFAULT_BOOKMARK_BAR_NAMES];

  const trees = await getTree();
  const bar = findBookmarkBar(trees, bookmarksBarNames);
  if (!bar) throw new Error('Could not find the Chrome bookmarks bar.');

  const targetSet = new Set<string>(topLevelFolders);
  const inboxTitle = topLevelFolders[0] ?? '00_Inbox';
  const actions: PlanAction[] = [];
  const push = (a: Omit<PlanAction, 'id'>): void => {
    actions.push({ id: `act_${actions.length + 1}`, ...a });
  };

  // 目录优先（与 legacy makePlan 顺序一致），书签栏直排书签最后
  for (const node of bar.children ?? []) {
    if (node.url || targetSet.has(node.title)) continue;
    const dest = folderMap[node.title] ?? inboxTitle;
    push({
      op: 'move',
      target: { id: node.id, newParentId: dest },
      rationale: `Source top-level folder: ${node.title}`,
    });
  }
  for (const node of bar.children ?? []) {
    if (!node.url) continue;
    push({
      op: 'move',
      target: { id: node.id, newParentId: inboxTitle },
      rationale: 'A bookmark directly on the bookmarks bar.',
    });
  }

  const plan: Plan = {
    id: crypto.randomUUID(),
    title: 'One-click migration from bookmarks bar',
    description: 'Migrate top-level bookmarks bar folders into the organized target structure.',
    actions,
    status: 'pending',
    createdAt: now(),
    updatedAt: now(),
    createdBy: 'legacy-migrator',
  };
  await persistPlan(plan);
  return plan;
}
