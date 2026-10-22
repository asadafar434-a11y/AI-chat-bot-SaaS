import { useState } from 'react';
import { MIN_COVERAGE, type Factor, type Rating, type RatingTone } from '@/lib/tender-rating';
import { AlertTriangle, ChevronRight } from '../lib/icons';
import { HelpTip, Modal } from './ui';

// Рейтинг привлекательности тендера: круговой индикатор 0–100, вердикт рядом, по нажатию — расшифровка по шести факторам (lib/tender-rating.ts).
// Балл считает код по прозрачным правилам, а не ИИ. Это не вероятность победы. Критические препятствия и нехватка данных показаны отдельно от балла.

const RING_TEXT: Record<RatingTone, string> = { good: 'text-success', warn: 'text-warn-foreground', danger: 'text-danger', muted: 'text-muted-foreground' };
const BAR: Record<RatingTone, string> = { good: 'bg-success', warn: 'bg-warn', danger: 'bg-danger', muted: 'bg-muted-foreground/40' };

export function RatingRing({ score, tone, size = 72 }: { score: number | null; tone: RatingTone; size?: number }) {
  const stroke = Math.max(6, Math.round(size / 9));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = score === null ? 0 : (Math.max(0, Math.min(100, score)) / 100) * c;
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center ${RING_TEXT[tone]}`} style={{ width: size, height: size }} aria-hidden>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-border" strokeDasharray={score === null ? '3 5' : undefined} />
        {score !== null && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" className="stroke-current" strokeDasharray={`${filled} ${c}`} />
        )}
      </svg>
      <span className="absolute font-mono font-bold tracking-tight text-foreground" style={{ fontSize: Math.round(size * 0.34) }}>
        {score === null ? '—' : score}
      </span>
    </span>
  );
}

function FactorRow({ f }: { f: Factor }) {
  return (
    <li className="space-y-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold">
          {f.title}
          <span className="text-[11px] font-normal text-muted-foreground">вес {f.weight} %</span>
          <HelpTip align="start" content={f.basis} />
        </p>
        <p className={`font-mono text-[13px] font-bold ${f.score === null ? 'text-muted-foreground' : RING_TEXT[f.tone]}`}>{f.score === null ? (f.mergedInto ? 'учтено в рентабельности' : 'нет данных') : `${f.score} из 100`}</p>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden>
        {f.score !== null && <div className={`h-full rounded-full ${BAR[f.tone]}`} style={{ width: `${f.score}%` }} />}
      </div>
      <p className="break-words text-[12px] text-muted-foreground">{f.note}</p>
    </li>
  );
}

// Расшифровка: препятствия, факторы с баллами и формулами, чего не хватает. Вынесена отдельно, чтобы её проверяли тесты без окна.
export function RatingDetails({ rating }: { rating: Rating }) {
  const ready = rating.status === 'ready';
  const tone: RatingTone = ready ? rating.verdict!.tone : 'muted';
  const label = ready ? rating.verdict!.label : 'Недостаточно данных для оценки';
  return (
    <div className="space-y-5 p-5">
      <div className="flex items-center gap-4">
        <RatingRing score={rating.score} tone={tone} size={88} />
        <div className="min-w-0">
          <p className={`text-xl font-bold tracking-tight ${ready ? RING_TEXT[tone] : 'text-foreground'}`}>{label}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">Показывает, насколько закупка выгодна и безопасна для вас при ваших данных. Это не вероятность победы и не прогноз.</p>
        </div>
      </div>

      {rating.blockers.length > 0 && (
        <section className="space-y-2 rounded-lg border border-danger/40 bg-danger/5 p-3">
          <p className="text-[13px] font-bold text-danger">Критические препятствия</p>
          <ul className="space-y-1.5">
            {rating.blockers.map((b) => (
              <li key={b.id} className="flex items-start gap-2 text-[13px]">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" />
                <span className="min-w-0 break-words">{b.text}</span>
              </li>
            ))}
          </ul>
          {rating.capped && <p className="text-[12px] text-muted-foreground">Из-за них балл не выше {rating.score}; по факторам он был бы {rating.rawScore}.</p>}
        </section>
      )}

      <section>
        <p className="mb-2 text-[13px] font-bold">Из чего складывается балл</p>
        <ul className="divide-y divide-border">
          {rating.factors.map((f) => (
            <FactorRow key={f.id} f={f} />
          ))}
        </ul>
        <p className="mt-3 text-[12px] text-muted-foreground">Факторы без данных в балле не участвуют: оценки по ним не выдумываются, остальные веса пересчитываются.</p>
      </section>

      {rating.missing.length > 0 && (
        <section className="space-y-2 rounded-lg border border-border bg-secondary/40 p-3">
          <p className="text-[13px] font-bold">Не хватает данных</p>
          <ul className="space-y-1.5">
            {rating.missing.map((m) => (
              <li key={m.factor} className="text-[12px]">
                <span className="font-semibold">{m.factor}:</span> <span className="text-muted-foreground">{m.items.join('; ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function TenderRating({ rating }: { rating: Rating }) {
  const [open, setOpen] = useState(false);
  const ready = rating.status === 'ready';
  const tone: RatingTone = ready ? rating.verdict!.tone : 'muted';
  const label = ready ? rating.verdict!.label : 'Недостаточно данных для оценки';
  const aria = ready ? `Рейтинг привлекательности ${rating.score} из 100: ${label}. Открыть расшифровку` : `Рейтинг не посчитан: ${label.toLowerCase()}. Открыть, чего не хватает`;
  const withData = rating.factors.filter((f) => f.score !== null);
  return (
    <>
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={aria}
          className="flex w-full items-center gap-4 rounded-lg text-left outline-none transition-colors hover:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-foreground/30"
        >
          <RatingRing score={rating.score} tone={tone} />
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-medium text-muted-foreground">Привлекательность тендера · не вероятность победы</span>
            <span className={`mt-0.5 block text-xl font-bold tracking-tight ${ready ? RING_TEXT[tone] : 'text-foreground'}`}>{label}</span>
            <span className="mt-0.5 block text-[12px] text-muted-foreground">
              {ready
                ? `по ${withData.length} из ${rating.factors.filter((f) => !f.mergedInto).length} факторов${rating.capped ? ` · ограничено препятствием (без него ${rating.rawScore})` : ''}`
                : `данных ${rating.coverage} % из нужных ${MIN_COVERAGE} %`}
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </button>
        {rating.blockers.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-border pt-3">
            {rating.blockers.slice(0, 2).map((b) => (
              <li key={b.id} className="flex items-start gap-2 text-[13px] font-medium text-danger">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0 break-words">{b.text}</span>
              </li>
            ))}
            {rating.blockers.length > 2 && <li className="text-[12px] text-muted-foreground">и ещё {rating.blockers.length - 2} — в расшифровке</li>}
          </ul>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Рейтинг привлекательности тендера" subtitle="Считает код по прозрачным правилам, не ИИ">
        <RatingDetails rating={rating} />
      </Modal>
    </>
  );
}
