import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/** 基础卡片容器 */
export default function Card({ children, className = '', ...rest }: CardProps) {
  return (
    <div
      className={`rounded-xl border border-border-light bg-surface-light shadow-sm shadow-slate-900/[0.03] dark:border-border-dark dark:bg-surface-dark dark:shadow-black/20 ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
