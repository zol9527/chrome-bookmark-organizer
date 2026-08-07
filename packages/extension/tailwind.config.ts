import type { Config } from 'tailwindcss';

/**
 * Tailwind 3.4 配置。
 * 设计 token 统一定义在 theme.extend.colors（浅色/深色两组），
 * 组件内通过 bg-primary-light dark:bg-primary-dark 等类名使用，禁止硬编码 hex。
 */
export default {
  content: ['./src/**/*.{html,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { light: '#2563eb', dark: '#60a5fa' },
        surface: { light: '#ffffff', dark: '#1e1e2e' },
        border: { light: '#e2e8f0', dark: '#3a3a4c' },
        success: { light: '#16a34a', dark: '#4ade80' },
        danger: { light: '#dc2626', dark: '#f87171' },
      },
    },
  },
  plugins: [],
} satisfies Config;
