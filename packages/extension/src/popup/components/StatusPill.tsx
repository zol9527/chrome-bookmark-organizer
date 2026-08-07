import type { NmStatus } from '../hooks/useNmStatus';

export default function StatusPill({ status, loading = false }: { status: NmStatus | null; loading?: boolean }) {
  const connected = status?.connected;
  return <span title={status?.lastError} className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold ${connected ? 'border-green-200 bg-green-50 text-success-light dark:border-green-900/70 dark:bg-green-950/40 dark:text-success-dark' : 'border-red-200 bg-red-50 text-danger-light dark:border-red-900/70 dark:bg-red-950/40 dark:text-danger-dark'}`}>
    <i className={`h-1.5 w-1.5 rounded-full ${loading ? 'animate-pulse bg-slate-400' : connected ? 'animate-pulse bg-success-light dark:bg-success-dark' : 'bg-danger-light dark:bg-danger-dark'}`} />
    {loading ? 'Checking' : connected ? 'Host online' : 'Host offline'}
  </span>;
}
