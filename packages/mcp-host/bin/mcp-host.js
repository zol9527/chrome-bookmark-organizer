#!/usr/bin/env node
import('../dist/cli/index.js').catch((e) => {
  console.error('cborg-mcp-host: dist build not found — run `pnpm --filter @cborg/mcp-host build` first.');
  console.error(String(e));
  process.exit(1);
});
