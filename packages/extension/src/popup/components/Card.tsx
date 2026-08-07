import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/** 基础卡片容器 */
export default function Card({ children, className = '', ...rest }: CardProps) {
  return (
    <div
      className={`rounded-lg border border-border-light bg-surface-light shadow-sm dark:border-border-dark dark:bg-surface-dark ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
