import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import {
  chartFacts,
  compactRub,
  niceTicks,
  priceBar,
  profitCurve,
  riskShares,
  SCENARIO_LABELS,
  type Curve,
  type PartId,
  type PriceBar,
  type RiskShares,
} from '@/lib/analytics-chart';
import { percent, rubles } from '@/lib/analytics-summary';
import type { EconResult, Scenario } from '@/lib/economics';
import type { MatrixSummary } from '@/lib/check-matrix';
import type { RicResult } from '@/lib/indicative-price';
import type { EstimateResult } from '@/lib/risk-estimate';
import { CertaintyBadge } from './Certainty';
import { HelpTip, Soon } from './ui';

// Итоговая диаграмма разбора: только проценты и суммы, которые код уже посчитал (lib/analytics-chart.ts). Три картинки: из чего складывается цена, риски в процентах от цены, прибыль при снижении цены.
// «Процент победы» не рисуем — нужна история торгов. Каждое значение есть и текстом (список, подписи, таблица под графиком): подсказка при наведении только дополняет.

const FILL: Record<PartId | 'loss', string> = {
  costs: 'bg-foreground/85',
  taxes: 'bg-foreground/50',
  risks: 'bg-warn',
  profit: 'bg-success',
  loss: 'bg-danger',
};

const SHORT: Record<Scenario, string> = { optimistic: 'Лучший', base: 'Базовый', stress: 'Стресс' };

