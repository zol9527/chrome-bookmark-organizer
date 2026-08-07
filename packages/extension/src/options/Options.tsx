import { useState } from 'react';

type TabId = 'folder-map' | 'native-host' | 'about';

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'folder-map', label: 'Folder Map' },
  { id: 'native-host', label: 'Native Host' },
  { id: 'about', label: 'About' },
];

/**
 * Options 配置页：左侧 tab（目录映射 / Native Host / 关于）+ 右侧内容区。
 * 阶段 1 tab 内容全为 stub，阶段 2 接入存储读写。
 */
export default function Options() {
  const [activeTab, setActiveTab] = useState<TabId>('folder-map');

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl gap-6 p-6 text-slate-900 dark:text-slate-100">
      <nav className="flex w-48 shrink-0 flex-col gap-1" aria-label="Settings sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            className={
              activeTab === tab.id
                ? 'rounded-md bg-primary-light px-3 py-2 text-left text-sm font-medium text-white dark:bg-primary-dark dark:text-slate-900'
                : 'rounded-md px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="flex-1 rounded-lg border border-border-light bg-surface-light p-6 shadow-sm dark:border-border-dark dark:bg-surface-dark">
        {activeTab === 'folder-map' && (
          <section>
            <h2 className="text-base font-semibold">Folder Map</h2>
            {/* TODO phase2: 编辑 DEFAULT_FOLDER_MAP / DEFAULT_TOP_LEVEL_FOLDERS 映射表 */}
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Map source folder names to target top-level folders. (TODO phase2)
            </p>
          </section>
        )}
        {activeTab === 'native-host' && (
          <section>
            <h2 className="text-base font-semibold">Native Host</h2>
            {/* TODO phase2: 展示 host 连接状态、版本、重连按钮 */}
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Native messaging host status and diagnostics. (TODO phase2)
            </p>
          </section>
        )}
        {activeTab === 'about' && (
          <section>
            <h2 className="text-base font-semibold">About</h2>
            {/* TODO phase2: 版本号、文档链接、导出 / 导入配置 */}
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Chrome Bookmark Organizer v0.1.0 — plan-then-confirm bookmark workflow.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
