/**
 * Native messaging host 名（必须与 host manifest 中 name 字段一致；allowed_origins 绑定扩展 ID）。
 * 反向域名格式是 Chrome NM 的约定。
 */
export const NM_HOST_NAME = 'com.loyd.chrome_bookmark_organizer';

/**
 * MCP server 元信息（响应 initialize 请求用）。
 */
export const MCP_SERVER_INFO = {
  name: 'chrome-bookmark-organizer',
  version: '0.1.0',
} as const;

/**
 * chrome.storage 区域名。
 * - PLANS：pending plan 列表（local，跨浏览器重启保留）
 * - SNAPSHOTS：执行前快照（session，浏览器关即清，避免无限增长）
 * - OPTIONS：用户配置（映射表、host 状态等）
 */
export const STORAGE_AREAS = {
  PLANS: 'plans',
  SNAPSHOTS: 'snapshots',
  OPTIONS: 'options',
} as const;

/**
 * 默认的目录映射表（迁移自原 background.js 的 TOP_LEVEL_MAP）。
 * 用户可在 options 页编辑；这里保留作为 fallback。
 */
export const DEFAULT_FOLDER_MAP: Readonly<Record<string, string>> = {
  收藏夹: '01_Favorites',
  收藏: '01_Favorites',
  置顶: '01_Favorites',
  工作: '10_Work_Projects',
  学习: '20_Development_Engineering',
  开发: '20_Development_Engineering',
  编程: '20_Development_Engineering',
  工具: '30_Tooling',
  效率: '30_Tooling',
  阅读: '40_Reading',
  文章: '40_Reading',
  影音: '50_Media',
  视频: '50_Media',
  社交: '60_Social',
  购物: '70_Shopping',
  其他: '90_Inbox',
  未分类: '90_Inbox',
};

/**
 * 标准顶层目录名（与原项目命名约定一致）。
 */
export const DEFAULT_TOP_LEVEL_FOLDERS = [
  '00_Inbox',
  '01_Favorites',
  '10_Work_Projects',
  '20_Development_Engineering',
  '30_Tooling',
  '40_Reading',
  '50_Media',
  '60_Social',
  '70_Shopping',
  '90_Inbox',
] as const;
