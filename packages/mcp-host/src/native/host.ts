import type { NmMessage, NmRequest, NmResponse } from '@cborg/shared';
import { readMessage, writeMessage } from './messaging.js';

/**
 * NM host 主循环：由 chrome.runtime.connectNative(NM_HOST_NAME) 启动（register 子命令
 * 写入的 manifest path 指向本二进制）。
 *
 * phase 2：收到 NmRequest 后经 bridge 转发给扩展 SW 并回 NmResponse。
 * 脚手架阶段：echo 实现——每条 request 回一个 ok response（读啥回啥）。
 *
 * ⚠️ 本进程的 stdout 专用于 NM 协议，禁止 console.log（见 messaging.ts）。
 */
export async function runNmHost(): Promise<void> {
  for (;;) {
    let msg: NmMessage;
    try {
      msg = await readMessage();
    } catch {
      // EOF（Chrome 关闭端口）或协议错误：安静退出
      return;
    }
    if (msg.kind !== 'request') {
      // 脚手架阶段忽略 SW 发来的 event（phase 2 再处理状态广播）
      continue;
    }
    await writeMessage(handleRequest(msg));
  }
}

function handleRequest(req: NmRequest): NmResponse {
  // phase 2: dispatchToExtension(req.tool, req.args) + NmResponse 配对
  return {
    kind: 'response',
    id: req.id,
    ok: true,
    result: { echo: true, tool: req.tool, stub: 'phase2: real dispatch to extension service worker' },
  };
}
