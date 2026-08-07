# Chrome Bookmark Organizer

A Manifest V3 Chrome extension that exposes bookmark CRUD and a plan engine as an
**MCP server**, so external AI clients (Claude Desktop / Cursor / opencode / Cline)
can inspect and propose bookmark reorganizations. Write operations are gated by a
**plan-then-confirm** flow: the AI proposes, the user approves via the extension
popup, only then does anything actually move.

## Status

Pre-alpha. Scaffolded, integration in progress. See `docs/`.

## Architecture

Three-process topology:

```
AI client ──stdio MCP──▶ @cborg/mcp-host (Node) ──Native Messaging──▶ @cborg/extension (SW) ──▶ chrome.bookmarks
```

- `packages/shared` — protocol and type contracts (single source of truth)
- `packages/extension` — Chrome MV3 extension (popup confirmation center + plan engine)
- `packages/mcp-host` — Node MCP server + Native Messaging host + register/doctor CLI

Write operations (`move` / `rename` / `merge` / `delete`) are **not** exposed as raw
tools. The only write path is `plan_execute`, which triggers a confirmation UI in
the extension popup. See `docs/security.md` (planned).

## Develop

Requirements: Node ≥ 20, pnpm ≥ 10.

```bash
pnpm install
pnpm dev          # extension HMR + mcp-host watch (parallel)
pnpm typecheck    # all workspaces
pnpm build        # all workspaces
pnpm test         # all workspaces
```

Load the extension: `chrome://extensions` → Developer mode → Load unpacked →
`packages/extension/dist/`.

Register the Native Messaging host:

```bash
pnpm --filter @cborg/mcp-host exec cborg-mcp-host register
```

## Legacy

The original zero-dependency MV3 extension (single-file hard-coded folder map) is
preserved at `docs/legacy/background.js` for reference. Its plan/execute/repair
logic is being migrated to `packages/extension/src/background/plan-engine.ts`.

## License

MIT.
