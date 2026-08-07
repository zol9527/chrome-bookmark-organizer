/**
 * chrome.storage 泛型封装。阶段 1 为 stub。
 * 存储键与 @cborg/shared 的 STORAGE_AREAS 对齐，勿在本包重复定义。
 */
import { STORAGE_AREAS } from '@cborg/shared';

/** storage 区域：plans 用 local，snapshots 用 session */
export type StorageArea = 'local' | 'session';

/** 预定义的存储键（值来自 @cborg/shared 常量） */
export const storageKeys = {
  plans: STORAGE_AREAS.PLANS,
  snapshots: STORAGE_AREAS.SNAPSHOTS,
  options: STORAGE_AREAS.OPTIONS,
} as const;

/** 读取：key 不存在时返回 fallback */
export async function getItem<T>(area: StorageArea, key: string, fallback: T): Promise<T> {
  throw new Error('TODO phase2: chrome.storage.get');
}

/** 写入（整值覆盖） */
export async function setItem<T>(area: StorageArea, key: string, value: T): Promise<void> {
  throw new Error('TODO phase2: chrome.storage.set');
}

/** 删除 */
export async function removeItem(area: StorageArea, key: string): Promise<void> {
  throw new Error('TODO phase2: chrome.storage.remove');
}
