import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'Chrome Bookmark Organizer',
  version: '0.1.0',
  description:
    'Plan-then-confirm bookmark organizer: dedupe, rename and restructure bookmarks with human confirmation before any write.',
  permissions: ['bookmarks', 'nativeMessaging', 'storage'],
  // stdio 拓扑不需要 host_permissions
  host_permissions: [],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  action: {
    default_popup: 'src/popup/popup.html',
    default_title: 'Bookmark Organizer',
  },
  options_ui: {
    page: 'src/options/options.html',
    open_in_tab: true,
  },
  // 阶段 2 补充正式图标，例如：
  // icons: { 16: 'src/assets/icon-16.png', 32: 'src/assets/icon-32.png', 48: 'src/assets/icon-48.png', 128: 'src/assets/icon-128.png' }
  icons: {},
});
