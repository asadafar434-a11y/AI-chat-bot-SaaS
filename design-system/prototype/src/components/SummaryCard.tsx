import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from '../lib/icons';
import { Card, cx } from './ui';

// Сводная карточка под шапкой экрана (как «Сила профиля»): слева значок или число, заголовок и строка итога, справа действие.
// Есть children — карточка сворачивается и разворачивается по нажатию на левую часть (по умолчанию свёрнута); нет — просто итог.
export function SummaryCard({
  lead,
  title,
  subtitle,
  action,
  defaultOpen = false,
  children,
}: {
  lead?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  defaultOpen?: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const head = (
    <>
      {lead}
      <span className="min-w-0">
        <span className="block text-subtitle font-bold leading-tight">{title}</span>
        {subtitle && <span className="block text-caption leading-snug text-muted-foreground">{subtitle}</span>}
      </span>
    </>
  );
  return (
    <Card className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {children ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? id : undefined}
            onClick={() => setOpen((v) => !v)}
            className="flex min-w-[min(100%,15rem)] flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {head}
            <ChevronDown className={cx('ml-auto size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
            <span className="sr-only">{open ? 'Свернуть' : 'Развернуть'}</span>
          </button>
        ) : (
          <div className="flex min-w-[min(100%,15rem)] flex-1 items-center gap-3">{head}</div>
        )}
        {action}
      </div>
      {children && open && (
        <div id={id} className="mt-3 border-t border-border pt-3">
          {children}
        </div>
      )}
    </Card>
  );
}
