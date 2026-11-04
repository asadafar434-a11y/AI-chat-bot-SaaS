import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  accountBlocking,
  lookupOf,
  notFound,
  SEARCH_MODES,
  SOURCE_NAMES,
  statusTone,
  thousandsText,
  type CounterpartyReport,
  type SearchHit,
  type SearchMode,
  type Tone as ReportTone,
} from '@/lib/counterparty';
import {
  Building2,
  CheckCircle2,
  ExternalLink,
  Globe,
  Lock,
  Mail,
  PackageCheck,
  Phone,
  Scale,
  Search,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Wallet,
} from '../lib/icons';
import { CertaintyBadge } from './Certainty';
import { CountUp, GroupedBars, Ring, SegmentBar, Spark, VIZ, type BarRow } from './CounterpartyViz';
import { Alert, DataTable, TBody, THead, Td, Th, Tr } from './data';
import { Badge, Button, Card, Chip, cx, Dot, HelpTip, Tooltip, type Tone, fieldBase } from './ui';

// «Проверка контрагента» (ИНН, ОГРН, название, ФИО) в «Аналитике»: организация, статус и отчётность из открытых реестров или Checko API.
// Показываем то, что написал реестр, с датой; вывода «надёжен» нет. Оценка Checko подписана как мнение сервиса.
// Оформление — шапка с кольцом, карточки-показатели со счётчиками и мини-графиками, столбики по годам, диаграммы дел и долга; цифры считает сервер,
// графики рисуются в CounterpartyViz.tsx и оживают, когда попадают на экран (при «уменьшить движение» — сразу готовые).

const TONE: Record<ReportTone, Tone> = { good: 'success', warn: 'warn', danger: 'danger', muted: 'neutral' };
const inputClass = `h-9 w-full px-3 font-mono text-ui placeholder:font-sans ${fieldBase}`;
const ROLE: Record<'plaintiff' | 'defendant' | 'other', string> = { plaintiff: 'истец', defendant: 'ответчик', other: 'участник' };

const when = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const day = (iso: string) => iso.split('-').reverse().join('.');
const rub = (value: number | null) => (value === null ? '—' : thousandsText(Math.round(value / 10) / 100));
const axis = (n: number | null) => thousandsText(n === null ? null : Math.round(n)).replace(/[\s\u00A0\u202F]*₽/, '');
const pct = (current: number | null, previous: number | null): number | null => {
  if (current === null || previous === null || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
};
/** Появление блока снизу со ступенькой по порядку: блоки отчёта выезжают по очереди. */
const rise = (index: number): CSSProperties => ({ animationDelay: `${index * 70}ms` });

function Money({ valueK }: { valueK: number | null }) {
  return <span className={cx('tabular-nums', valueK !== null && valueK < 0 && 'text-danger')}>{thousandsText(valueK)}</span>;
}

// Шапка отчёта: стеклянные плашки на тёмном фоне. Статус — цветная точка и слова (у «Действующее» точка пульсирует), цвет — не единственный признак.
const GLASS = 'bg-white/[0.08] ring-1 ring-inset ring-white/[0.14] backdrop-blur-sm';
const STATUS_LOOK: Record<ReportTone, { pill: string; dot: string }> = {
  good: { pill: 'bg-[#4ade80]/15 text-[#d1fae5] ring-[#4ade80]/40', dot: 'bg-[#4ade80]' },
  warn: { pill: 'bg-[#facc15]/15 text-[#fef3c7] ring-[#facc15]/40', dot: 'bg-[#facc15]' },
  danger: { pill: 'bg-[#f87171]/20 text-[#fee2e2] ring-[#f87171]/50', dot: 'bg-[#f87171]' },
  muted: { pill: 'bg-white/10 text-white/85 ring-white/25', dot: 'bg-white/70' },
};

function StatusPill({ tone, children }: { tone: ReportTone; children: ReactNode }) {
  const look = STATUS_LOOK[tone];
  return (
    <span data-tone={tone} className={cx('inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1 text-caption font-medium leading-snug ring-1 ring-inset backdrop-blur-sm', look.pill)}>
      <span className="relative flex size-2 shrink-0" aria-hidden>
        {tone === 'good' && <span className={cx('absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:animate-none', look.dot)} />}
        <span className={cx('relative inline-flex size-2 rounded-full', look.dot)} />
      </span>
      <span className="min-w-0 break-words">{children}</span>
    </span>
  );
}

function ConfirmedPill() {
  return (
    <Tooltip content="Сведения взяты из реестров на дату проверки, не выведены программой." side="bottom" align="start">
      <span className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-caption font-medium text-white/85', GLASS)}>
        <CheckCircle2 className="size-3.5 text-[#8cc8ff]" />
        Подтверждено
      </span>
    </Tooltip>
  );
}

function HeroChip({ children }: { children: ReactNode }) {
  return <span className={cx('rounded-full px-2.5 py-1 text-micro text-white/80', GLASS)}>{children}</span>;
}

function Metric({ icon, label, value, hint, delta, danger, spark, accent }: { icon: ReactNode; label: string; value: ReactNode; hint?: string; delta?: number | null; danger?: boolean; spark?: ReactNode; accent: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-4">
      <span aria-hidden className="absolute inset-x-0 top-0 h-0.5" style={{ background: accent }} />
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-caption font-medium text-muted-foreground">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md" style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}>
            {icon}
          </span>
          <span className="truncate">{label}</span>
        </p>
        {delta !== null && delta !== undefined && (
          <span className={cx('shrink-0 rounded-full px-1.5 py-0.5 text-micro font-medium tabular-nums', delta >= 0 ? 'bg-success-surface text-success' : 'bg-danger-surface text-danger')}>
            {delta >= 0 ? '▲ +' : '▼ −'}
            {Math.abs(delta).toLocaleString('ru-RU')}%
          </span>
        )}
      </div>
      <p className={cx('mt-2 break-words text-2xl font-semibold tracking-tight', danger && 'text-danger')}>{value}</p>
      {hint && <p className="mt-0.5 text-micro text-muted-foreground">{hint}</p>}
      {spark && <div className="mt-2">{spark}</div>}
    </div>
  );
}

