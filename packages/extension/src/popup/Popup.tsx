import { useEffect, useState } from 'react';
import type { Plan } from '@cborg/shared';
import Button from './components/Button';
import Card from './components/Card';
import EmptyState from './components/EmptyState';
import PlanCard from './components/PlanCard';

/**
 * Popup 主界面（确认中心）：
 * 顶部标题 + NM host 状态条 + 待确认 plans 列表 + 底部快速操作。
 * 阶段 1 全部为 stub，阶段 2 接入 nm-client 的 RPC。
 */
export default function Popup() {
  const [nmConnected] = useState(false);
  const [plans] = useState<Plan[]>([]);

  useEffect(() => {
    // TODO phase2: getNmStatus() / listPlans() 拉取真实状态，并订阅 plan:updated 事件
  }, []);

  return (
    <div className="flex min-h-[420px] w-96 flex-col gap-3 bg-surface-light p-3 text-slate-900 dark:bg-surface-dark dark:text-slate-100">
      {/* 顶部标题 */}
      <header className="flex items-center justify-between">
        <h1 className="text-base font-semibold">Bookmark Organizer</h1>
      </header>

      {/* NM host 连接状态条 */}
      <div className="flex items-center gap-2 text-xs">
        <span
          className={
            nmConnected
              ? 'h-2 w-2 rounded-full bg-success-light dark:bg-success-dark'
              : 'h-2 w-2 rounded-full bg-danger-light dark:bg-danger-dark'
          }
        />
        <span className="text-slate-500 dark:text-slate-400">
          {nmConnected ? 'Native host connected' : 'Native host disconnected'}
        </span>
        {/* TODO phase2: 显示 host 版本 / 重连按钮 */}
      </div>

      {/* 待确认 plans */}
      <main className="flex-1">
        {plans.length === 0 ? (
          <Card>
            <EmptyState
              title="No pending plans"
              description="Plans proposed by the AI agent will appear here for your confirmation."
            />
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {plans.map((plan) => (
              <li key={plan.id}>
                <Card>
                  <PlanCard
                    plan={plan}
                    onConfirm={(planId) => {
                      // TODO phase2: confirmPlan(planId)
                      void planId;
                    }}
                    onReject={(planId) => {
                      // TODO phase2: rejectPlan(planId)
                      void planId;
                    }}
                  />
                </Card>
              </li>
            ))}
          </ul>
        )}
      </main>

      {/* 底部快速操作 */}
      <footer className="border-t border-border-light pt-3 dark:border-border-dark">
        <Button
          className="w-full"
          onClick={() => {
            // TODO phase2: 触发一键迁移（legacy-migrator 来源 plan）
            console.info('[cborg] one-click migrate (stub)');
          }}
        >
          Run One-Click Migration
        </Button>
      </footer>
    </div>
  );
}
