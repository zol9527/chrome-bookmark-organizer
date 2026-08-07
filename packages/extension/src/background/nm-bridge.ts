/**
 * Native Messaging 通信层：封装 chrome.runtime.connectNative(NM_HOST_NAME)。
 *
 * - startNmBridge：建立常驻连接；host 未注册时 connectNative 返回的 port 会
 *   立即断开（lastError），此时记录状态并广播 nm:status，**不抛异常**。
 * - sendNmRequest：correlation id（crypto.randomUUID）配对 request/response，15s 超时。
 * - handleIncomingMessage：host 推来的 NmRequest → 转成 plan-engine / bookmarks-repo
 *   调用 → 包装为 NmResponse 发回；NmEvent 转发给订阅者。
 */
import { NM_HOST_NAME } from '@cborg/shared';
import type { McpToolName, NmEvent, NmMessage, NmRequest, NmResponse } from '@cborg/shared';
import { count, findDuplicates, getTree, list, search } from './bookmarks-repo';
import { cancelPlan, createPlan, executePlan, getPlan, rollback } from './plan-engine';
import type { PlanProposal } from './plan-engine';
import { emitInternalEvent } from './store';

export type NmEventHandler = (event: NmEvent) => void;

interface NmState {
  port: chrome.runtime.Port | null;
  connected: boolean;
  hostVersion?: string;
  lastError?: string;
}

interface PendingRequest {
  resolve: (response: NmResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const state: NmState = { port: null, connected: false };
const pending = new Map<string, PendingRequest>();
const eventHandlers = new Set<NmEventHandler>();
const REQUEST_TIMEOUT_MS = 15_000;

/** 当前 NM 连接状态（供 nm:status RPC 使用） */
export function getNmStatus(): { connected: boolean; hostVersion?: string; lastError?: string } {
  return { connected: state.connected, hostVersion: state.hostVersion, lastError: state.lastError };
}

function setConnected(connected: boolean, lastError?: string): void {
  state.connected = connected;
  if (lastError !== undefined) state.lastError = lastError;
  if (connected) state.lastError = undefined;
  emitInternalEvent({ type: 'nm:status', connected, hostVersion: state.hostVersion });
}

function onPortMessage(message: NmMessage): void {
  if (message.kind === 'response') {
    const waiter = pending.get(message.id);
    if (waiter) {
      clearTimeout(waiter.timer);
      pending.delete(message.id);
      waiter.resolve(message);
    }
    return;
  }
  if (message.kind === 'event') {
    if (message.event === 'host_ready') setConnected(true);
    if (message.event === 'host_shutdown') setConnected(false);
    for (const handler of [...eventHandlers]) handler(message);
    return;
  }
  handleIncomingMessage(message);
}

function onPortDisconnect(): void {
  const error = chrome.runtime.lastError?.message ?? 'Native messaging port disconnected';
  state.port = null;
  setConnected(false, error);
  for (const [, waiter] of pending) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error(error));
  }
  pending.clear();
}

/** 建立与 native host 的常驻连接并开始事件分发（幂等） */
export function startNmBridge(): void {
  if (state.port) return;
  let port: chrome.runtime.Port;
  try {
    port = chrome.runtime.connectNative(NM_HOST_NAME);
  } catch (error) {
    // host 未注册时 connectNative 可能直接抛错（某些浏览器行为），优雅降级
    setConnected(false, error instanceof Error ? error.message : String(error));
    return;
  }
  state.port = port;
  port.onMessage.addListener(onPortMessage);
  port.onDisconnect.addListener(onPortDisconnect);
  setConnected(true);
}

/** 断开与 native host 的连接（供 nm:reconnect 先断开再重连） */
export function stopNmBridge(): void {
  if (state.port) {
    state.port.disconnect();
    state.port = null;
  }
  state.connected = false;
}

/** 向 host 发送一次 tool 调用请求，返回对应的 NmResponse */
export async function sendNmRequest(
  tool: McpToolName,
  args: Readonly<Record<string, unknown>> | null,
): Promise<NmResponse> {
  const port = state.port;
  if (!port || !state.connected) throw new Error('Native messaging host is not connected.');
  const id = crypto.randomUUID();
  return new Promise<NmResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error('Native messaging request timed out.'));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    port.postMessage({ kind: 'request', id, tool, args });
  });
}

/** 订阅 host 推来的事件（host_ready / plan_updated 等），返回取消订阅函数 */
export function onNmEvent(handler: NmEventHandler): () => void {
  eventHandlers.add(handler);
  return () => {
    eventHandlers.delete(handler);
  };
}

/**
 * 处理 host 侧发来的单条消息。
 * - NmRequest：转成 plan-engine / bookmarks-repo 调用，结果包装为 NmResponse 发回
 * - NmResponse / NmEvent：由 onPortMessage 处理（这里忽略）
 */
export function handleIncomingMessage(message: NmMessage): void {
  if (message.kind !== 'request') return;
  dispatchNmRequest(message).catch((error) => {
    respond({
      kind: 'response',
      id: message.id,
      ok: false,
      error: { code: 'ERR_INTERNAL', message: error instanceof Error ? error.message : String(error) },
    });
  });
}

async function dispatchNmRequest(request: NmRequest): Promise<void> {
  const { tool, args } = request;
  let result: unknown;
  switch (tool) {
    case 'bookmark_get_tree':
      result = { trees: await getTree(args?.folderId as string | undefined, args?.depth as number | undefined) };
      break;
    case 'bookmark_list':
      result = { items: await list(args?.folderId as string) };
      break;
    case 'bookmark_search':
      result = { items: await search(args?.query as string, args?.limit as number | undefined) };
      break;
    case 'bookmark_count':
      result = { count: await count(args?.folderId as string | undefined) };
      break;
    case 'bookmark_find_duplicates':
      result = {
        groups: await findDuplicates(args?.folderId as string | undefined, args?.normalizeUrl as boolean | undefined),
      };
      break;
    case 'plan_propose': {
      const proposal = (args ?? {}) as PlanProposal;
      const plan = await createPlan({
        title: proposal.title,
        description: proposal.description,
        actions: proposal.actions,
      });
      result = { planId: plan.id, actions: plan.actions };
      break;
    }
    case 'plan_get':
      result = { plan: await getPlan(args?.planId as string) };
      break;
    case 'plan_cancel':
      result = await cancelPlan(args?.planId as string);
      break;
    case 'plan_execute':
      result = { report: await executePlan(args?.planId as string) };
      break;
    case 'plan_rollback':
      result = await rollback(args?.snapshotId as string);
      break;
    default: {
      const exhaustive: never = tool;
      throw new Error(`Unknown MCP tool: ${String(exhaustive)}`);
    }
  }
  respond({ kind: 'response', id: request.id, ok: true, result });
}

function respond(response: NmResponse): void {
  state.port?.postMessage(response);
}
