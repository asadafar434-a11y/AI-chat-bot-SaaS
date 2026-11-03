import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { cx } from './ui';

// Графики проверки контрагента: кольцо, столбики по годам, линия-тренд, полосы и счётчик числа. Всё нарисовано здесь, без библиотек.
// Анимация — переход из «пусто» в «готово» (CSS transition), запускается, когда блок попал в видимую часть экрана; при настройке системы
// «уменьшить движение» и без IntersectionObserver всё показывается сразу. Цвета — токены темы (светлая и тёмная тема), а не жёсткие значения.

const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
export const VIZ = { revenue: 'var(--viz-1)', profit: 'var(--viz-2)', good: 'var(--success)', warn: 'var(--warn)', bad: 'var(--danger)' } as const;

const reduced = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const canAnimate = () => typeof window !== 'undefined' && !reduced() && typeof IntersectionObserver !== 'undefined';

/** [ref, готово]: «готово» становится true, когда элемент виден; без анимации — сразу true (и в разметке на сервере тоже). */
export function useReveal<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [on, setOn] = useState(() => !canAnimate());
  useEffect(() => {
    if (on) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setOn(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [on]);
  return [ref, on];
}

/** Число, которое «набегает» от нуля до значения (формат — функцией: единицы тысяч, млн, млрд меняются по пути, как у счётчика). */
export function CountUp({ to, format, ms = 1000 }: { to: number | null; format: (n: number | null) => string; ms?: number }) {
  const [ref, on] = useReveal<HTMLSpanElement>();
  const [value, setValue] = useState<number | null>(() => (canAnimate() ? 0 : to));
  const current = useRef<number>(value ?? 0);
  useEffect(() => {
    if (to === null) {
      setValue(null);
      return;
    }
    if (!on) return;
    if (reduced()) {
      current.current = to;
      setValue(to);
      return;
    }
    const from = current.current;
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - started) / ms);
      const next = from + (to - from) * (1 - Math.pow(1 - p, 3));
      current.current = next;
      setValue(next);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to, on, ms]);
  return <span ref={ref}>{format(value)}</span>;
}

export type Part = { value: number; color: string; label: string };

