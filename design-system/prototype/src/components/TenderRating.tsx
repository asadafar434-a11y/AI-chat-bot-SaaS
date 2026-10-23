import { useState } from 'react';
import { MIN_COVERAGE, type Factor, type Rating, type RatingTone } from '@/lib/tender-rating';
import { AlertTriangle, ChevronRight } from '../lib/icons';
import { HelpTip, Modal } from './ui';

// Рейтинг привлекательности тендера: круговой индикатор 0–100, вердикт рядом, по нажатию — расшифровка (lib/tender-rating.ts).
// Балл считает код по прозрачным правилам, а не ИИ. Это не вероятность победы. В расшифровке сказано, по каким именно данным посчитан балл и чего нет; критические препятствия показаны отдельно.
// Данных мало (меньше 70 % веса, но не меньше 35 %) — балл предварительный и помечен так; меньше 35 % — балла нет.

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
        <p className={`font-mono text-[13px] font-bold ${RING_TEXT[f.tone]}`}>{f.score} из 100</p>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden>
        <div className={`h-full rounded-full ${BAR[f.tone]}`} style={{ width: `${f.score}%` }} />
      </div>
      <p className="break-words text-[12px]">{f.note}</p>
      {f.source && <p className="break-words text-[11px] text-muted-foreground">Данные: {f.source}</p>}
    </li>
  );
}

// Расшифровка: препятствия, факторы с баллами и данными, на которых они стоят, и отдельно — чего нет и что сделать. Вынесена отдельно, чтобы её проверяли тесты без окна.
export function RatingDetails({ rating }: { rating: Rating }) {
  const ready = rating.status === 'ready';
  const tone: RatingTone = ready ? rating.verdict!.tone : 'muted';
  const label = ready ? rating.verdict!.label : 'Недостаточно данных для оценки';
  const withData = rating.factors.filter((f) => f.score !== null);
  const absent = rating.factors.filter((f) => f.score === null && !f.mergedInto);
  const merged = rating.factors.filter((f) => f.score === null && f.mergedInto);
  return (
    <div className="space-y-5 p-5">
      <div className="flex items-center gap-4">
        <RatingRing score={rating.score} tone={tone} size={88} />
        <div className="min-w-0">
          <p className={`flex flex-wrap items-center gap-x-2 text-xl font-bold tracking-tight ${ready ? RING_TEXT[tone] : 'text-foreground'}`}>
            {label}
            {ready && rating.preliminary && <span className="rounded-full border border-warn/40 bg-warn-surface px-2 py-0.5 text-[11px] font-medium tracking-normal text-warn-foreground">предварительно</span>}
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {withData.length > 0 ? `Посчитано по: ${withData.map((f) => f.title.toLowerCase()).join(', ')}.` : 'Ни по одному фактору данных пока нет.'}
            {absent.length > 0 ? ` Нет данных: ${absent.map((f) => f.title.toLowerCase()).join(', ')}.` : ''} Это не вероятность победы и не прогноз.
          </p>
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

      {withData.length > 0 && (
        <section>
          <p className="mb-2 text-[13px] font-bold">Из чего складывается балл</p>
          <ul className="divide-y divide-border">
            {withData.map((f) => (
              <FactorRow key={f.id} f={f} />
            ))}
            {merged.map((f) => (
              <li key={f.id} className="space-y-0.5 py-3 last:pb-0">
                <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                  {f.title}
                  <HelpTip align="start" content={f.basis} />
                </p>
                <p className="break-words text-[12px] text-muted-foreground">{f.note}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-muted-foreground">Факторы без данных в балле не участвуют: оценки по ним не выдумываются. Появятся данные — балл станет точнее.</p>
        </section>
      )}

      {absent.length > 0 && (
        <section className="space-y-2 rounded-lg border border-border bg-secondary/40 p-3">
          <p className="text-[13px] font-bold">Нет данных</p>
          <ul className="space-y-2">
            {absent.map((f) => (
              <li key={f.id} className="text-[12px]">
                <p className="font-semibold">
                  {f.title} <span className="font-normal text-muted-foreground">· вес {f.weight} %</span>
                </p>
                {f.missing[0] && <p className="text-muted-foreground">Нужно: {f.missing[0]}</p>}
                {f.source && <p className="text-[11px] text-muted-foreground">Данные: {f.source}</p>}
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
  const aria = ready
    ? `Рейтинг привлекательности ${rating.score} из 100${rating.preliminary ? ' (предварительно)' : ''}: ${label}. Открыть расшифровку`
    : `Рейтинг не посчитан: ${label.toLowerCase()}. Открыть, чего не хватает`;
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
            <span className={`mt-0.5 flex flex-wrap items-center gap-x-2 text-xl font-bold tracking-tight ${ready ? RING_TEXT[tone] : 'text-foreground'}`}>
              {label}
              {ready && rating.preliminary && <span className="rounded-full border border-warn/40 bg-warn-surface px-2 py-0.5 text-[11px] font-medium tracking-normal text-warn-foreground">предварительно</span>}
            </span>
            <span className="mt-0.5 block text-[12px] text-muted-foreground">
              {ready
                ? `по ${withData.length} из ${rating.factors.filter((f) => !f.mergedInto).length} факторов: ${withData.map((f) => f.title.toLowerCase()).join(', ')}${rating.capped ? ` · ограничено препятствием (без него ${rating.rawScore})` : ''}`
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
