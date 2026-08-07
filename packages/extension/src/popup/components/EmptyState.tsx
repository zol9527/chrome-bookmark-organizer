interface EmptyStateProps {
  title: string;
  description: string;
}

/** 空状态占位 */
export default function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-blue-50 text-primary-light shadow-inner shadow-blue-100 dark:bg-slate-800 dark:text-primary-dark dark:shadow-none">
        <svg viewBox="0 0 48 48" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M9 15.5A4.5 4.5 0 0 1 13.5 11H23l3.6 4H34.5a4.5 4.5 0 0 1 4.5 4.5v13A4.5 4.5 0 0 1 34.5 37h-21A4.5 4.5 0 0 1 9 32.5v-17Z" /><path d="m20 28 3 3 6-7" /></svg>
      </div>
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      <p className="max-w-64 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        {description}
      </p>
    </div>
  );
}
