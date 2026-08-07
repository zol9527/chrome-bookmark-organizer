import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'cli/index': 'src/cli/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  // 强制内联 workspace 包（其 exports 只有 TS 源，且 @cborg/shared 是 .ts 源文件，
  // 运行时不可被 Node 直接 require；内联后 CJS/ESM 产物均自包含）。
  noExternal: ['@cborg/shared'],
});
