import { type ReactNode, type ButtonHTMLAttributes, useEffect } from 'react';
import { X, Info } from '../lib/icons';

function cx(...parts: (string | false | undefined | null)[]) {
  return parts.filter(Boolean).join(' ');
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-fade-up flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-lg border border-border bg-card shadow-2xl sm:rounded-lg"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{title}</p>
            {subtitle && <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-border bg-secondary/30 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'warn';
  size?: 'sm' | 'md';
};

export function Button({ variant = 'primary', size = 'md', className, children, ...rest }: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 font-medium rounded-md transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap';
  const sizes = { sm: 'text-[13px] h-8 px-3', md: 'text-sm h-9 px-4' };
  const variants = {
    primary: 'bg-primary text-primary-foreground hover:opacity-90 active:opacity-100',
    secondary: 'bg-card text-foreground border border-border hover:bg-secondary',
    ghost: 'text-muted-foreground hover:text-foreground hover:bg-secondary',
    warn: 'bg-warn text-warn-foreground hover:brightness-105',
  };
  return (
    <button className={cx(base, sizes[size], variants[variant], className)} {...rest}>
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx('bg-card border border-border rounded-xl shadow-sm', className)}>
      {children}
    </div>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'warn' | 'danger' | 'success';
  children: ReactNode;
}) {
  const tones = {
    neutral: 'bg-secondary text-muted-foreground border-border',
    warn: 'bg-warn-surface text-warn-foreground border-warn/40',
    danger: 'bg-danger/10 text-danger border-danger/30',
    success: 'bg-success/10 text-success border-success/30',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none tracking-tight',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Tooltip({ content, children }: { content: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex items-center">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-[220px] -translate-x-1/2 rounded-lg border border-border bg-card px-3 py-2 text-[12px] leading-snug text-foreground shadow-xl opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        {content}
        <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-border" />
      </span>
    </span>
  );
}

export function HelpTip({ content }: { content: string }) {
  return (
    <Tooltip content={content}>
      <Info className="size-3.5 cursor-help text-muted-foreground/60 hover:text-muted-foreground transition-colors" />
    </Tooltip>
  );
}

export function AIDisclaimer({ className }: { className?: string }) {
  return (
    <p className={cx('flex items-center gap-1.5 text-[11px] text-muted-foreground/60', className)}>
      <Info className="size-3 shrink-0" />
      ИИ-анализ носит справочный характер и может содержать ошибки — проверяйте документы перед подачей.
    </p>
  );
}

export function Dot({ tone }: { tone: 'warn' | 'danger' | 'success' | 'neutral' }) {
  const tones = {
    warn: 'bg-warn',
    danger: 'bg-danger',
    success: 'bg-success',
    neutral: 'bg-muted-foreground',
  };
  return <span className={cx('inline-block size-1.5 rounded-full', tones[tone])} />;
}
