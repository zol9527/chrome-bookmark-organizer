import { useState } from 'react';
import type { Plan, PlanAction } from '@cborg/shared';
import Badge from './Badge';
import Button from './Button';
import Icon, { type IconName } from './Icon';

interface PlanCardProps { plan: Plan; onConfirm: (planId: string) => Promise<void>; onReject: (planId: string) => Promise<void>; busy?: boolean; }

const OP_ICON: Record<PlanAction['op'], IconName> = { move: 'move', create_folder: 'folder', rename: 'edit', merge: 'merge', delete: 'trash' };
const OP_LABEL: Record<PlanAction['op'], string> = { move: 'Move', create_folder: 'Create folder', rename: 'Rename', merge: 'Merge', delete: 'Delete' };
const formatDate = (timestamp: number) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(timestamp);

function ActionRow({ action }: { action: PlanAction }) {
  const target = action.target.newTitle ?? action.target.newParentId ?? action.target.id ?? 'Bookmark';
  return <li className="flex gap-2.5 border-l border-border-light py-2 pl-3 last:pb-0 dark:border-border-dark"><span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300"><Icon name={OP_ICON[action.op]} className="h-3 w-3" /></span><div className="min-w-0"><p className="text-xs font-medium text-slate-700 dark:text-slate-200">{OP_LABEL[action.op]} <span className="font-normal text-slate-400">→</span> <span className="break-all">{target}</span></p><p className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">{action.rationale}</p></div></li>;
}

export default function PlanCard({ plan, onConfirm, onReject, busy = false }: PlanCardProps) {
  const [expanded, setExpanded] = useState(false);
  return <article className="overflow-hidden"><div className="p-3.5"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{plan.title}</p><Badge status={plan.status} /></div><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{plan.actions.length} changes · {plan.createdBy === 'ai' ? 'AI proposal' : plan.createdBy} · {formatDate(plan.createdAt)}</p></div><button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-label={`${expanded ? 'Hide' : 'Show'} changes for ${plan.title}`} className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-light dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white dark:focus-visible:ring-primary-dark"><Icon name="chevron" className={`h-4 w-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} /></button></div>{plan.description ? <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{plan.description}</p> : null}<div className={`grid transition-[grid-template-rows,opacity] duration-300 ${expanded ? 'mt-3 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}><div className="overflow-hidden"><ul className="max-h-40 overflow-y-auto pr-1">{plan.actions.map((action) => <ActionRow key={action.id} action={action} />)}</ul></div></div><div className="mt-3 flex items-center justify-between gap-2 border-t border-border-light pt-3 dark:border-border-dark"><span className="text-[11px] font-medium text-slate-400">Review before applying</span><div className="flex gap-2"><Button size="sm" variant="ghost" disabled={busy} onClick={() => void onReject(plan.id)} aria-label={`Reject ${plan.title}`}><Icon name="close" className="h-3.5 w-3.5" /> Reject</Button><Button size="sm" disabled={busy} onClick={() => void onConfirm(plan.id)} aria-label={`Confirm ${plan.title}`}>{busy ? 'Applying…' : <><Icon name="check" className="h-3.5 w-3.5" /> Confirm</>}</Button></div></div></div></article>;
}
