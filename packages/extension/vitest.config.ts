import { defineConfig } from 'vitest/config';

// 独立于 vite.config.ts：不加载 crx / react 插件，仅用于单元测试。
export default defineConfig({
  test: {
    environment: 'node',
  },
});
