import type { Plan } from '@cborg/shared';
import Badge from './Badge';
import Button from './Button';

interface PlanCardProps {
  plan: Plan;
  onConfirm: (planId: string) => void;
  onReject: (planId: string) => void;
}

/**
 * 单 plan 卡片：显示 title / status / actions 数量，提供 Confirm / Reject 操作。
 * 阶段 1 为 stub。
 */
export default function PlanCard({ plan, onConfirm, onReject }: PlanCardProps) {
  // TODO phase2: 展开 actions 明细（diff 视图）、执行进度、错误详情
  return (
    <div className="flex items-center justify-between gap-3 p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
            {plan.title}
          </p>
          <Badge status={plan.status} />
        </div>
        <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
          {plan.actions.length} action{plan.actions.length === 1 ? '' : 's'} · {plan.createdBy}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="secondary" onClick={() => onConfirm(plan.id)}>
          Confirm
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onReject(plan.id)}>
          Reject
        </Button>
      </div>
    </div>
  );
}