const CHECK_BADGE: Record<ReportTone, { tone: Tone; text: string }> = { danger: { tone: 'danger', text: 'Риск' }, warn: { tone: 'warn', text: 'Внимание' }, good: { tone: 'success', text: 'Чисто' }, muted: { tone: 'neutral', text: '—' } };

function CheckRow({ icon, label, text, tone, index }: { icon: ReactNode; label: string; text: string; tone: ReportTone; index: number }) {
  const circle = tone === 'danger' ? 'bg-danger-surface text-danger' : tone === 'warn' ? 'bg-warn-surface text-warn-foreground' : 'bg-success-surface text-success';
  const box = tone === 'danger' ? 'border-danger/40 bg-danger-surface/50' : tone === 'warn' ? 'border-warn/40' : 'border-border';
  const badge = CHECK_BADGE[tone];
  return (
    <li className={cx('animate-fade-up flex items-start gap-2.5 rounded-lg border p-3', box)} style={rise(index)}>
      <span className={cx('flex size-7 shrink-0 items-center justify-center rounded-full', circle)}>{icon}</span>
      <p className="min-w-0 flex-1 break-words text-caption">
        <span className="text-muted-foreground">{label}: </span>
        <span className={cx(tone === 'danger' && 'font-semibold text-danger', tone === 'warn' && 'font-medium')}>{text}</span>
      </p>
      <span className="shrink-0">
        <Badge tone={badge.tone} dot>
          {badge.text}
        </Badge>
      </span>
    </li>
  );
}

