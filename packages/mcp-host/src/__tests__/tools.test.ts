import { afterEach, describe, expect, it } from 'vitest';
import type { McpToolArgs, McpToolName, McpToolResult } from '@cborg/shared';
import { invokeTool, makeToolCallback, TOOL_REGISTRY } from '../mcp/tools.js';
import { clearExtensionTransport, setExtensionTransport } from '../native/bridge.js';
import { createMockTransport } from '../native/mock-transport.js';
import type { MockHandler } from '../native/mock-transport.js';

/** 每个 tool 的合法参数样例（与 tools-schema.test 一致，独立文件内重复声明避免共享文件）。 */
const VALID_ARGS: { [T in McpToolName]: McpToolArgs[T] } = {
  bookmark_get_tree: { folderId: '1', depth: 2 },
  bookmark_list: { folderId: '1' },
  bookmark_search: { query: 'react', limit: 10 },
  bookmark_count: {},
  bookmark_find_duplicates: { folderId: '1', normalizeUrl: true },
  plan_propose: {
    title: 'organize dev links',
    description: 'demo plan',
    actions: [{ op: 'move', target: { id: '1', newParentId: '2' }, rationale: 'categorize' }],
  },
  plan_get: { planId: 'p1' },
  plan_cancel: { planId: 'p1' },
  plan_execute: { planId: 'p1' },
  plan_rollback: { snapshotId: 's1' },
};

/** 每个 tool 的 canned happy-path 结果（严格按 McpToolResult 契约形状）。 */
const MOCK_RESULTS: { [T in McpToolName]: McpToolResult[T] } = {
  bookmark_get_tree: { trees: [{ id: '1', title: 'root' }] },
  bookmark_list: { items: [{ id: '1', title: 'a' }] },
  bookmark_search: { items: [{ id: '2', title: 'b' }] },
  bookmark_count: { count: 42 },
  bookmark_find_duplicates: { groups: [{ url: 'https://x', nodes: [] }] },
  plan_propose: {
    planId: 'mock-plan-1',
    actions: [{ id: 'a1', op: 'move', target: { id: '1', newParentId: '2' }, rationale: 'r' }],
  },
  plan_get: { plan: null },
  plan_cancel: { planId: 'p1', cancelled: true },
  plan_execute: { report: { startedAt: 1, finishedAt: 2, applied: ['a1'], rejected: [], success: true } },
  plan_rollback: { restored: true, snapshotId: 's1' },
};

/** 动态 key 构造 overrides 时 TS 无法保留逐 tool 类型，这里收敛为一个受控 cast。 */
function mockFor<T extends McpToolName>(
  tool: T,
  handler: MockHandler<T>,
): Partial<{ [N in McpToolName]: MockHandler<N> }> {
  return { [tool]: handler } as unknown as Partial<{ [N in McpToolName]: MockHandler<N> }>;
}

/** 对单个 tool 跑 happy path + error path（逐 tool 泛型推导，全类型安全）。 */
function testTool<T extends McpToolName>(name: T, validArgs: McpToolArgs[T]): void {
  describe(`tool ${name}`, () => {
    afterEach(() => clearExtensionTransport());

    it('happy path: forwards args to the transport and returns its typed result', async () => {
      const seen: McpToolArgs[T][] = [];
      setExtensionTransport(
        createMockTransport(
          mockFor(name, (args) => {
            seen.push(args);
            return MOCK_RESULTS[name];
          }),
        ),
      );
      const result = await invokeTool(name, validArgs);
      expect(result).toEqual(MOCK_RESULTS[name]);
      expect(seen).toEqual([validArgs]);
    });

    it('error path: transport errors propagate through invokeTool', async () => {
      setExtensionTransport(createMockTransport(mockFor(name, () => {
        throw new Error(`boom-${name}`);
      })));
      await expect(invokeTool(name, validArgs)).rejects.toThrow(`boom-${name}`);
    });

    it('error path: registered callback converts errors to an isError result', async () => {
      setExtensionTransport(createMockTransport(mockFor(name, () => {
        throw new Error(`boom-${name}`);
      })));
      const cb = makeToolCallback(TOOL_REGISTRY[name]);
      const result = await cb(validArgs);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain(`boom-${name}`);
    });
  });
}

testTool('bookmark_get_tree', VALID_ARGS.bookmark_get_tree);
testTool('bookmark_list', VALID_ARGS.bookmark_list);
testTool('bookmark_search', VALID_ARGS.bookmark_search);
testTool('bookmark_count', VALID_ARGS.bookmark_count);
testTool('bookmark_find_duplicates', VALID_ARGS.bookmark_find_duplicates);
testTool('plan_propose', VALID_ARGS.plan_propose);
testTool('plan_get', VALID_ARGS.plan_get);
testTool('plan_cancel', VALID_ARGS.plan_cancel);
testTool('plan_execute', VALID_ARGS.plan_execute);
testTool('plan_rollback', VALID_ARGS.plan_rollback);
