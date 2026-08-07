interface EmptyStateProps {
  title: string;
  description: string;
}

/** 空状态占位 */
export default function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{title}</p>
      <p className="max-w-60 text-xs leading-relaxed text-slate-400 dark:text-slate-500">
        {description}
      </p>
    </div>
  );
}
