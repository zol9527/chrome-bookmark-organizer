/**
 * Background service worker 入口：只做装配与消息路由，业务逻辑委托给下方模块。
 *
 * - 保留 onInstalled / onConnect（port 注册用于事件推送）
 * - chrome.runtime.onMessage：处理 InternalRequest，经 mapping table 路由到
 *   plan-engine / bookmarks-repo / nm-bridge / options 存储，异步返回 InternalResponse
 * - 内部事件（plan:* / nm:*）订阅后广播给扩展页面与已连接 port
 */
import { STORAGE_AREAS } from '@cborg/shared';
import type { InternalRequest, InternalResponse, RpcHandler } from '../shared/messaging';
import { count, findDuplicates, getTree, search } from './bookmarks-repo';
import { getNmStatus, startNmBridge, stopNmBridge } from './nm-bridge';
import {
  buildMigrationPlan,
  cancelPlan,
  confirmPlan,
  executePlan,
  getPlan,
  listPlans,
  rollback,
} from './plan-engine';
import { onInternalEvent } from './store';

/** 已连接的扩展页面 port（popup/options 用长连接收事件） */
const ports = new Set<chrome.runtime.Port>();

function broadcastEvent(event: unknown): void {
  chrome.runtime.sendMessage(event).catch(() => {});
  for (const port of ports) port.postMessage(event);
}

async function readOptions(): Promise<Record<string, unknown>> {
  const stored = await chrome.storage.local.get(STORAGE_AREAS.OPTIONS);
  const raw = stored[STORAGE_AREAS.OPTIONS];
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

/**
 * InternalRequest → handler 的映射表。
 * 每个 handler 实现 RpcHandler：返回 InternalResponse（ok:true 带 data / ok:false 带 error）。
 */
const handlers: Record<InternalRequest['type'], RpcHandler> = {
  'nm:status': async () => ({ ok: true, data: getNmStatus() }),
  'nm:reconnect': async () => {
    stopNmBridge();
    startNmBridge();
    return { ok: true, data: getNmStatus() };
  },
  'plan:list': async () => {
    return { ok: true, data: { plans: await listPlans() } };
  },
  'plan:get': async (request) => {
    const { planId } = request as Extract<InternalRequest, { type: 'plan:get' }>;
    return { ok: true, data: { plan: await getPlan(planId) } };
  },
  'plan:confirm': async (request) => {
    const { planId } = request as Extract<InternalRequest, { type: 'plan:confirm' }>;
    return { ok: true, data: { plan: await confirmPlan(planId) } };
  },
  'plan:reject': async (request) => {
    const { planId } = request as Extract<InternalRequest, { type: 'plan:reject' }>;
    await cancelPlan(planId);
    const plan = await getPlan(planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);
    return { ok: true, data: { plan } };
  },
  'plan:execute': async (request) => {
    const { planId } = request as Extract<InternalRequest, { type: 'plan:execute' }>;
    return { ok: true, data: { report: await executePlan(planId) } };
  },
  'plan:rollback': async (request) => {
    const { snapshotId } = request as Extract<InternalRequest, { type: 'plan:rollback' }>;
    return { ok: true, data: await rollback(snapshotId) };
  },
  'bookmark:count': async (request) => {
    const { folderId } = request as Extract<InternalRequest, { type: 'bookmark:count' }>;
    return { ok: true, data: { count: await count(folderId) } };
  },
  'bookmark:get_tree': async (request) => {
    const { folderId, depth } = request as Extract<InternalRequest, { type: 'bookmark:get_tree' }>;
    return { ok: true, data: { trees: await getTree(folderId, depth) } };
  },
  'bookmark:search': async (request) => {
    const { query, limit } = request as Extract<InternalRequest, { type: 'bookmark:search' }>;
    return { ok: true, data: { items: await search(query, limit) } };
  },
  'bookmark:duplicates': async (request) => {
    const { folderId } = request as Extract<InternalRequest, { type: 'bookmark:duplicates' }>;
    return { ok: true, data: { groups: await findDuplicates(folderId) } };
  },
  // legacy 一键迁移：popup 的「一键迁移」按钮 = 隐式确认，SW 内自动 build → confirm → execute
  'migrate:run-oneclick': async () => {
    const plan = await buildMigrationPlan();
    await confirmPlan(plan.id);
    await executePlan(plan.id);
    return { ok: true, data: { planId: plan.id, actionCount: plan.actions.length } };
  },
  'option:get': async (request) => {
    const { key } = request as Extract<InternalRequest, { type: 'option:get' }>;
    const options = await readOptions();
    return { ok: true, data: { value: options[key] } };
  },
  'option:set': async (request) => {
    const { key, value } = request as Extract<InternalRequest, { type: 'option:set' }>;
    const options = await readOptions();
    options[key] = value;
    await chrome.storage.local.set({ [STORAGE_AREAS.OPTIONS]: options });
    return { ok: true, data: { ok: true } };
  },
};

async function dispatchRpc(
  request: InternalRequest,
  sender: chrome.runtime.MessageSender,
): Promise<InternalResponse> {
  const handler = handlers[request.type];
  if (!handler) {
    return { ok: false, error: `Unknown request type: ${String((request as { type?: unknown }).type)}` };
  }
  try {
    return await handler(request, sender);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function bindRuntimeEvents(): void {
  chrome.runtime.onInstalled.addListener((details) => {
    console.info('[cborg] onInstalled:', details.reason);
  });

  chrome.runtime.onConnect.addListener((port) => {
    console.info('[cborg] port connected:', port.name);
    ports.add(port);
    port.onDisconnect.addListener(() => {
      ports.delete(port);
      console.info('[cborg] port disconnected:', port.name);
    });
  });

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    dispatchRpc(message as InternalRequest, sender)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true; // 异步响应
  });
}

function boot(): void {
  bindRuntimeEvents();
  onInternalEvent(broadcastEvent);
  // host 未注册时 connectNative 会立即断开，nm-bridge 记录状态并广播 nm:status，不抛
  startNmBridge();
  console.info('[cborg] background ready');
}

boot();
