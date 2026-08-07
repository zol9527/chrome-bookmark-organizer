import { beforeEach, describe, expect, it } from 'vitest';
import type { PlanExecutionReport } from '@cborg/shared';
import type { InternalEvent } from '../shared/messaging';
import { installChromeMock } from './chrome-mock';
import {
  buildMigrationPlan,
  cancelPlan,
  confirmPlan,
  createPlan,
  executePlan,
  getPlan,
  rollback,
} from '../background/plan-engine';
import { onInternalEvent, resetStoreCache } from '../background/store';

beforeEach(() => {
  installChromeMock();
  resetStoreCache();
});

async function addFolder(title: string, parentId = '1'): Promise<string> {
  return (await chrome.bookmarks.create({ parentId, title })).id;
}

async function addBookmark(title: string, url: string, parentId = '1'): Promise<string> {
  return (await chrome.bookmarks.create({ parentId, title, url })).id;
}

describe('plan-engine', () => {
  it('createPlan 持久化 pending plan 并广播 plan:created', async () => {
    const events: InternalEvent[] = [];
    const off = onInternalEvent((e) => events.push(e));

    const plan = await createPlan({
      title: 'Move things',
      description: 'demo',
      actions: [
        { op: 'move', target: { id: 'x', newParentId: '1' }, rationale: 'r1' },
        { op: 'rename', target: { id: 'y', newTitle: 'New' }, rationale: 'r2' },
      ],
    });
    off();

    expect(plan.status).toBe('pending');
    expect(plan.createdBy).toBe('ai');
    expect(plan.actions.map((a) => a.id)).toEqual(['act_1', 'act_2']);
    expect(await getPlan(plan.id)).toEqual(plan);
    expect(events.some((e) => e.type === 'plan:created')).toBe(true);
  });

  it('confirmPlan / cancelPlan 状态流转并广播 plan:updated', async () => {
    const plan = await createPlan({ title: 'T', actions: [] });

    const confirmed = await confirmPlan(plan.id);
    expect(confirmed.status).toBe('approved');
    expect((await getPlan(plan.id))!.status).toBe('approved');

    const cancelled = await cancelPlan(plan.id);
    expect(cancelled).toEqual({ planId: plan.id, cancelled: true });
    expect((await getPlan(plan.id))!.status).toBe('rejected');

    // 已拒绝的 plan 不可再 confirm；重复 cancel 返回 cancelled:false
    await expect(confirmPlan(plan.id)).rejects.toThrow();
    expect(await cancelPlan(plan.id)).toEqual({ planId: plan.id, cancelled: false });
  });

  it('executePlan happy path：全部 applied → completed，onProgress 逐 action 上报', async () => {
    const dest = await addFolder('Dest');
    const bm = await addBookmark('b', 'https://b.com');

    const plan = await createPlan({
      title: 'T',
      actions: [{ op: 'move', target: { id: bm, newParentId: dest }, rationale: 'r' }],
    });
    const progress: PlanExecutionReport[] = [];
    const report = await executePlan(plan.id, (r) => progress.push(r));

    expect(report.success).toBe(true);
    expect(report.applied).toEqual(['act_1']);
    expect(report.rejected).toHaveLength(0);
    expect(report.snapshotId).toBeTruthy();
    expect((await getPlan(plan.id))!.status).toBe('completed');
    expect((await chrome.bookmarks.get(bm))[0]!.parentId).toBe(dest);
    expect(progress).toHaveLength(1);
    expect(progress[0]!.applied).toEqual(['act_1']);
  });

  it('executePlan 部分失败 → failed + 自动回滚到快照', async () => {
    const dest = await addFolder('Dest');
    const bm = await addBookmark('b', 'https://b.com');

    const plan = await createPlan({
      title: 'T',
      actions: [
        { op: 'move', target: { id: bm, newParentId: dest }, rationale: 'r1' },
        { op: 'move', target: { id: '99999', newParentId: dest }, rationale: 'r2' }, // 源不存在
      ],
    });

    const report = await executePlan(plan.id);
    expect(report.success).toBe(false);
    expect(report.applied).toEqual(['act_1']);
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0]!.actionId).toBe('act_2');
    expect((await getPlan(plan.id))!.status).toBe('failed');

    // 自动回滚：act_1 的移动被撤销，bm 回到书签栏
    expect((await chrome.bookmarks.get(bm))[0]!.parentId).toBe('1');
  });

  it('executePlan 拒绝已 rejected / completed 的 plan', async () => {
    const plan = await createPlan({ title: 'T', actions: [] });
    await cancelPlan(plan.id);
    await expect(executePlan(plan.id)).rejects.toThrow(/rejected/);

    const p2 = await createPlan({ title: 'T2', actions: [] });
    await executePlan(p2.id);
    await expect(executePlan(p2.id)).rejects.toThrow(/completed/);
  });

  it('rollback(snapshotId) 手动回滚：恢复移动、删除快照后新建的节点', async () => {
    const dest = await addFolder('Dest');
    const bm = await addBookmark('b', 'https://b.com');

    const plan = await createPlan({
      title: 'T',
      actions: [{ op: 'move', target: { id: bm, newParentId: dest }, rationale: 'r' }],
    });
    const report = await executePlan(plan.id);
    const snapshotId = report.snapshotId!;

    // 快照之后又改了树：新建并移动一个书签
    const bm2 = await addBookmark('c', 'https://c.com');
    await chrome.bookmarks.move(bm2, { parentId: dest });

    const res = await rollback(snapshotId);
    expect(res.restored).toBe(true);
    expect(res.snapshotId).toBe(snapshotId);

    // bm 回到书签栏；bm2（快照后新建）被删除
    expect((await chrome.bookmarks.get(bm))[0]!.parentId).toBe('1');
    expect(await chrome.bookmarks.get(bm2)).toHaveLength(0);
    expect((await getPlan(plan.id))!.status).toBe('rolled_back');
  });

  it('buildMigrationPlan 对照 legacy makePlan：映射命中 / 未映射兜底 / 目标根跳过 / 直排书签', async () => {
    const folderMap = { 工作: '10_Work_Projects', Home: '90_Personal_Life' };
    const topLevel = ['00_Inbox', '10_Work_Projects', '90_Personal_Life'] as const;

    const workId = await addFolder('工作');
    const unmappedId = await addFolder('未映射目录');
    await addFolder('10_Work_Projects'); // 目标根，应跳过
    const directId = await addBookmark('直排书签', 'https://direct.com');

    const plan = await buildMigrationPlan({ folderMap, topLevelFolders: topLevel });

    expect(plan.createdBy).toBe('legacy-migrator');
    expect(plan.status).toBe('pending');
    expect(plan.actions).toHaveLength(3);
    expect(plan.actions.every((a) => a.op === 'move')).toBe(true);

    const byTarget = new Map(plan.actions.map((a) => [a.target.id, a]));
    // 命中映射 → 移入 10_Work_Projects
    expect(byTarget.get(workId)!.target.newParentId).toBe('10_Work_Projects');
    // 未命中映射 → 兜底 00_Inbox
    expect(byTarget.get(unmappedId)!.target.newParentId).toBe('00_Inbox');
    // 书签栏直排书签 → 00_Inbox
    expect(byTarget.get(directId)!.target.newParentId).toBe('00_Inbox');
  });

  it('buildMigrationPlan + executePlan 一键迁移端到端（目标根缺失时自动创建）', async () => {
    const folderMap = { 工作: '10_Work_Projects' };
    const topLevel = ['00_Inbox', '10_Work_Projects'] as const;
    const workId = await addFolder('工作');
    await addBookmark('b', 'https://b.com', workId);

    const plan = await buildMigrationPlan({ folderMap, topLevelFolders: topLevel });
    const report = await executePlan(plan.id);
    expect(report.success).toBe(true);

    // 执行后：工作 移入 10_Work_Projects（pre-flight 自动创建缺失的目标根）
    const moved = (await chrome.bookmarks.get(workId))[0]!;
    expect(moved.parentId).not.toBe('1');
    const root = await chrome.bookmarks.get(moved.parentId!);
    expect(root[0]!.title).toBe('10_Work_Projects');
  });
});
