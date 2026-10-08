import { type ReactNode, type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type RefObject, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Info, Bell, Check } from '../lib/icons';
import { tabTarget } from '@/lib/focus-trap';

export function cx(...parts: (string | false | undefined | null)[]) {
  return parts.filter(Boolean).join(' ');
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Окно перехватывает клавиатуру: фокус уходит внутрь, Tab не выходит за окно, а после закрытия фокус возвращается
// туда, откуда окно открыли. Без этого человек с клавиатурой остаётся «позади» затемнения и жмёт кнопки невидимой страницы.
export function useDialogFocus(box: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const dialog = box.current;
    if (!active || !dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.focus({ preventScroll: true });
    let back = false;
    const stops = () => [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      back = e.shiftKey;
      const at = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const next = tabTarget(stops(), at, back, dialog, !!at && dialog.contains(at));
      if (next === 'stay') return;
      e.preventDefault();
      if (next) next.focus();
    };
    // Страж: что бы ни вывело фокус за окно (Tab с прокручиваемой области, программный фокус), он возвращается внутрь.
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof Node && dialog.contains(e.target)) return;
      const items = stops();
      const target = (back ? items[items.length - 1] : items[0]) ?? dialog;
      target.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
      // Фокус возвращается кадром позже, когда страница под окном уже обновилась: если нажатое окно открывали из строки,
      // которую удалили, фокус получает основной блок, а не начало страницы. Открылось другое окно — фокус остаётся у него.
      requestAnimationFrame(() => {
        if (document.querySelector('[role=dialog][aria-modal=true]')) return;
        if (opener?.isConnected) opener.focus({ preventScroll: true });
        else document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true });
      });
    };
  }, [box, active]);
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
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus(box, open);

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
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="animate-fade-up flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-lg border border-border bg-card shadow-2xl outline-none sm:rounded-lg"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            <p id={titleId} className="truncate text-sm font-semibold">{title}</p>
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
    // Текст как у главной кнопки: в тёмной теме цвет ошибки светлый, и белая надпись на нём не читалась (2,8 : 1).
    danger: 'bg-danger text-primary-foreground hover:opacity-90',
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
        role="img"
        aria-label={content}
        className="inline-flex cursor-help rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
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

// Сегментированный контрол: разводит один длинный экран по разделам (вместо «всё в кучу»), разделы не теряются —
// только прячутся, пока не выбраны (role=tabpanel с hidden), поэтому переключение не сбрасывает их состояние.
// Клавиатура — как в WAI-ARIA Tabs: стрелки влево/вправо и Home/End двигают фокус и выбор вместе.
export function Tabs({
  idPrefix,
  items,
  active,
  onChange,
  className,
}: {
  idPrefix: string;
  items: { key: string; label: string; badge?: ReactNode }[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const go = (key: string) => {
    onChange(key);
    refs.current[key]?.focus();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const i = items.findIndex((it) => it.key === active);
    if (i < 0) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(items[(i + 1) % items.length].key);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(items[(i - 1 + items.length) % items.length].key);
    } else if (e.key === 'Home') {
      e.preventDefault();
      go(items[0].key);
    } else if (e.key === 'End') {
      e.preventDefault();
      go(items[items.length - 1].key);
    }
  };

  return (
    <div
      role="tablist"
      onKeyDown={onKeyDown}
      className={cx('inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1 shadow-sm', className)}
    >
      {items.map((item) => {
        const selected = item.key === active;
        return (
          <button
            key={item.key}
            ref={(el) => {
              refs.current[item.key] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${item.key}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${item.key}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.key)}
            className={cx(
              'flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
            {item.badge}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  idPrefix,
  tabKey,
  active,
  className,
  children,
}: {
  idPrefix: string;
  tabKey: string;
  active: string;
  className?: string;
  children: ReactNode;
}) {
  const selected = active === tabKey;
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${tabKey}`}
      aria-labelledby={`${idPrefix}-tab-${tabKey}`}
      hidden={!selected}
      tabIndex={0}
      className={selected ? cx('space-y-6', className) : undefined}
    >
      {children}
    </div>
  );
}

export function AIDisclaimer({ className }: { className?: string }) {
  return (
    <p className={cx('flex items-center gap-1.5 text-[11px] text-muted-foreground', className)}>
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
