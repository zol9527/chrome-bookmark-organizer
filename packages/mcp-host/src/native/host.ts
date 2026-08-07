import type { McpToolArgs, McpToolName, NmMessage, NmRequest, NmResponse } from '@cborg/shared';
import { readMessage, writeMessage } from './messaging.js';
import { dispatchToExtension } from './bridge.js';

/**
 * NM host 模式入口：由 chrome.runtime.connectNative(NM_HOST_NAME) 启动
 * （register 子命令写入的 manifest path 指向本二进制）。
 *
 * phase 2（本阶段）：不直接与 SW 通信。收到 NmRequest 后转发给当前注入的
 * transport（mock-transport.ts 或 serve --mock 注入的实例）；若未注入 transport，
 * dispatchToExtension 抛 "No extension transport configured"，这里捕获后回一个
 * 错误 NmResponse——保证 NM 协议循环始终有应答、不悬挂。
 *
 * phase 3（三进程方案 B，详见 messaging.ts 头部注释）：
 * - 本进程被 Chrome 拉起，经 NM 与扩展 SW 双向通信（SW 端由 fixer-A 实现）；
 * - 同时作为 localhost HTTP client，连接主 MCP server 进程的 HTTP 端点，
 *   把 tool 调用投递过去；MCP server 的应答再经 NM 帧写回 SW。
 * - 主进程侧会 spawn 本二进制的另一个实例（host 子命令）作为桥。
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
      // 本阶段忽略 SW 发来的 event（phase 3 再处理状态广播）
      continue;
    }
    await writeMessage(await handleRequest(msg));
  }
}

/**
 * 把一条 NmRequest 转换为 dispatchToExtension 调用，再包装为 NmResponse。
 * phase 3：req.args 应先用对应 tool 的 zod schema 校验（见 mcp/tools.ts），
 * 拒绝非法参数时回校验错误；本阶段直接透传（mock 场景参数本就合法）。
 */
async function handleRequest(req: NmRequest): Promise<NmResponse> {
  try {
    const result = await dispatchToExtension(req.tool, req.args as McpToolArgs[McpToolName]);
    return { kind: 'response', id: req.id, ok: true, result };
  } catch (err) {
    return {
      kind: 'response',
      id: req.id,
      ok: false,
      error: {
        code: 'NM_DISPATCH_ERROR',
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
