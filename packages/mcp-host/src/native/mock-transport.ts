import type { McpToolArgs, McpToolName, McpToolResult, PlanAction } from '@cborg/shared';
import type { ExtensionTransport } from './bridge.js';

/**
 * 单个 tool 的 mock handler：入参出参均严格绑定 @cborg/shared 契约。
 */
export type MockHandler<T extends McpToolName> = (
  args: McpToolArgs[T],
) => McpToolResult[T] | Promise<McpToolResult[T]>;

/**
 * 默认 canned 结果：让 createMockTransport() 无参创建时也能对任意 tool 返回
 * 契约合法的结果（serve --mock 演示 / e2e 用）。
 */
const defaultHandlers: { [T in McpToolName]: MockHandler<T> } = {
  bookmark_get_tree: () => ({ trees: [] }),
  bookmark_list: () => ({ items: [] }),
  bookmark_search: () => ({ items: [] }),
  bookmark_count: () => ({ count: 0 }),
  bookmark_find_duplicates: () => ({ groups: [] }),
  plan_propose: (args) => ({
    planId: 'mock-plan-1',
    actions: args.actions.map((a, i): PlanAction => ({ ...a, id: `mock-action-${i}` })),
  }),
  plan_get: () => ({ plan: null }),
  plan_cancel: (args) => ({ planId: args.planId, cancelled: true }),
  plan_execute: () => ({
    report: { startedAt: 0, finishedAt: 0, applied: [], rejected: [], success: false },
  }),
  plan_rollback: (args) => ({ restored: true, snapshotId: args.snapshotId }),
};

/**
 * 创建 in-memory mock transport（测试 / serve --mock 演示用，不接真实扩展）。
 *
 * @param overrides 按 tool 覆盖默认 handler；handler 抛错时错误会原样
 * 沿 dispatchToExtension 向上传播（错误路径测试依赖这一点）。
 */
export function createMockTransport(
  overrides?: Partial<{ [T in McpToolName]: MockHandler<T> }>,
): ExtensionTransport {
  return {
    async call<T extends McpToolName>(tool: T, args: McpToolArgs[T]): Promise<McpToolResult[T]> {
      // 先查 override，回退默认 handler（defaultHandlers 覆盖全部 10 个 tool，恒有 handler）。
      // 不用对象 spread 合并：spread 会让 TS 对泛型索引退化为交叉类型，丢失逐 tool 关联。
      const handler = overrides?.[tool] ?? defaultHandlers[tool];
      return handler(args);
    },
    async close(): Promise<void> {
      // in-memory：无需清理
    },
  };
}
