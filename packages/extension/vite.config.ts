import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import manifest from './src/manifest';

/**
 * 阶段 1：Tailwind 3.4 无官方 Vite 插件，CSS 处理由 postcss.config.js 完成。
 * 此处提供占位插件满足装配要求；阶段 2 若升级 Tailwind 4 可替换为 @tailwindcss/vite。
 */
function tailwind(): Plugin {
  return { name: 'tailwind' };
}

export default defineConfig({
  // 相对路径 base：构建产物可直接在 chrome://extensions 以 unpacked 方式加载
  base: './',
  plugins: [
    // @crxjs/vite-plugin@2.0.0-beta.33 的 crx options 里 browser 仅接受
    // 'firefox' | 'chrome'（默认 chrome），且不存在 preRenderer 选项；
    // 故此处用 browser: 'chrome'，preRenderer 省略。
    crx({ manifest, browser: 'chrome' }),
    react(),
    tailwind(),
  ],
});