function Segmented({ value, onChange }: { value: Scenario; onChange: (s: Scenario) => void }) {
  return (
    <div role="radiogroup" aria-label="Сценарий" className="inline-flex rounded-md border border-border bg-secondary p-0.5">
      {(['optimistic', 'base', 'stress'] as const).map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          title={SCENARIO_LABELS[id]}
          onClick={() => onChange(id)}
          className={`h-7 rounded px-2.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            value === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {SHORT[id]}
        </button>
      ))}
    </div>
  );
}

function Facts({ econ, estimate, ric, matrix }: { econ: EconResult; estimate: EstimateResult; ric: RicResult | null; matrix?: MatrixSummary }) {
  const facts = chartFacts({ econ, estimate, ric, matrix });
  if (facts.length === 0) return null;
  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-2">
      {facts.map((f) => (
        <div key={f.id} className="min-w-0 rounded-lg border border-border px-3 py-2">
          <dt className="text-[11px] text-muted-foreground">{f.label}</dt>
          <dd className="mt-0.5 break-words text-[20px] font-semibold leading-tight tracking-tight">{f.value}</dd>
          <p className="mt-0.5 break-words text-[11px] text-muted-foreground">{f.hint}</p>
        </div>
      ))}
    </dl>
  );
}

function Amount({ amount, pct }: { amount: number; pct: number }) {
  return (
    <span className="shrink-0 text-right">
      <span className="block font-mono text-[13px]">{rubles(amount)}</span>
      <span className="block text-[12px] text-muted-foreground">{percent(pct)}</span>
    </span>
  );
}

function PriceSection({ econ }: { econ: EconResult }) {
  const [scenario, setScenario] = useState<Scenario>('base');
  const bar: PriceBar | null = priceBar(econ, scenario);
  return (
    <section aria-labelledby="chart-price" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="chart-price" className="text-[13px] font-medium">
          Из чего складывается цена{bar ? ` ${rubles(bar.price)}` : ''}
        </h3>
        {bar && <Segmented value={scenario} onChange={setScenario} />}
      </div>
      {!bar ? (
        <p className="text-[13px] text-muted-foreground">
          {econ.ready === false && econ.reason === 'nmck'
            ? 'Начальной цены в документах нет — раскладывать нечего.'
            : 'Впишите затраты на исполнение — покажу, из чего складывается цена.'}
        </p>
      ) : (
        <>
          <div className="relative pt-4">
            <div
              role="img"
              aria-label={`${SCENARIO_LABELS[scenario]} сценарий: ${bar.parts.map((p) => `${p.label} ${percent(p.pct)}`).join(', ')}${bar.loss ? `; убыток ${percent(bar.loss.pct)} цены` : ''}`}
              className="flex h-5 w-full gap-0.5 overflow-hidden rounded-[4px]"
            >
              {bar.parts.map((p) => (
                <div key={p.id} title={`${p.label}: ${rubles(p.amount)} · ${percent(p.pct)}`} className={`${FILL[p.id]} min-w-[2px]`} style={{ flexGrow: p.amount, flexBasis: 0 }} />
              ))}
            </div>
            {bar.priceAt !== null && (
              <>
                <div className="pointer-events-none absolute bottom-[-2px] top-3 w-px bg-foreground" style={{ left: `${bar.priceAt}%` }} aria-hidden />
                <span
                  className={`pointer-events-none absolute top-0 whitespace-nowrap text-[11px] text-muted-foreground ${bar.priceAt > 80 ? '-translate-x-full pr-1' : 'pl-1'}`}
                  style={{ left: `${bar.priceAt}%` }}
                >
                  цена заявки
                </span>
              </>
            )}
            {bar.loss && bar.priceAt !== null && <div className={`mt-1.5 h-1.5 rounded-[3px] ${FILL.loss}`} style={{ marginLeft: `${bar.priceAt}%`, width: `${100 - bar.priceAt}%` }} aria-hidden />}
          </div>
          <ul className="divide-y divide-border">
            {bar.parts.map((p) => (
              <li key={p.id} className="flex items-start gap-2.5 py-2">
                <span className={`mt-1 size-2.5 shrink-0 rounded-sm ${FILL[p.id]}`} aria-hidden />
                <div className="min-w-0 flex-1 text-[13px]">
                  <p>{p.label}</p>
                  {p.items.length > 1 && <p className="mt-0.5 break-words text-[12px] text-muted-foreground">{p.items.map((i) => `${i.label} ${rubles(i.amount)}`).join(' · ')}</p>}
                </div>
                <Amount amount={p.amount} pct={p.pct} />
              </li>
            ))}
            {bar.loss && (
              <li className="flex items-start gap-2.5 py-2">
                <span className={`mt-1 size-2.5 shrink-0 rounded-sm ${FILL.loss}`} aria-hidden />
                <div className="min-w-0 flex-1 text-[13px]">
                  <p>Убыток</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">Затраты, налог и риски сверх цены заявки</p>
                </div>
                <Amount amount={bar.loss.amount} pct={bar.loss.pct} />
              </li>
            )}
          </ul>
        </>
      )}
    </section>
  );
}

function RiskSection({ shares }: { shares: RiskShares }) {
  return (
    <section aria-labelledby="chart-risks" className="space-y-3">
      <h3 id="chart-risks" className="text-[13px] font-medium">
        Риски в процентах от цены
      </h3>
      {shares.shown.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Рисков в рублях нет: нужны цена и условия договора.</p>
      ) : (
        <>
          <ul className="space-y-2.5">
            {shares.shown.map((s) => (
              <li key={s.id} title={s.basis}>
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="min-w-0 break-words">{s.title}</span>
                  <span className="shrink-0 font-mono text-[12px]">
                    {rubles(s.amount)} · {percent(s.pct)}
                  </span>
                </div>
                <div className="mt-1 h-2 rounded-[4px] bg-secondary" role="img" aria-label={`${s.title}: ${percent(s.pct)} цены`}>
                  <div className={`h-full rounded-[4px] ${FILL.risks}`} style={{ width: `${Math.max(1, (s.pct / shares.shown[0].pct) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
          {shares.rest.count > 0 && <p className="text-[12px] text-muted-foreground">И ещё рисков: {shares.rest.count}, на {rubles(shares.rest.amount)}.</p>}
        </>
      )}
      {shares.unknown.length > 0 && (
        <p className="text-[12px] text-muted-foreground">
          Без суммы: {shares.unknown.map((u) => u.title).join('; ')}
        </p>
      )}
    </section>
  );
}

function useWidth(ref: RefObject<HTMLElement | null>, initial = 640) {
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = (w: number) => w > 0 && setWidth(Math.max(240, Math.floor(w)));
    read(el.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => read(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

const HEIGHT = 220;
const PAD_TOP = 14;
const PAD_BOTTOM = 26;

function CurveSection({ curve }: { curve: Curve }) {
  const holder = useRef<HTMLDivElement>(null);
  const width = useWidth(holder);
  const [index, setIndex] = useState<number | null>(null);
  const { points } = curve;
  const maxDrop = points[points.length - 1].drop;
  const ticks = niceTicks(Math.min(...points.map((p) => Math.min(p.base, p.stress))), Math.max(...points.map((p) => Math.max(p.base, p.stress))));
  const tickLabels = ticks.map(compactRub);
  // Слева — место под самую длинную подпись оси (с минусом), справа — под подписи концов линий, если экран широкий; на узком их заменяет легенда.
  const direct = width >= 420;
  const PAD = { l: Math.ceil(Math.max(...tickLabels.map((l) => l.length)) * 6.3) + 14, r: direct ? 58 : 14, t: PAD_TOP, b: PAD_BOTTOM };
  const plotW = width - PAD.l - PAD.r;
  const plotH = HEIGHT - PAD.t - PAD.b;
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const x = (drop: number) => PAD.l + (drop / maxDrop) * plotW;
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * plotH;
  const path = (key: 'base' | 'stress') => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.drop).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const nearest = (clientX: number, left: number) => {
    const drop = ((clientX - left - PAD.l) / plotW) * maxDrop;
    return points.reduce((best, p, i) => (Math.abs(p.drop - drop) < Math.abs(points[best].drop - drop) ? i : best), 0);
  };
  const onMove = (e: PointerEvent<SVGRectElement>) => setIndex(nearest(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect().left));
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setIndex((i) => Math.min(points.length - 1, Math.max(0, (i ?? 0) + (e.key === 'ArrowRight' ? 1 : -1))));
  };
  const hit = index === null ? null : points[index];
  const flip = hit !== null && x(hit.drop) > width / 2;
  const zeroY = y(0);
  const hasLoss = lo < 0;
  return (
    <section aria-labelledby="chart-curve" className="space-y-3">
      <h3 id="chart-curve" className="text-[13px] font-medium">
        Прибыль при снижении цены
      </h3>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full" style={{ background: 'var(--viz-1)' }} aria-hidden />
          Базовый сценарий
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full" style={{ background: 'var(--viz-2)' }} aria-hidden />
          Стрессовый сценарий
        </li>
      </ul>
      <div
        ref={holder}
        className="relative rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        tabIndex={0}
        role="group"
        aria-label="График прибыли при снижении цены. Стрелки влево и вправо выбирают точку."
        onKeyDown={onKey}
        onFocus={() => setIndex((i) => i ?? 0)}
        onBlur={() => setIndex(null)}
      >
        <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={`Прибыль в базовом сценарии от ${rubles(points[0].base)} при начальной цене до ${rubles(last.base)} при снижении на ${last.drop} %, в стрессовом — от ${rubles(points[0].stress)} до ${rubles(last.stress)}`} className="block max-w-full">
          {hasLoss && <rect x={PAD.l} y={zeroY} width={plotW} height={PAD.t + plotH - zeroY} className="fill-danger/10" />}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={PAD.l + plotW} y1={y(t)} y2={y(t)} className={t === 0 ? 'stroke-muted-foreground/60' : 'stroke-border'} strokeWidth={1} />
              <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
                {compactRub(t)}
              </text>
            </g>
          ))}
          {points.map((p) => (
            <text key={p.drop} x={x(p.drop)} y={HEIGHT - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
              {p.drop}
            </text>
          ))}
          {hasLoss && (
            <text x={PAD.l + 6} y={PAD.t + plotH - 6} className="fill-muted-foreground text-[11px]">
              убыток
            </text>
          )}
          {curve.currentDrop !== null && (
            <g>
              <line x1={x(curve.currentDrop)} x2={x(curve.currentDrop)} y1={PAD.t} y2={PAD.t + plotH} className="stroke-foreground" strokeWidth={1} />
              <text x={x(curve.currentDrop) + (x(curve.currentDrop) > width / 2 ? -5 : 5)} y={PAD.t + 10} textAnchor={x(curve.currentDrop) > width / 2 ? 'end' : 'start'} className="fill-muted-foreground text-[11px]">
                цена заявки
              </text>
            </g>
          )}
          {(['base', 'stress'] as const).map((key, n) => (
            <path key={key} d={path(key)} fill="none" stroke={`var(--viz-${n + 1})`} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {(['base', 'stress'] as const).map((key, n) => (
            <g key={key}>
              <circle cx={x(last.drop)} cy={y(last[key])} r={4} fill={`var(--viz-${n + 1})`} stroke="var(--card)" strokeWidth={2} />
              {direct && (
                <text x={x(last.drop) + 9} y={y(last[key]) + 4} className="fill-muted-foreground text-[11px]" aria-hidden>
                  {key === 'base' ? 'базовый' : 'стресс'}
                </text>
              )}
            </g>
          ))}
          {hit && (
            <g aria-hidden>
              <line x1={x(hit.drop)} x2={x(hit.drop)} y1={PAD.t} y2={PAD.t + plotH} className="stroke-muted-foreground" strokeWidth={1} />
              {(['base', 'stress'] as const).map((key, n) => (
                <circle key={key} cx={x(hit.drop)} cy={y(hit[key])} r={4} fill={`var(--viz-${n + 1})`} stroke="var(--card)" strokeWidth={2} />
              ))}
            </g>
          )}
          <rect x={PAD.l} y={PAD.t} width={plotW} height={plotH} fill="transparent" style={{ touchAction: 'pan-y' }} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setIndex(null)} />
        </svg>
        {hit && (
          <div
            className="pointer-events-none absolute z-10 min-w-[11rem] rounded-lg border border-border bg-card px-3 py-2 text-[12px] shadow-md"
            style={{ top: PAD.t, left: x(hit.drop), transform: flip ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)' }}
          >
            <p className="text-muted-foreground">
              Снижение {hit.drop} % · цена {rubles(hit.price)}
            </p>
            {(['base', 'stress'] as const).map((key, n) => (
              <p key={key} className="mt-1 flex items-center gap-2">
                <span className="h-0.5 w-3 rounded-full" style={{ background: `var(--viz-${n + 1})` }} aria-hidden />
                <span className="text-muted-foreground">{key === 'base' ? 'Базовый' : 'Стресс'}</span>
                <strong className="ml-auto font-mono font-semibold">{rubles(hit[key])}</strong>
              </p>
            ))}
          </div>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">Снижение от начальной цены ({rubles(points[0].price)}) → прибыль, ₽</p>
      {curve.marks.length > 0 && (
        <p className="text-[12px] text-muted-foreground">
          {curve.marks.map((m) => `${m.label} ${rubles(m.price)} (на ${percent(m.drop)} ниже начальной)`).join(' · ')}
        </p>
      )}
      <details className="text-[12px]">
        <summary className="cursor-pointer text-muted-foreground">Таблица значений</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[20rem] border-collapse">
            <thead>
              <tr className="text-left text-muted-foreground">
                {['Снижение', 'Цена', 'Базовый', 'Стресс'].map((h) => (
                  <th key={h} className="border-b border-border px-2 py-1.5 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.drop}>
                  <td className="px-2 py-1.5">{p.drop} %</td>
                  <td className="px-2 py-1.5 font-mono">{rubles(p.price)}</td>
                  <td className={`px-2 py-1.5 font-mono ${p.base < 0 ? 'text-danger' : ''}`}>{rubles(p.base)}</td>
                  <td className={`px-2 py-1.5 font-mono ${p.stress < 0 ? 'text-danger' : ''}`}>{rubles(p.stress)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

export function AnalyticsChart({ econ, estimate, ric, matrix }: { econ: EconResult; estimate: EstimateResult; ric: RicResult | null; matrix?: MatrixSummary }) {
  const shares = riskShares(estimate);
  const curve = profitCurve(econ);
  return (
    <div className="space-y-6 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <CertaintyBadge kind="estimate" />
        <HelpTip
          align="start"
          content="Все проценты и суммы считает программа из ваших затрат, условий договора и допущений, которые видно и можно поменять в блоках выше. Это оценка «если случится», а не прогноз. Каждое значение есть и текстом."
        />
      </div>
      <Facts econ={econ} estimate={estimate} ric={ric} matrix={matrix} />
      <PriceSection econ={econ} />
      <RiskSection shares={shares} />
      {curve && <CurveSection curve={curve} />}
      <p className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
        Шансы на победу и проверки заказчика — <Soon />
        <HelpTip align="start" content="Процент победы не показываем: для него нужна история торгов." />
      </p>
    </div>
  );
}
