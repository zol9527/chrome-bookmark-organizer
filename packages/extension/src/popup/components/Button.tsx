import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-primary-light text-white hover:opacity-90 dark:bg-primary-dark dark:text-slate-900',
  secondary:
    'border border-border-light bg-surface-light text-slate-700 hover:bg-slate-50 dark:border-border-dark dark:bg-surface-dark dark:text-slate-200 dark:hover:bg-slate-800',
  danger: 'bg-danger-light text-white hover:opacity-90 dark:bg-danger-dark dark:text-slate-900',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
};

const sizeClasses: Record<Size, string> = {
  sm: 'rounded-md px-2.5 py-1 text-xs',
  md: 'rounded-lg px-3.5 py-1.5 text-sm',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className = '', type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...rest}
    />
  );
});

export default Button;
