import { type ReactNode, type SelectHTMLAttributes } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Info, TrendingDown, TrendingUp, XCircle } from '../lib/icons';
import { cx, fieldClass, type Tone } from './ui';

// Общие части экранов с цифрами (редизайн 04.11.2026): таблица данных, показатель, предупреждение, прогресс, заглушка загрузки,
// пустое состояние и выпадающий список. Только вид: поведение экранов не меняется. Числа — только tabular-nums (цифры одной ширины,
// столбцы ровные); отрицательные — настоящий минус «−», а не дефис, и красным вместе со знаком, а не одним цветом.

// ——— Таблица данных ———

/** Обёртка: рамка, прокрутка вбок на узком экране, при maxHeight — прокрутка вниз с «прилипшей» шапкой. */
export function DataTable({ caption, children, className, maxHeight, minWidth, bare }: { caption?: string; children: ReactNode; className?: string; maxHeight?: number | string; /** Ниже этой ширины таблица не сжимается, а прокручивается вбок. */ minWidth?: number; /** Без своей рамки — таблица внутри карточки, у которой рамка уже есть. */ bare?: boolean }) {
  return (
    <div className={cx('overflow-auto', !bare && 'rounded-xl border border-border bg-card', className)} style={maxHeight ? { maxHeight } : undefined}>
      <table className="w-full border-collapse text-ui" style={minWidth ? { minWidth } : undefined}>
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="sticky top-0 z-10 bg-surface-sunken">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

/** Итоговая строка: отдельный слой «колодца» и сильная линия сверху. */
export function TFoot({ children }: { children: ReactNode }) {
  return <tfoot className="border-t border-border-strong/60 bg-surface-sunken font-medium">{children}</tfoot>;
}

export type SortState = 'asc' | 'desc' | 'none';

/** Заголовок столбца. align="right" — для чисел. onSort — столбец сортируется: заголовок становится кнопкой, на ячейке aria-sort. */
export function Th({ children, align = 'left', sort, onSort, className }: { children?: ReactNode; align?: 'left' | 'right' | 'center'; sort?: SortState; onSort?: () => void; className?: string }) {
  const ariaSort = sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : onSort ? 'none' : undefined;
  const active = sort === 'asc' || sort === 'desc';
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cx(
        'whitespace-nowrap border-b border-border-strong/60 px-3 py-2 text-left text-caption font-medium text-muted-foreground',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {onSort ? (
        <button
          type="button"
          onClick={onSort}
          className={cx('inline-flex items-center gap-1 rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', align === 'right' && 'flex-row-reverse', active && 'text-foreground')}
        >
          {children}
          <ChevronDown className={cx('size-3 transition-transform', sort === 'asc' && 'rotate-180', !active && 'opacity-35')} />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export function Tr({ children, selected, className }: { children: ReactNode; selected?: boolean; className?: string }) {
  return <tr className={cx('border-b border-border transition-colors last:border-0 hover:bg-secondary/50', selected && 'bg-primary-soft hover:bg-primary-soft', className)}>{children}</tr>;
}

/** Ячейка. num — число: по правому краю, цифры одной ширины. tone — смысл значения (минус и убыток — danger). strong — название строки. */
export function Td({ children, num, strong, tone = 'neutral', className }: { children?: ReactNode; num?: boolean; strong?: boolean; tone?: Tone | 'muted'; className?: string }) {
  const toneClass = { neutral: '', muted: 'text-muted-foreground', danger: 'text-danger', success: 'text-success', warn: 'text-warn-foreground', info: 'text-info' }[tone];
  return <td className={cx('px-3 py-2.5 align-top', num && 'whitespace-nowrap text-right tabular-nums', strong && 'font-medium text-foreground', toneClass, className)}>{children}</td>;
}

// ——— Показатель ———

export type Delta = { value: string; direction: 'up' | 'down' | 'flat'; /** Рост — это хорошо? (для расходов наоборот). Не задано — нейтральный серый. */ good?: boolean };

/** Плитка показателя: подпись, крупное число (цвет — по смыслу), строка пояснения и изменение к прошлому периоду. */
export function Stat({ label, value, hint, tone = 'neutral', delta, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: Tone; delta?: Delta; className?: string }) {
  const valueTone = { neutral: 'text-foreground', success: 'text-success', danger: 'text-danger', warn: 'text-warn-foreground', info: 'text-info' }[tone];
  const deltaTone = delta?.good === undefined ? 'text-muted-foreground' : delta.good ? 'text-success' : 'text-danger';
  return (
    <div className={cx('min-w-0 rounded-xl border border-border bg-card p-4', className)}>
      <p className="text-caption font-medium text-muted-foreground">{label}</p>
      <p className={cx('mt-1.5 text-2xl font-semibold tabular-nums', valueTone)}>{value}</p>
      {(hint || delta) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-muted-foreground">
          {delta && (
            <span className={cx('inline-flex items-center gap-0.5 font-medium tabular-nums', deltaTone)}>
              {delta.direction === 'up' && <TrendingUp className="size-3.5" />}
              {delta.direction === 'down' && <TrendingDown className="size-3.5" />}
              {delta.value}
            </span>
          )}
          {hint}
        </div>
      )}
    </div>
  );
}

// ——— Предупреждение ———

const ALERT_TONES: Record<Tone, { box: string; icon: string }> = {
  neutral: { box: 'border-border bg-secondary', icon: 'text-muted-foreground' },
  info: { box: 'border-info/25 bg-info-surface', icon: 'text-info' },
  success: { box: 'border-success/25 bg-success-surface', icon: 'text-success' },
  warn: { box: 'border-warn/40 bg-warn-surface', icon: 'text-warn-foreground' },
  danger: { box: 'border-danger/25 bg-danger-surface', icon: 'text-danger' },
};

/** Сообщение внутри страницы: значок по смыслу, заголовок жирно, текст обычным. Ошибка и «внимание» озвучиваются сразу (role=alert), остальное — по месту (status). */
export function Alert({ tone = 'info', title, children, action, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'danger' ? XCircle : tone === 'warn' ? AlertTriangle : Info;
  const look = ALERT_TONES[tone];
  return (
    <div role={tone === 'danger' || tone === 'warn' ? 'alert' : 'status'} className={cx('flex items-start gap-3 rounded-xl border p-3.5 text-ui', look.box, className)}>
      <Icon className={cx('mt-0.5 size-4 shrink-0', look.icon)} />
      <div className="min-w-0 flex-1 space-y-0.5">
        {title && <p className="font-semibold text-foreground">{title}</p>}
        {children && <div className="text-foreground-secondary">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ——— Прогресс ———

const BAR_TONES: Record<Tone, string> = { neutral: 'bg-primary', info: 'bg-info', success: 'bg-success', warn: 'bg-warn', danger: 'bg-danger' };

/** Полоса прогресса. value — от 0 до 100; label нужен диктору (виден на экране при showValue). */
export function Progress({ value, label, tone = 'neutral', showValue, className }: { value: number; label: string; tone?: Tone; showValue?: boolean; className?: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={cx('w-full', className)}>
      {showValue && (
        <div className="mb-1 flex items-baseline justify-between gap-2 text-caption">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-medium tabular-nums text-foreground">{clamped}%</span>
        </div>
      )}
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={clamped} className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken ring-1 ring-inset ring-border">
        <div className={cx('h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none', BAR_TONES[tone])} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

// ——— Загрузка и пустота ———

/** Заглушка на время загрузки: форма будущего блока. Скрыта от диктора — о загрузке говорит объемлющий aria-busy / role=status. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx('animate-pulse rounded-md bg-accent motion-reduce:animate-none', className)} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cx('space-y-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cx('h-3', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

/** Пустой список или раздел: что здесь будет и что сделать, чтобы появилось. */
export function EmptyState({ icon, title, children, action, className }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong/60 bg-surface-sunken/50 px-6 py-10 text-center', className)}>
      {icon && <span className="flex size-10 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">{icon}</span>}
      <p className="text-subtitle font-semibold">{title}</p>
      {children && <p className="max-w-sm text-ui text-muted-foreground">{children}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

// ——— Выпадающий список ———

/** Обычный <select> (клавиатура и телефон — как у браузера) в общем стиле поля: стрелка своя, рамка и фокус как у остальных полей. */
export function Select({ dense, className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { dense?: boolean }) {
  return (
    <span className="relative inline-flex w-full">
      <select className={cx(fieldClass(dense ? 'sm' : 'md'), 'appearance-none pr-8', className)} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </span>
  );
}
