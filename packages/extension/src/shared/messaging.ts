/**
 * 扩展内部消息协议（popup / options ↔ service worker）。
 * 注意：与 @cborg/shared 的 NmMessage（SW ↔ native host）是不同层，勿混淆。
 */
import type { Plan } from '@cborg/shared';

/** popup / options → SW 的请求（RPC 风格，经 chrome.runtime.sendMessage 发送） */
export type InternalRequest =
  | { type: 'nm:status' }
  | { type: 'plan:list' }
  | { type: 'plan:confirm'; planId: string }
  | { type: 'plan:reject'; planId: string }
  | { type: 'plan:execute'; planId: string }
  | { type: 'migrate:run-oneclick' };

/** SW → popup / options 的响应信封 */
export type InternalResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

/** SW → UI 的主动事件（阶段 2：plan 状态变化、NM 连接状态） */
export type InternalEvent =
  | { type: 'plan:updated'; plan: Plan }
  | { type: 'nm:status'; connected: boolean };
