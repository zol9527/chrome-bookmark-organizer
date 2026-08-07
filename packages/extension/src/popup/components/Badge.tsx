import type { PlanStatus } from '@cborg/shared';

const statusStyles: Record<PlanStatus, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200',
  approved: 'bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200',
  rejected: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  executing: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/60 dark:text-green-200',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200',
  rolled_back: 'bg-orange-100 text-orange-800 dark:bg-orange-900/60 dark:text-orange-200',
};

/** 状态徽章（pending / approved / executing / completed 等） */
export default function Badge({ status }: { status: PlanStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${statusStyles[status]}`}
    >
      {status}
    </span>
  );
}