/** Столбики по годам с переключателем: выручка и прибыль или активы и капитал. Таблица со всеми цифрами — под графиком. */
function FinanceChart({ byYear, sorted }: { byYear: CounterpartyReport['statements']; sorted: CounterpartyReport['statements'] }) {
  const [pair, setPair] = useState<'result' | 'balance'>('result');
  const shown = byYear.slice(-6);
  const rows: BarRow[] = shown.map((s) => ({ label: String(s.year), values: pair === 'result' ? [s.revenue, s.netProfit] : [s.assets, s.equity] }));
  const series = pair === 'result' ? [{ name: 'Выручка', color: VIZ.revenue }, { name: 'Чистая прибыль', color: VIZ.profit }] : [{ name: 'Активы', color: VIZ.revenue }, { name: 'Капитал', color: VIZ.profit }];
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <p className="text-ui font-semibold">Финансовая отчётность</p>
          <p className="text-caption text-muted-foreground">
            ГИР БО ФНС · {sorted[sorted.length - 1].year}–{sorted[0].year}
          </p>
        </div>
        {sorted.length > 1 && (
          <div className="flex gap-1.5" role="group" aria-label="Что показать на графике">
            <Chip label="Выручка и прибыль" on={pair === 'result'} onClick={() => setPair('result')} />
            <Chip label="Активы и капитал" on={pair === 'balance'} onClick={() => setPair('balance')} />
          </div>
        )}
      </div>
      {sorted.length > 1 && (
        <div className="p-4">
          <GroupedBars rows={rows} series={series} format={thousandsText} axisFormat={axis} label={`${series.map((s) => s.name).join(' и ')} по годам, ${shown[0].year}–${shown[shown.length - 1].year}`} />
        </div>
      )}
      <div className="border-t border-border">
        <DataTable bare minWidth={760} caption="Бухгалтерская отчётность (ГИР БО ФНС)">
          <THead>
            <tr>
              <Th>Год</Th>
              <Th align="right">Выручка</Th>
              <Th align="right">к прошлому году</Th>
              <Th align="right">Чистая прибыль</Th>
              <Th align="right">Рентабельность</Th>
              <Th align="right">Активы</Th>
              <Th align="right">Капитал</Th>
              <Th align="right">Капитал / активы</Th>
            </tr>
          </THead>
          <TBody>
            {sorted.map((s, i) => {
              const growth = pct(s.revenue, sorted[i + 1]?.revenue ?? null);
              const margin = s.revenue !== null && s.revenue !== 0 && s.netProfit !== null ? Math.round((s.netProfit / s.revenue) * 1000) / 10 : null;
              const cover = s.assets !== null && s.assets !== 0 && s.equity !== null ? Math.round((s.equity / s.assets) * 1000) / 10 : null;
              return (
                <Tr key={s.year} selected={i === 0}>
                  <Td strong className="whitespace-nowrap">{s.year}</Td>
                  <Td num>
                    <Money valueK={s.revenue} />
                  </Td>
                  <Td num tone={growth === null || growth === 0 ? 'muted' : growth > 0 ? 'success' : 'danger'}>
                    {signedPct(growth)}
                  </Td>
                  <Td num>
                    <Money valueK={s.netProfit} />
                  </Td>
                  <Td num tone={margin === null ? 'muted' : margin < 0 ? 'danger' : 'neutral'}>
                    {margin === null ? '—' : percentText(margin)}
                  </Td>
                  <Td num>
                    <Money valueK={s.assets} />
                  </Td>
                  <Td num>
                    <Money valueK={s.equity} />
                  </Td>
                  <Td num tone={cover === null ? 'muted' : cover < 0 ? 'danger' : 'neutral'}>
                    {cover === null ? '—' : percentText(cover)}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </DataTable>
      </div>
    </div>
  );
}

/** Процент с настоящим минусом «−» (toLocaleString даёт дефис). */
const percentText = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('ru-RU')} %`;
const signedPct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('ru-RU')} %`);
const yearOf = (iso: string | null) => (iso ? iso.slice(0, 4) : null);

export function CounterpartyReportView({ report }: { report: CounterpartyReport }) {
  const failed = Object.entries(report.sources).flatMap(([, s]) => (s?.ok ? [] : [s?.reason ?? 'источник не ответил']));
  const sourceNames = Object.entries(report.sources)
    .map(([id]) => SOURCE_NAMES[id as keyof typeof SOURCE_NAMES])
    .join(', ');
  const empty = notFound(report);
  const rel = report.reliability;
  const blocking = accountBlocking(rel);
  const nominalTone: Tone = rel?.nominality.level === 1 ? 'success' : rel?.nominality.level === 3 ? 'danger' : 'warn';
  const financialTone: Tone = rel?.financial.level === 1 ? 'success' : rel?.financial.level !== null && rel?.financial.level !== undefined && rel.financial.level >= 4 ? 'danger' : 'warn';
  const sorted = [...report.statements].sort((a, b) => b.year - a.year);
  const last = sorted[0] ?? null;
  const prev = sorted[1] ?? null;
  const byYear = [...sorted].reverse();
  const revenueDelta = last && prev ? pct(last.revenue, prev.revenue) : null;
  const profitDelta = last && prev ? pct(last.netProfit, prev.netProfit) : null;
  const equityDelta = last && prev ? pct(last.equity, prev.equity) : null;
  const courts = report.courts && report.courts.cases.length > 0 ? report.courts : null;
  const enforcements = report.enforcements && report.enforcements.items.length > 0 ? report.enforcements : null;
  const hasCases = Boolean(courts || enforcements);
  const criticalFacts = report.facts.filter((f) => f.tone === 'danger');
  const otherFacts = report.facts.filter((f) => f.tone !== 'danger');
  const hasChecks = Boolean(report.rnp || report.efrsb || report.sanctions || blocking);
  const factors = rel ? [...rel.factors].sort((a, b) => ({ danger: 0, warn: 1, good: 2, muted: 3 })[a.tone] - { danger: 0, warn: 1, good: 2, muted: 3 }[b.tone]) : [];

  // Дела по годам: сколько их было заведено в каждом из последних лет, где они есть.
  const casesByYear = (() => {
    if (!courts) return [] as BarRow[];
    const counts = new Map<string, number>();
    for (const c of courts.cases) {
      const y = yearOf(c.date);
      if (y) counts.set(y, (counts.get(y) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-6).map(([label, n]) => ({ label, values: [n] }));
  })();

  return (
    <div className="space-y-3">
      {empty ? (
        <p className="text-ui">
          <span className="font-semibold">Организации с ИНН {report.inn} в реестрах не нашлось.</span> Проверьте цифры ИНН: контрольная сумма сходится, но такой записи нет.
        </p>
      ) : (
        <>
          <div
            className="animate-fade-up relative overflow-hidden rounded-2xl border border-white/10 p-4 text-white sm:p-6"
            style={{
              background:
                'radial-gradient(70% 130% at 100% 0%, rgba(47,91,255,0.55) 0%, transparent 62%), radial-gradient(55% 90% at 0% 100%, rgba(122,77,255,0.30) 0%, transparent 62%), linear-gradient(135deg, #080f27 0%, #0c1b4d 100%)',
            }}
          >
            <div aria-hidden className="pointer-events-none absolute inset-0 opacity-70 [background-image:radial-gradient(rgba(255,255,255,0.09)_1px,transparent_1px)] [background-size:20px_20px] [mask-image:linear-gradient(115deg,transparent_25%,black_100%)]" />
            <div aria-hidden className="cp-float pointer-events-none absolute -right-12 -top-20 size-56 rounded-full bg-[#2F5BFF]/30 blur-3xl" />
            <div aria-hidden className="cp-float-slow pointer-events-none absolute -bottom-24 left-1/3 size-48 rounded-full bg-[#7a4dff]/20 blur-3xl" />
            <div className="relative flex flex-col gap-5 sm:flex-row sm:items-stretch sm:justify-between">
              <div className="min-w-0 flex-1 space-y-3.5">
                <div className="flex flex-wrap items-center gap-2 text-micro text-white/60">
                  <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-white/85', GLASS)}>
                    <ShieldCheck className="size-3.5 text-[#8cc8ff]" />
                    Проверка контрагента
                  </span>
                  <span className="font-mono">{when(report.at)}</span>
                </div>
                <p className="break-words text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{report.name}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {report.status && <StatusPill tone={report.status.tone}>{report.status.text}</StatusPill>}
                  <ConfirmedPill />
                </div>
                <p className="break-words font-mono text-caption text-white/55">
                  ИНН <span className="text-white/90">{report.inn}</span>
                  {report.identity?.ogrn && (
                    <>
                      {' · ОГРН '}
                      <span className="text-white/90">{report.identity.ogrn}</span>
                    </>
                  )}
                  {report.identity?.kpp && (
                    <>
                      {' · КПП '}
                      <span className="text-white/90">{report.identity.kpp}</span>
                    </>
                  )}
                </p>
                {(report.address || report.identity?.region) && <p className="break-words text-caption leading-relaxed text-white/60">{report.address ?? report.identity?.region}</p>}
                {(report.msp || report.staff !== null || report.taxes || rel) && (
                  <div className="flex flex-wrap gap-1.5">
                    {report.msp && <HeroChip>{report.msp.category}</HeroChip>}
                    {report.staff !== null && report.staff !== undefined && <HeroChip>сотрудников: {report.staff}</HeroChip>}
                    {report.taxes && report.taxes.regimes.length > 0 && <HeroChip>{report.taxes.regimes.join(' · ')}</HeroChip>}
                    {rel?.scale !== null && rel?.scale !== undefined && <HeroChip>масштаб {rel.scale}/100</HeroChip>}
                  </div>
                )}
              </div>
              {rel && (
                <div className={cx('flex shrink-0 flex-col items-center justify-center gap-2.5 rounded-2xl px-5 py-4', GLASS)}>
                  <Ring
                    label={`Факторы надёжности по Checko: положительных ${rel.balance.good}%, требующих внимания ${rel.balance.warn}%, негативных ${rel.balance.bad}%`}
                    parts={[
                      { value: rel.balance.good, color: '#4ade80', label: 'положительные' },
                      { value: rel.balance.warn, color: '#facc15', label: 'внимание' },
                      { value: rel.balance.bad, color: '#f87171', label: 'негативные' },
                    ]}
                  >
                    <span className="font-mono text-3xl font-semibold leading-none">
                      <CountUp to={rel.balance.good} format={(n) => `${Math.round(n ?? 0)}%`} />
                    </span>
                    <span className="mt-1 text-nano leading-tight text-white/70">
                      положительных
                      <br />
                      факторов
                    </span>
                  </Ring>
                  <ul className="flex gap-3 text-micro text-white/80">
                    <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#4ade80]" aria-hidden /><span className="sr-only">положительные </span>{rel.balance.good}%</li>
                    <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#facc15]" aria-hidden /><span className="sr-only">внимание </span>{rel.balance.warn}%</li>
                    <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#f87171]" aria-hidden /><span className="sr-only">негативные </span>{rel.balance.bad}%</li>
                  </ul>
                </div>
              )}
            </div>
          </div>

          {criticalFacts.length > 0 && (
            <div className="animate-fade-up" style={rise(1)}>
              <Alert tone="danger" title={`Критичные находки: ${criticalFacts.length}`}>
                <ul className="space-y-0.5">
                  {criticalFacts.map((f) => (
                    <li key={f.id} className="break-words">
                      <span className="font-semibold text-danger">{f.label}: </span>
                      {f.text}
                    </li>
                  ))}
                </ul>
              </Alert>
            </div>
          )}

          {otherFacts.length > 0 && (
            <div className="animate-fade-up grid gap-x-4 gap-y-1.5 rounded-xl border border-border bg-card p-3 text-ui sm:grid-cols-2" style={rise(1)}>
              {otherFacts.map((f) => (
                <div key={f.id} className="flex items-start gap-2">
                  <span className="flex h-5 shrink-0 items-center">
                    <Dot tone={TONE[f.tone]} />
                  </span>
                  <span className="min-w-0 break-words">
                    <span className="text-muted-foreground">{f.label}: </span>
                    <span className={cx(f.tone === 'danger' && 'font-semibold text-danger', f.tone === 'warn' && 'font-semibold')}>{f.text}</span>
                  </span>
                </div>
              ))}
            </div>
          )}

          {last && (
            <div className="animate-fade-up grid gap-3 sm:grid-cols-2 xl:grid-cols-4" style={rise(2)}>
              <Metric accent={VIZ.revenue} icon={<TrendingUp className="size-3.5" />} label="Выручка" value={<CountUp to={last.revenue} format={thousandsText} />} hint={last.year ? `за ${last.year} год` : undefined} delta={revenueDelta} spark={<Spark values={byYear.map((s) => s.revenue)} color={VIZ.revenue} />} />
              <Metric
                accent={VIZ.profit}
                icon={last.netProfit !== null && last.netProfit < 0 ? <TrendingDown className="size-3.5" /> : <TrendingUp className="size-3.5" />}
                label="Чистая прибыль"
                value={<CountUp to={last.netProfit} format={thousandsText} />}
                hint={last.year ? `за ${last.year} год` : undefined}
                delta={profitDelta}
                danger={last.netProfit !== null && last.netProfit < 0}
                spark={<Spark values={byYear.map((s) => s.netProfit)} color={VIZ.profit} />}
              />
              <Metric accent="#7C3AED" icon={<Wallet className="size-3.5" />} label="Капитал" value={<CountUp to={last.equity} format={thousandsText} />} hint={last.year ? `на конец ${last.year} года` : undefined} delta={equityDelta} danger={last.equity !== null && last.equity < 0} spark={<Spark values={byYear.map((s) => s.equity)} color="#7C3AED" />} />
              <Metric accent="#0EA5E9" icon={<Building2 className="size-3.5" />} label="Активы" value={<CountUp to={last.assets} format={thousandsText} />} hint={last.year ? `на конец ${last.year} года` : undefined} spark={<Spark values={byYear.map((s) => s.assets)} color="#0EA5E9" />} />
            </div>
          )}

          {sorted.length > 0 && (
            <div className="animate-fade-up" style={rise(3)}>
              <FinanceChart byYear={byYear} sorted={sorted} />
            </div>
          )}

          {rel && (
            <div className="animate-fade-up rounded-xl border border-border bg-card p-4" style={rise(4)}>
              <p className="flex items-center gap-2 text-ui font-semibold">
                <ShieldCheck className="size-4 text-[#2F5BFF]" />
                <span>
                  Оценка надёжности <span className="font-normal text-muted-foreground">— расчёт Checko, не наше заключение</span>
                </span>
              </p>
              <div className="mt-3 grid gap-2 text-caption sm:grid-cols-3">
                <p className="rounded-lg bg-surface-sunken p-3">
                  <span className="block text-muted-foreground">Масштаб бизнеса:</span> <b className="text-subtitle tabular-nums text-foreground">{rel.scale ?? '—'}</b> из 100
                </p>
                <p className="rounded-lg bg-surface-sunken p-3">
                  <span className="block text-muted-foreground">Риск номинальности:</span> <b className={cx(nominalTone === 'danger' && 'text-danger', nominalTone === 'warn' && 'text-warn-foreground', nominalTone === 'success' && 'text-success')}>{rel.nominality.text ?? '—'}</b>
                </p>
                <p className="rounded-lg bg-surface-sunken p-3">
                  <span className="block text-muted-foreground">Финансовые риски:</span> <b className={cx(financialTone === 'danger' && 'text-danger', financialTone === 'warn' && 'text-warn-foreground', financialTone === 'success' && 'text-success')}>{rel.financial.text ?? '—'}</b>
                </p>
              </div>
              <div className="mt-3 space-y-1.5">
                <SegmentBar
                  label={`Баланс факторов: положительных ${rel.balance.good}%, требующих внимания ${rel.balance.warn}%, негативных ${rel.balance.bad}%`}
                  height={10}
                  parts={[
                    { value: rel.balance.good, color: VIZ.good, label: 'положительные' },
                    { value: rel.balance.warn, color: VIZ.warn, label: 'внимание' },
                    { value: rel.balance.bad, color: VIZ.bad, label: 'негативные' },
                  ]}
                />
                <p className="text-caption text-muted-foreground">
                  Полож {rel.balance.good}% · Внимание {rel.balance.warn}% · Негатив {rel.balance.bad}%
                </p>
              </div>
              {factors.length > 0 && (
                <details className="mt-2 text-caption" open={factors.length <= 6}>
                  <summary className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground">Факторы: {factors.length}</summary>
                  <ul className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                    {factors.map((f, i) => (
                      <li key={`${f.code ?? 'factor'}-${i}`} className="flex items-start gap-2">
                        <span className="flex h-5 shrink-0 items-center">
                          <Dot tone={TONE[f.tone]} />
                        </span>
                        <span className="min-w-0 break-words">{f.text}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {(hasCases || hasChecks) && (
            <div className={cx('animate-fade-up grid grid-cols-1 items-start gap-3', hasCases && hasChecks && 'lg:grid-cols-2')} style={rise(5)}>
              {hasCases && (
                <div className="space-y-3">
                  {courts && (
                    <div className="overflow-hidden rounded-xl border border-border bg-card">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
                        <p className="flex items-center gap-2 text-ui font-semibold">
                          <Scale className="size-4 text-[#2F5BFF]" />
                          Арбитражные дела
                        </p>
                        <p className="text-caption text-muted-foreground">
                          КАД: {courts.total}, ответчик — {courts.defendant}
                        </p>
                      </div>
                      <div className="space-y-2 px-3 pt-3">
                        <SegmentBar
                          label={`Роль в делах: ответчик ${courts.defendant}, истец ${courts.plaintiff}, другое ${Math.max(0, courts.cases.length - courts.defendant - courts.plaintiff)}`}
                          parts={[
                            { value: courts.defendant, color: VIZ.warn, label: 'ответчик' },
                            { value: courts.plaintiff, color: VIZ.revenue, label: 'истец' },
                            { value: Math.max(0, courts.cases.length - courts.defendant - courts.plaintiff), color: 'var(--muted-foreground)', label: 'участник' },
                          ]}
                        />
                        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-micro text-muted-foreground">
                          <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: VIZ.warn }} />ответчик {courts.defendant}</span>
                          <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: VIZ.revenue }} />истец {courts.plaintiff}</span>
                          {courts.active > 0 && <span>рассматривается: {courts.active}</span>}
                          {courts.claimSum !== null && <span>сумма исков {rub(courts.claimSum)}</span>}
                        </p>
                        {casesByYear.length > 1 && (
                          <div className="pt-1">
                            <GroupedBars rows={casesByYear} series={[{ name: 'Дел в году', color: VIZ.revenue }]} format={(n) => String(n ?? 0)} label="Число арбитражных дел по годам" integer />
                          </div>
                        )}
                      </div>
                      <div className="mt-2 border-t border-border">
                        <DataTable bare minWidth={420} caption="Арбитражные дела">
                          <THead>
                            <tr>
                              <Th>Дело</Th>
                              <Th>Дата</Th>
                              <Th>Роль</Th>
                              <Th align="right">Иск</Th>
                            </tr>
                          </THead>
                          <TBody>
                            {courts.cases.slice(0, 5).map((c) => (
                              <Tr key={`${c.number}-${c.date ?? ''}`}>
                                <Td className="break-words">
                                  {c.url ? (
                                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-2 hover:no-underline">
                                      {c.number}
                                    </a>
                                  ) : (
                                    <span className="font-medium">{c.number}</span>
                                  )}
                                  {c.opponent && <span className="block text-caption text-muted-foreground">{c.opponent}</span>}
                                </Td>
                                <Td tone="muted" className="whitespace-nowrap tabular-nums">
                                  {c.date ? day(c.date) : '—'}
                                </Td>
                                <Td>
                                  <span className="flex flex-wrap gap-1">
                                    <Badge tone={c.role === 'defendant' ? 'warn' : c.role === 'plaintiff' ? 'info' : 'neutral'}>{ROLE[c.role]}</Badge>
                                    {c.active && (
                                      <Badge tone="neutral" dot>
                                        рассматривается
                                      </Badge>
                                    )}
                                  </span>
                                </Td>
                                <Td num>{c.claimSum !== null ? rub(c.claimSum) : '—'}</Td>
                              </Tr>
                            ))}
                          </TBody>
                        </DataTable>
                      </div>
                      {courts.cases.length > 5 && <p className="px-3 pb-2.5 text-caption text-muted-foreground">Ещё {courts.cases.length - 5} — в картотеке.</p>}
                    </div>
                  )}
                  {enforcements && (
                    <div className="overflow-hidden rounded-xl border border-border bg-card">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
                        <p className="flex items-center gap-2 text-ui font-semibold">
                          <Wallet className="size-4 text-[#2F5BFF]" />
                          Исполнительные производства
                        </p>
                        <p className="text-caption text-muted-foreground">
                          ФССП: {enforcements.total}, остаток долга {rub(enforcements.outstandingSum)}
                        </p>
                      </div>
                      {enforcements.debtSum > 0 && (
                        <div className="space-y-1.5 px-3 pt-3">
                          <SegmentBar
                            label={`Долг по производствам: остаток ${rub(enforcements.outstandingSum)} из ${rub(enforcements.debtSum)}`}
                            parts={[
                              { value: Math.min(enforcements.outstandingSum, enforcements.debtSum), color: VIZ.bad, label: 'остаток' },
                              { value: Math.max(0, enforcements.debtSum - enforcements.outstandingSum), color: VIZ.good, label: 'погашено' },
                            ]}
                          />
                          <p className="flex flex-wrap gap-x-3 text-micro text-muted-foreground">
                            <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: VIZ.bad }} />остаток {rub(enforcements.outstandingSum)}</span>
                            <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: VIZ.good }} />погашено {rub(Math.max(0, enforcements.debtSum - enforcements.outstandingSum))}</span>
                          </p>
                        </div>
                      )}
                      <div className="mt-2 border-t border-border">
                        <DataTable bare minWidth={420} caption="Исполнительные производства">
                          <THead>
                            <tr>
                              <Th>Производство</Th>
                              <Th>Дата</Th>
                              <Th align="right">Остаток долга</Th>
                            </tr>
                          </THead>
                          <TBody>
                            {enforcements.items.slice(0, 5).map((e) => (
                              <Tr key={`${e.number ?? ''}-${e.date ?? ''}`}>
                                <Td className="break-words">
                                  <span className="font-medium">{e.number ?? '№ не указан'}</span>
                                  {e.subject && <span className="block text-caption text-muted-foreground">{e.subject}</span>}
                                </Td>
                                <Td tone="muted" className="whitespace-nowrap tabular-nums">
                                  {e.date ? day(e.date) : '—'}
                                </Td>
                                <Td num tone={e.outstanding !== null && e.outstanding > 0 ? 'danger' : 'neutral'}>
                                  {e.outstanding !== null ? rub(e.outstanding) : '—'}
                                </Td>
                              </Tr>
                            ))}
                          </TBody>
                        </DataTable>
                      </div>
                      {enforcements.items.length > 5 && <p className="px-3 pb-2.5 text-caption text-muted-foreground">Ещё {enforcements.items.length - 5}.</p>}
                    </div>
                  )}
                </div>
              )}

              {hasChecks && (
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  <div className="border-b border-border px-3 py-2.5">
                    <p className="text-ui font-semibold">Реестры и риски</p>
                  </div>
                  <ul className="grid gap-2 p-3">
                    {report.rnp && (
                      <CheckRow
                        index={0}
                        icon={<ShieldAlert className="size-3.5" />}
                        label="РНП (реестр недобросовестных поставщиков)"
                        tone={report.rnp.included ? 'danger' : 'good'}
                        text={
                          report.rnp.included
                            ? `включена в реестр${report.rnp.records.length > 0 ? `: ${report.rnp.records.length} зап.` : ''}${report.rnp.records[0]?.date ? `; последняя от ${day(report.rnp.records[0].date)}` : ''}${report.rnp.records[0]?.customer ? `, заказчик ${report.rnp.records[0].customer}` : ''}`
                            : 'не включена в реестр'
                        }
                      />
                    )}
                    {report.efrsb && (
                      <CheckRow
                        index={1}
                        icon={<PackageCheck className="size-3.5" />}
                        label="ЕФРСБ (реестр банкротств)"
                        tone={report.efrsb.length > 0 ? 'warn' : 'good'}
                        text={
                          report.efrsb.length === 0
                            ? 'нет сообщений о банкротстве'
                            : `${report.efrsb.length} сообщ.; последнее ${report.efrsb[0].date ? day(report.efrsb[0].date) : 'без даты'} — ${report.efrsb[0].type ?? 'без типа'}`
                        }
                      />
                    )}
                    {blocking && <CheckRow index={2} icon={<Lock className="size-3.5" />} label="Блокировка банковских счетов" tone={blocking.blocked ? 'danger' : 'good'} text={blocking.text} />}
                    {report.sanctions && (
                      <CheckRow
                        index={3}
                        icon={<ShieldAlert className="size-3.5" />}
                        label="Санкции"
                        tone={report.sanctions.included ? 'danger' : 'good'}
                        text={report.sanctions.included ? `входит в санкционные списки${report.sanctions.countries.length > 0 ? `: ${report.sanctions.countries.join(', ')}` : ''}` : 'не входит в санкционные списки'}
                      />
                    )}
                    {report.sanctions && (
                      <CheckRow
                        index={4}
                        icon={<Scale className="size-3.5" />}
                        label="Правило 50%"
                        tone={report.sanctions.founderLinked ? 'danger' : 'good'}
                        text={report.sanctions.founderLinked ? 'есть связь с подсанкционными участниками' : 'нет связей с подсанкционными участниками'}
                      />
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}

          {report.contacts && (report.contacts.phones.length > 0 || report.contacts.emails.length > 0 || report.contacts.website) && (
            <div className="animate-fade-up rounded-xl border border-border bg-card p-4" style={rise(6)}>
              <p className="text-ui font-semibold">
                Контакты <span className="font-normal text-muted-foreground">— из открытых источников</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {report.contacts.phones.map((p) => (
                  <a key={p} href={`tel:${p.replace(/[^\d+]/g, '')}`} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-caption transition-colors hover:bg-secondary">
                    <Phone className="size-3.5 text-muted-foreground" />
                    <span className="font-mono">{p}</span>
                  </a>
                ))}
                {report.contacts.emails.map((e) => (
                  <a key={e} href={`mailto:${e}`} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-caption transition-colors hover:bg-secondary">
                    <Mail className="size-3.5 text-muted-foreground" />
                    <span>{e}</span>
                  </a>
                ))}
                {report.contacts.website && (
                  <a href={report.contacts.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-caption transition-colors hover:bg-secondary">
                    <Globe className="size-3.5 text-muted-foreground" />
                    <span>{report.contacts.website}</span>
                  </a>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {failed.length > 0 && (
        <Alert tone="warn" title={`Не всё получилось: ${failed.join('; ')}.`}>
          Повторите проверку позже.
        </Alert>
      )}

      {report.links.length > 0 && (
        <div className="animate-fade-up rounded-xl border border-border bg-card p-4" style={rise(7)}>
          <p className="text-ui font-semibold">
            Проверить вручную <span className="font-normal text-muted-foreground">— без капчи эти реестры не отдают</span>
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {report.links.map((l) => (
              <li key={l.id} className="min-w-0">
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex h-full items-start gap-2.5 rounded-lg border border-border p-3 text-caption transition-colors hover:border-[#2F5BFF]/50 hover:bg-secondary/60"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#2F5BFF]/10 text-[#2F5BFF] transition-transform group-hover:scale-110">
                    <ExternalLink className="size-3.5" />
                  </span>
                  <span className="min-w-0 break-words">
                    <span className="block font-medium text-foreground underline-offset-2 group-hover:underline">{l.title}</span>
                    <span className="text-muted-foreground">{l.hint}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-caption text-muted-foreground">
        Данные {sourceNames} на {when(report.at)}. Это сведения реестров, а не заключение о надёжности.
      </p>
    </div>
  );
}

export type CounterpartyCardProps = {
  /** Что вписано в поле: ИНН, ОГРН, название или фамилия. */
  inn: string;
  onInn: (value: string) => void;
  onCheck: () => void;
  busy: boolean;
  /** Ошибка проверки или запроса — одной строкой. */
  error: string | null;
  report: CounterpartyReport | null;
  /** Что искать, когда вписан текст: организацию, ИП или руководителя. */
  mode?: SearchMode;
  onMode?: (mode: SearchMode) => void;
  /** Найденные по названию или ФИО: null — поиска не было, пусто — ничего не нашли. */
  hits?: SearchHit[] | null;
  /** Найдено больше, чем показано. */
  more?: boolean;
  onPick?: (hit: SearchHit) => void;
};

function HitRow({ hit, onPick, disabled }: { hit: SearchHit; onPick: () => void; disabled: boolean }) {
  const status = hit.status ? statusTone(hit.status) : null;
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={onPick}
        className="card-hover flex w-full flex-wrap items-start justify-between gap-x-3 gap-y-1 rounded-md border bg-card px-3 py-2.5 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold leading-snug">{hit.name}</span>
          <span className="mt-0.5 block text-caption text-muted-foreground">
            <span className="font-mono">ИНН {hit.inn}</span>
            {hit.ogrn && <span className="font-mono"> · {hit.kind === 'ent' ? 'ОГРНИП' : 'ОГРН'} {hit.ogrn}</span>}
            {hit.registered && <> · с {day(hit.registered)}</>}
            {hit.region && <> · регион {hit.region}</>}
          </span>
          {hit.address && <span className="mt-0.5 block text-caption text-muted-foreground">{hit.address}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {status && hit.status && (
            <Badge tone={TONE[status]} wrap>
              {hit.terminated ? `${hit.status} · ${day(hit.terminated)}` : hit.status}
            </Badge>
          )}
          <span className="text-ui font-medium text-primary">Проверить</span>
        </span>
      </button>
    </li>
  );
}

export function CounterpartyCard({ inn, onInn, onCheck, busy, error, report, mode = 'org', onMode, hits = null, more = false, onPick }: CounterpartyCardProps) {
  const text = lookupOf(inn).kind === 'text' && inn.trim() !== '';
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Search className="size-4" />
        <p className="text-sm font-bold">Проверка контрагента</p>
        <Badge tone="success">Бесплатно: без ИИ</Badge>
        <HelpTip
          align="start"
          content="Заказчик, поставщик, конкурент: впишите ИНН или ОГРН — или название организации, фамилию и имя ИП, фамилию руководителя. Программа за несколько секунд проверит открытые реестры (ЕГРЮЛ, Федресурс, бухгалтерская отчётность ГИР БО, КАД, ФССП и РНП — напрямую или через Checko API) и покажет, действует ли организация, нет ли банкротства, судов и долгов. По названию и ФИО ищет Checko: найденных покажем списком, нужного выбираете и проверяете. В реестры уходит только то, что вы вписали."
        />
      </div>
      <form
        className="flex flex-wrap items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) onCheck();
        }}
      >
        <label className="min-w-[200px] flex-1 text-caption">
          <span className="sr-only">ИНН, ОГРН, название организации или фамилия</span>
          <input
            type="text"
            autoComplete="off"
            value={inn}
            maxLength={120}
            onChange={(e) => onInn(e.target.value)}
            placeholder="ИНН, ОГРН, название или фамилия"
            aria-invalid={error ? true : undefined}
            className={inputClass}
          />
        </label>
        <Button type="submit" disabled={busy}>
          {busy ? (text ? 'Ищу…' : 'Проверяю…') : text ? 'Найти' : 'Проверить'}
        </Button>
      </form>
      {text && onMode && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Что искать">
          {SEARCH_MODES.map((m) => (
            <Chip key={m.id} label={m.label} on={mode === m.id} onClick={() => onMode(m.id)} />
          ))}
          <span className="text-caption text-muted-foreground">{SEARCH_MODES.find((m) => m.id === mode)?.hint}</span>
        </div>
      )}
      {error && (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}
      {busy && !report && (
        <p role="status" className="text-caption text-muted-foreground">
          {text ? 'Ищу в реестрах — обычно пара секунд…' : 'Спрашиваю ЕГРЮЛ, Федресурс и ГИР БО — обычно несколько секунд…'}
        </p>
      )}
      {hits && hits.length === 0 && !busy && (
        <p role="status" className="text-ui text-muted-foreground">
          Ничего не нашли. Проверьте написание — или впишите ИНН либо ОГРН.
        </p>
      )}
      {hits && hits.length > 0 && onPick && (
        <div className="space-y-2">
          <p className="text-caption text-muted-foreground">
            Найдено: <span className="font-mono font-medium text-foreground">{hits.length}</span>. Выберите нужную — проверю по её ИНН.
            {more && ' Показаны первые, остальные скрыты — уточните запрос.'}
          </p>
          <ul className="space-y-2">
            {hits.map((hit) => (
              <HitRow key={`${hit.kind}-${hit.inn}-${hit.ogrn ?? ''}`} hit={hit} disabled={busy} onPick={() => onPick(hit)} />
            ))}
          </ul>
        </div>
      )}
      {report && <CounterpartyReportView report={report} />}
    </Card>
  );
}
