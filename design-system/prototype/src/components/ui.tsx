import { type ReactNode, type ButtonHTMLAttributes, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Info, Bell, Check } from '../lib/icons';

export function cx(...parts: (string | false | undefined | null)[]) {
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

  // Окно — в конец страницы: внутри анимированного блока (transform) «fixed» считается от блока, а не от экрана.
  return createPortal(
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
          <IconButton label="Закрыть" onClick={onClose} side="bottom" align="end">
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-secondary/30 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'warn' | 'accent' | 'danger';
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
    // Градиент бренда — как у кнопки чата: для платных и главных действий.
    accent:
      'bg-brand-gradient text-white shadow-md shadow-indigo-500/30 hover:-translate-y-px hover:brightness-110 hover:shadow-lg hover:shadow-indigo-500/40 active:translate-y-0',
    danger: 'bg-danger text-white hover:opacity-90',
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

export type Tone = 'neutral' | 'warn' | 'danger' | 'success' | 'info';

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  const tones = {
    neutral: 'bg-secondary text-muted-foreground border-border',
    warn: 'bg-warn-surface text-warn-foreground border-warn/40',
    danger: 'bg-danger/10 text-danger border-danger/30',
    success: 'bg-success/10 text-success border-success/30',
    info: 'bg-info/10 text-info border-info/30',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none tracking-tight',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

// Пометка «скоро»: экран или действие есть в дизайне, но система их ещё не умеет.
export function Soon({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full border border-dashed border-muted-foreground/50 px-1.5 py-px text-[10px] font-medium uppercase leading-none tracking-wide text-muted-foreground',
        className,
      )}
    >
      скоро
    </span>
  );
}

// Подсказка при наведении и при фокусе с клавиатуры. align — к какому краю прижать, чтобы не вылезти за экран.
// Скрытая подсказка не занимает места (display: none) — иначе на телефоне она раздвигает страницу.
export function Tooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  className,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom';
  align?: 'center' | 'start' | 'end';
  className?: string;
}) {
  return (
    <span className={cx('group/tip relative inline-flex items-center', className)}>
      {children}
      <span
        role="tooltip"
        className={cx(
          'animate-tip pointer-events-none absolute z-50 hidden w-max max-w-[240px] rounded-lg border border-border bg-card px-3 py-2 text-left font-sans text-[12px] font-normal normal-case leading-snug tracking-normal text-foreground shadow-xl group-hover/tip:block group-focus-within/tip:block',
          side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
          align === 'center' && 'left-1/2 -translate-x-1/2',
          align === 'start' && 'left-0',
          align === 'end' && 'right-0',
        )}
      >
        {content}
      </span>
    </span>
  );
}

export function HelpTip({ content, side, align }: { content: string; side?: 'top' | 'bottom'; align?: 'center' | 'start' | 'end' }) {
  return (
    <Tooltip content={content} side={side} align={align}>
      <span
        tabIndex={0}
        aria-label={content}
        className="inline-flex cursor-help rounded-full text-muted-foreground/60 outline-none transition-colors hover:text-muted-foreground focus-visible:text-foreground"
      >
        <Info className="size-3.5" />
      </span>
    </Tooltip>
  );
}

// Иконочная кнопка всегда с подсказкой: по одной иконке не всегда понятно, что она делает.
export function IconButton({
  label,
  children,
  tone = 'neutral',
  side,
  align,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  tone?: 'neutral' | 'danger';
  side?: 'top' | 'bottom';
  align?: 'center' | 'start' | 'end';
}) {
  return (
    <Tooltip content={label} side={side} align={align}>
      <button
        type="button"
        aria-label={label}
        className={cx(
          'flex size-7 shrink-0 items-center justify-center rounded-md transition-all',
          tone === 'danger'
            ? 'text-danger hover:bg-danger/10 hover:ring-1 hover:ring-danger/50'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
}

// Галочка: настоящий input скрыт, но остаётся доступным с клавиатуры и экранному диктору.
export function Checkbox({
  checked,
  onChange,
  children,
  className,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx('flex cursor-pointer items-start gap-2.5', className)}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} className="peer sr-only" />
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border border-border bg-card text-primary-foreground transition-colors peer-checked:border-foreground peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
        {checked && <Check className="size-3" />}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </label>
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

export function Dot({ tone }: { tone: Tone }) {
  const tones = {
    warn: 'bg-warn',
    danger: 'bg-danger',
    success: 'bg-success',
    info: 'bg-info',
    neutral: 'bg-muted-foreground',
  };
  return <span className={cx('inline-block size-1.5 shrink-0 rounded-full', tones[tone])} />;
}

// Всплывающее уведомление — например, «Специалист ответил».
export function Toast({
  title,
  text,
  action,
  onAction,
  onClose,
}: {
  title: string;
  text: string;
  action: string;
  onAction: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 9000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div
      role="status"
      className="animate-fade-up fixed left-1/2 top-4 z-[60] flex w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 items-start gap-3 rounded-xl border border-border bg-card p-3.5 shadow-2xl"
    >
      <span className="bg-brand-gradient flex size-8 shrink-0 items-center justify-center rounded-full text-white">
        <Bell className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{text}</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={onAction}>
          {action}
        </Button>
      </div>
      <IconButton label="Закрыть" onClick={onClose} side="bottom" align="end">
        <X className="size-4" />
      </IconButton>
    </div>
  );
}
