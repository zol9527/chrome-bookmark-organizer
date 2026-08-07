import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock, makePlan } from './chrome-mock';
import {
  deletePlan,
  getPlan,
  getPlans,
  loadPlans,
  removePlan,
  resetStoreCache,
  savePlan,
  savePlans,
  subscribe,
  upsertPlan,
} from '../background/store';

beforeEach(() => {
  installChromeMock();
  resetStoreCache();
});

describe('store', () => {
  it('savePlan / getPlan / getPlans 持久化并可重新加载', async () => {
    await savePlan(makePlan({ id: 'a' }));
    await savePlan(makePlan({ id: 'b', title: 'plan b' }));

    expect((await getPlan('a'))?.id).toBe('a');
    expect((await getPlan('b'))?.title).toBe('plan b');
    expect((await getPlans()).map((p) => p.id).sort()).toEqual(['a', 'b']);

    // 模拟 SW 重启：清空内存缓存后从 chrome.storage.local 重新加载
    resetStoreCache();
    const reloaded = await getPlans();
    expect(reloaded.map((p) => p.id).sort()).toEqual(['a', 'b']);
  });

  it('upsertPlan 覆盖同 id / savePlans 全量替换 / deletePlan removePlan 删除', async () => {
    await upsertPlan(makePlan({ id: 'x', title: 'v1' }));
    await upsertPlan(makePlan({ id: 'x', title: 'v2' }));
    expect((await getPlan('x'))?.title).toBe('v2');

    await savePlans([makePlan({ id: 'y' })]);
    expect(await getPlan('x')).toBeNull();
    expect(await getPlan('y')).not.toBeNull();

    await deletePlan('y');
    await savePlan(makePlan({ id: 'z' }));
    await removePlan('z');
    expect(await getPlan('y')).toBeNull();
    expect(await getPlan('z')).toBeNull();

    expect((await loadPlans()).length).toBe(0);
  });

  it('subscribe 发布订阅：save 与 delete 都通知', async () => {
    const seen: string[][] = [];
    const off = subscribe((plans) => seen.push(plans.map((p) => p.id)));

    await savePlan(makePlan({ id: 'x' }));
    await savePlan(makePlan({ id: 'y' }));
    await deletePlan('x');
    off();
    await savePlan(makePlan({ id: 'z' })); // 退订后不再通知

    expect(seen).toEqual([['x'], ['x', 'y'], ['y']]);
  });
});
