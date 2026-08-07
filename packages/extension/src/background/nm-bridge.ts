/**
 * Native Messaging 通信层：封装 chrome.runtime.connectNative(NM_HOST_NAME)。
 * 阶段 1 为 stub；阶段 2 实现 port 生命周期管理与 NmMessage 收发。
 */
import { NM_HOST_NAME } from '@cborg/shared';
import type { McpToolName, NmEvent, NmMessage, NmResponse } from '@cborg/shared';

export type NmEventHandler = (event: NmEvent) => void;

/** 建立与 native host 的常驻连接并开始事件分发 */
export function startNmBridge(): void {
  throw new Error(`TODO phase2: connect to native host "${NM_HOST_NAME}"`);
}

/** 向 host 发送一次 tool 调用请求，返回对应的 NmResponse */
export async function sendNmRequest(
  tool: McpToolName,
  args: Readonly<Record<string, unknown>> | null,
): Promise<NmResponse> {
  throw new Error('TODO phase2: send request over native messaging');
}

/** 订阅 host 推来的事件（host_ready / plan_updated 等），返回取消订阅函数 */
export function onNmEvent(handler: NmEventHandler): () => void {
  throw new Error('TODO phase2: subscribe to native messaging events');
}

/** 处理 host 侧发来的单条消息（request / event） */
export function handleIncomingMessage(message: NmMessage): void {
  throw new Error('TODO phase2: dispatch incoming native messaging message');
}
