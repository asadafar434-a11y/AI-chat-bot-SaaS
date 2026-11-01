import { useId, type ReactNode } from 'react';
import type { Tone } from '@/lib/analytics-summary';
import { ChevronDown } from '../lib/icons';

// Раскрывающийся раздел «Аналитики»: в закрытом виде — название и одна строка итога, внутри — подробности. Содержимое остаётся в разметке (скрыто), поэтому введённое не теряется при сворачивании.
const BRIEF_TONE: Record<Tone, string> = {
  danger: 'font-semibold text-danger',
  warn: 'font-semibold text-warn-foreground',
  good: 'font-semibold text-success',
  muted: 'font-normal text-muted-foreground',
};

export function Collapsible({
  title,
  brief,
  tone = 'muted',
  open,
  onToggle,
  children,
}: {
  title: string;
  brief?: string;
  /** Важность строки итога: красная, янтарная и зелёная — жирным; обычная — тихо. */
  tone?: Tone;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="card-hover rounded-xl border border-border bg-card shadow-sm">
      <h2 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
          className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{title}</span>
            {brief && <span className={`mt-0.5 block break-words text-[13px] ${BRIEF_TONE[tone]}`}>{brief}</span>}
          </span>
          <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </h2>
      <div id={id} hidden={!open} className="border-t border-border px-4 py-3">
        {children}
      </div>
    </section>
  );
}
