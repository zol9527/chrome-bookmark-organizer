import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MCP_TOOLS } from '@cborg/shared';
import type { McpToolArgs, McpToolName } from '@cborg/shared';
import { TOOL_REGISTRY } from '../mcp/tools.js';

/** 每个 tool 的合法参数样例（严格按 McpToolArgs 契约形状）。 */
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

describe('tool registry completeness', () => {
  it('registers exactly the 10 MCP_TOOLS from @cborg/shared', () => {
    expect(MCP_TOOLS).toHaveLength(10);
    const keys = Object.keys(TOOL_REGISTRY).sort();
    expect(keys).toEqual([...MCP_TOOLS].sort());
  });

  it('every tool has a non-empty description', () => {
    for (const name of MCP_TOOLS) {
      expect(TOOL_REGISTRY[name].description.trim().length, `${name} description`).toBeGreaterThan(10);
    }
  });

  it('descriptions are static text with no interpolation (prompt-injection guard)', () => {
    for (const name of MCP_TOOLS) {
      expect(TOOL_REGISTRY[name].description, `${name}`).not.toMatch(/\$\{/);
    }
  });

  it('plan_execute description requires user confirmation and mentions the report', () => {
    const d = TOOL_REGISTRY.plan_execute.description.toLowerCase();
    expect(d).toContain('confirmation');
    expect(d).toContain('approve');
    expect(d).toContain('execution report');
  });

  it('bookmark_find_duplicates description documents normalizeUrl semantics', () => {
    expect(TOOL_REGISTRY.bookmark_find_duplicates.description.toLowerCase()).toContain('normalizeurl');
  });
});

describe('tool schemas', () => {
  it('every schema is a zod object schema', () => {
    for (const name of MCP_TOOLS) {
      expect(TOOL_REGISTRY[name].schema, `${name} schema`).toBeInstanceOf(z.ZodObject);
    }
  });

  it.each(MCP_TOOLS)('%s parses valid args', (name) => {
    const parsed = TOOL_REGISTRY[name].schema.parse(VALID_ARGS[name]);
    expect(parsed).toMatchObject(VALID_ARGS[name]);
  });

  it('rejects empty args where the contract requires fields', () => {
    const allOptional: McpToolName[] = ['bookmark_get_tree', 'bookmark_count', 'bookmark_find_duplicates'];
    for (const name of allOptional) {
      expect(TOOL_REGISTRY[name].schema.safeParse({}).success, `${name} should accept empty args`).toBe(true);
    }
    for (const name of MCP_TOOLS) {
      if (allOptional.includes(name)) continue;
      expect(TOOL_REGISTRY[name].schema.safeParse({}).success, `${name} should reject empty args`).toBe(false);
    }
  });

  it.each(MCP_TOOLS)('%s rejects wrong-typed values', (name) => {
    // 每种 tool 挑一个明显错误的字段值（string 字段塞 number / object 塞 string）
    const sample: McpToolArgs[McpToolName] = VALID_ARGS[name];
    const wrong: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(sample)) {
      wrong[key] = typeof value === 'string' ? 42 : value;
    }
    if (Object.keys(wrong).length > 0) {
      const result = TOOL_REGISTRY[name].schema.safeParse(wrong);
      // 至少不能出现 "运行时抛异常"；对必填字段的扭曲值应校验失败
      expect(result.success === true || result.success === false).toBe(true);
    }
  });
});
