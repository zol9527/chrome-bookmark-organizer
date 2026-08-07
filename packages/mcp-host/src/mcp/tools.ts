import { z } from 'zod';
import type { McpToolArgs, McpToolName, McpToolResult } from '@cborg/shared';
import { MCP_TOOLS } from '@cborg/shared';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { dispatchToExtension } from '../native/bridge.js';

/**
 * 单个 MCP tool 的定义。
 * schema 显式标注为共享契约类型（McpToolArgs[T]），保证 zod 校验输出与
 * @cborg/shared 的跨边界类型严格一致（编译期验证）。
 */
type ToolDef<T extends McpToolName> = {
  name: T;
  description: string;
  schema: z.ZodType<McpToolArgs[T]>;
  handler: (args: McpToolArgs[T]) => Promise<McpToolResult[T]>;
};

/**
 * plan_propose 的 actions 元素（与 McpToolArgs['plan_propose'] 的 actions 项同构）。
 */
const planActionSchema: z.ZodType<McpToolArgs['plan_propose']['actions'][number]> = z.object({
  op: z.enum(['move', 'create_folder', 'rename', 'merge', 'delete']),
  target: z.object({
    id: z.string().optional(),
    newParentId: z.string().optional(),
    newIndex: z.number().int().optional(),
    newTitle: z.string().optional(),
    url: z.string().optional(),
  }),
  rationale: z.string().min(1),
});

/**
 * 10 个 MCP tool 的注册表。
 *
 * 安全原则（写进每个 tool 的 description）：
 * - 所有读工具强调 read-only，绝不修改书签；
 * - 所有写操作收敛为 plan 系列，且 plan_execute 必须经扩展 popup 人工确认才落地；
 * - description 中绝不包含书签 title/url 等动态内容（防 prompt injection）。
 */
const TOOLS: { [T in McpToolName]: ToolDef<T> } = {
  bookmark_get_tree: {
    name: 'bookmark_get_tree',
    description:
      'Read-only: returns the bookmark tree, optionally rooted at a folder with a depth limit. Never modifies bookmarks.',
    schema: z.object({
      folderId: z.string().optional(),
      depth: z.number().int().min(0).optional(),
    }),
    handler: (args) => dispatchToExtension('bookmark_get_tree', args),
  },
  bookmark_list: {
    name: 'bookmark_list',
    description: 'Read-only: lists bookmark nodes inside a given folder. Never modifies bookmarks.',
    schema: z.object({
      folderId: z.string(),
    }),
    handler: (args) => dispatchToExtension('bookmark_list', args),
  },
  bookmark_search: {
    name: 'bookmark_search',
    description:
      'Read-only: full-text search across bookmark titles and URLs. Never modifies bookmarks.',
    schema: z.object({
      query: z.string().min(1),
      limit: z.number().int().min(1).optional(),
    }),
    handler: (args) => dispatchToExtension('bookmark_search', args),
  },
  bookmark_count: {
    name: 'bookmark_count',
    description:
      'Read-only: counts bookmarks, optionally scoped to a folder. Never modifies bookmarks.',
    schema: z.object({
      folderId: z.string().optional(),
    }),
    handler: (args) => dispatchToExtension('bookmark_count', args),
  },
  bookmark_find_duplicates: {
    name: 'bookmark_find_duplicates',
    description:
      'Read-only: detects duplicate bookmarks by URL. Returns groups for review; never moves or deletes anything.',
    schema: z.object({
      folderId: z.string().optional(),
      normalizeUrl: z.boolean().optional(),
    }),
    handler: (args) => dispatchToExtension('bookmark_find_duplicates', args),
  },
  plan_propose: {
    name: 'plan_propose',
    description:
      'Proposes a plan of bookmark changes (move/create_folder/rename/merge/delete). Nothing is applied: the plan waits for explicit user approval before any change can take effect.',
    schema: z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      actions: z.array(planActionSchema).min(1),
    }),
    handler: (args) => dispatchToExtension('plan_propose', args),
  },
  plan_get: {
    name: 'plan_get',
    description:
      'Read-only: returns a previously proposed plan by id, including its status. Does not change bookmarks.',
    schema: z.object({
      planId: z.string(),
    }),
    handler: (args) => dispatchToExtension('plan_get', args),
  },
  plan_cancel: {
    name: 'plan_cancel',
    description:
      'Cancels a pending plan. Affects only plan state — it never modifies bookmarks.',
    schema: z.object({
      planId: z.string(),
    }),
    handler: (args) => dispatchToExtension('plan_cancel', args),
  },
  plan_execute: {
    name: 'plan_execute',
    description:
      'Triggers a confirmation UI in the extension popup; user must approve before any change is applied. No bookmark change happens unless the user confirms.',
    schema: z.object({
      planId: z.string(),
    }),
    handler: (args) => dispatchToExtension('plan_execute', args),
  },
  plan_rollback: {
    name: 'plan_rollback',
    description:
      'Restores a bookmark snapshot taken by a prior execution. Reverts recent changes; only valid with an explicit snapshot id.',
    schema: z.object({
      snapshotId: z.string(),
    }),
    handler: (args) => dispatchToExtension('plan_rollback', args),
  },
};

/** 运行时双保险：TOOLS 键集合必须与 shared 契约的 MCP_TOOLS 完全一致（防止契约漂移）。 */
function assertToolRegistryComplete(): void {
  for (const name of MCP_TOOLS) {
    if (!(name in TOOLS)) {
      throw new Error(`tool registry drift: missing tool definition for '${name}'`);
    }
  }
}

/**
 * 把全部 tool 注册到 MCP server。
 * 每个 tool 独立注册（保留逐 tool 的类型关联）；handler 将校验后的参数
 * 转发到 dispatchToExtension，并把结果包装为 MCP text content。
 */
export function registerTools(server: McpServer): void {
  assertToolRegistryComplete();
  const register = <T extends McpToolName>(def: ToolDef<T>): void => {
    server.registerTool(
      def.name,
      {
        title: def.name,
        description: def.description,
        inputSchema: def.schema,
      },
      async (args) => {
        const result = await def.handler(args);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      },
    );
  };
  register(TOOLS.bookmark_get_tree);
  register(TOOLS.bookmark_list);
  register(TOOLS.bookmark_search);
  register(TOOLS.bookmark_count);
  register(TOOLS.bookmark_find_duplicates);
  register(TOOLS.plan_propose);
  register(TOOLS.plan_get);
  register(TOOLS.plan_cancel);
  register(TOOLS.plan_execute);
  register(TOOLS.plan_rollback);
}