/** Кольцо из долей (сумма — 100 %): дуги вырисовываются по очереди. В центре — то, что передали. */
export function Ring({ parts, size = 132, stroke = 12, children, label }: { parts: Part[]; size?: number; stroke?: number; children?: ReactNode; label: string }) {
  const [ref, on] = useReveal<HTMLDivElement>();
  const width = (stroke / size) * 100; // толщина в единицах рисунка (он 100 × 100)
  const radius = 50 - width / 2;
  let start = 0;
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div ref={ref} className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="currentColor" strokeWidth={width} className="text-white/15" />
        {shown.map((p, i) => {
          const gap = shown.length > 1 ? 1.2 : 0;
          const length = Math.max(0, p.value - gap);
          const arc = (
            <circle
              key={p.label}
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={p.color}
              strokeWidth={width}
              pathLength={100}
              strokeDasharray={`${on ? length : 0} 100`}
              strokeDashoffset={-start}
              style={{ transition: `stroke-dasharray 900ms ${EASE} ${i * 160}ms` }}
            />
          );
          start += p.value;
          return arc;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

/** Горизонтальная полоса из долей: каждая доля вырастает по ширине. Подписи — снаружи (цвет не единственный признак). */
export function SegmentBar({ parts, label, height = 8 }: { parts: Part[]; label: string; height?: number }) {
  const [ref, on] = useReveal<HTMLDivElement>();
  const total = parts.reduce((sum, p) => sum + p.value, 0) || 1;
  return (
    <div ref={ref} className="flex gap-0.5 overflow-hidden rounded-full bg-secondary" style={{ height }} role="img" aria-label={label}>
      {parts
        .filter((p) => p.value > 0)
        .map((p, i) => (
          <span key={p.label} style={{ width: on ? `${(p.value / total) * 100}%` : 0, background: p.color, transition: `width 800ms ${EASE} ${i * 120}ms` }} />
        ))}
    </div>
  );
}

/** Мини-график по годам: линия вырисовывается, под ней — мягкая заливка, у последней точки — кружок. */
export function Spark({ values, color }: { values: (number | null)[]; color: string }) {
  const [ref, on] = useReveal<SVGSVGElement>();
  const rows = values.filter((v): v is number => v !== null);
  if (rows.length < 2) return null;
  const min = Math.min(...rows);
  const max = Math.max(...rows);
  const span = max - min || 1;
  const x = (i: number) => 3 + (i / (rows.length - 1)) * 94;
  const y = (v: number) => 27 - ((v - min) / span) * 22;
  const line = rows.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const lastX = x(rows.length - 1);
  const lastY = y(rows[rows.length - 1]);
  return (
    <svg ref={ref} viewBox="0 0 100 32" className="h-10 w-full overflow-visible" aria-hidden="true">
      <polygon points={`3,30 ${line} ${lastX},30`} fill={color} style={{ opacity: on ? 0.14 : 0, transition: `opacity 700ms ease 500ms` }} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        pathLength={1}
        strokeDasharray="1"
        strokeDashoffset={on ? 0 : 1}
        style={{ transition: `stroke-dashoffset 1100ms ${EASE}` }}
      />
      <circle cx={lastX} cy={lastY} r="2.2" fill={color} stroke="var(--card)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" style={{ opacity: on ? 1 : 0, transition: 'opacity 400ms ease 900ms' }} />
    </svg>
  );
}

export type BarSeries = { name: string; color: string };
export type BarRow = { label: string; values: (number | null)[] };

/**
 * Столбики по годам, до двух рядов: ниже нуля — вниз (убыток); столбики вырастают от нулевой линии, при наведении или фокусе —
 * подсказка со всеми значениями года. Тонкие столбики, скруглённый конец от нуля, у каждого ряда своя подпись в легенде над графиком.
 */
export function GroupedBars({ rows, series, format, axisFormat = format, label }: { rows: BarRow[]; series: BarSeries[]; format: (n: number | null) => string; axisFormat?: (n: number | null) => string; label: string }) {
  const [ref, on] = useReveal<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const all = rows.flatMap((r) => r.values).filter((v): v is number => v !== null);
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const range = max - min || 1;
  const zero = (-min / range) * 100; // положение нулевой линии снизу, %
  const tip = hover === null ? null : rows[hover];
  const tipLeft = hover === null ? 0 : Math.min(82, Math.max(18, ((hover + 0.5) / rows.length) * 100));
  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
        {series.map((s) => (
          <li key={s.name} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
            {s.name}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <div className="relative w-16 shrink-0 text-right font-mono text-[10px] text-muted-foreground" aria-hidden>
          <span className="absolute right-0 top-0 -translate-y-1/2">{max > 0 ? axisFormat(max) : ''}</span>
          <span className="absolute right-0 -translate-y-1/2" style={{ bottom: `${zero}%` }}>
            0
          </span>
          <span className="absolute bottom-0 right-0 translate-y-1/2">{min < 0 ? axisFormat(min) : ''}</span>
        </div>
        <div ref={ref} className="relative h-52 min-w-0 flex-1" role="img" aria-label={label}>
          <div className="absolute inset-x-0 top-0 border-t border-dashed border-border/70" aria-hidden />
          <div className="absolute inset-x-0 border-t border-border" style={{ bottom: `${zero}%` }} aria-hidden />
          {min < 0 && <div className="absolute inset-x-0 bottom-0 border-t border-dashed border-border/70" aria-hidden />}
          <div className="absolute inset-0 flex">
            {rows.map((row, i) => (
              <div
                key={row.label}
                tabIndex={0}
                aria-label={`${row.label}: ${series.map((s, k) => `${s.name} ${format(row.values[k] ?? null)}`).join(', ')}`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                onFocus={() => setHover(i)}
                onBlur={() => setHover((h) => (h === i ? null : h))}
                className={cx('relative flex min-w-0 flex-1 items-stretch justify-center gap-1 rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring', hover === i && 'bg-secondary/70')}
              >
                {series.map((s, k) => {
                  const v = row.values[k];
                  if (v === null || v === undefined) return <span key={s.name} className="w-full max-w-5" />;
                  const positive = v >= 0;
                  const height = `${(Math.abs(v) / range) * 100}%`;
                  return (
                    <span key={s.name} className="relative w-full max-w-5">
                      <span
                        className="absolute inset-x-0 min-h-[2px]"
                        style={{
                          background: s.color,
                          height,
                          ...(positive ? { bottom: `${zero}%`, borderRadius: '4px 4px 0 0', transformOrigin: 'bottom' } : { top: `${100 - zero}%`, borderRadius: '0 0 4px 4px', transformOrigin: 'top' }),
                          transform: `scaleY(${on ? 1 : 0})`,
                          transition: `transform 800ms ${EASE} ${i * 90 + k * 50}ms`,
                        }}
                      />
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
          {tip && (
            <div className="animate-tip pointer-events-none absolute top-0 z-10 w-max max-w-[220px] -translate-x-1/2 rounded-lg border border-border bg-card px-3 py-2 text-[12px] shadow-[var(--hover-shadow)]" style={{ left: `${tipLeft}%` }} role="status">
              <p className="mb-1 font-semibold">{tip.label}</p>
              {series.map((s, k) => (
                <p key={s.name} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="size-2 rounded-sm" style={{ background: s.color }} aria-hidden />
                    {s.name}
                  </span>
                  <span className={cx('font-mono', (tip.values[k] ?? 0) < 0 && 'text-danger')}>{format(tip.values[k] ?? null)}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex gap-2" aria-hidden>
        <span className="w-16 shrink-0" />
        <div className="flex min-w-0 flex-1">
          {rows.map((row, i) => (
            <span key={row.label} className={cx('min-w-0 flex-1 text-center font-mono text-[11px] transition-colors', hover === i ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
              {row.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
