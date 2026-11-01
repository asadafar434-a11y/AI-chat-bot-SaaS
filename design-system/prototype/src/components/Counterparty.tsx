import type { ReactNode } from 'react';
import { accountBlocking, notFound, SOURCE_NAMES, thousandsText, type CounterpartyReport, type Tone as ReportTone } from '@/lib/counterparty';
import {
  Building2,
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
import { Badge, Button, Card, cx, Dot, HelpTip, type Tone, fieldBase } from './ui';

// «Проверка контрагента по ИНН» в «Аналитике»: организация, статус и отчётность из открытых реестров или Checko API.
// Показываем то, что написал реестр, с датой; вывода «надёжен» нет. Оценка Checko подписана как мнение сервиса.
// Оформление — карточки-показатели и мини-графики, как в дашборде; цифры считает сервер.

const TONE: Record<ReportTone, Tone> = { good: 'success', warn: 'warn', danger: 'danger', muted: 'neutral' };
const inputClass = `h-9 w-full px-3 font-mono text-[13px] placeholder:font-sans ${fieldBase}`;
const ROLE: Record<'plaintiff' | 'defendant' | 'other', string> = { plaintiff: 'истец', defendant: 'ответчик', other: 'участник' };

const when = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const day = (iso: string) => iso.split('-').reverse().join('.');
const rub = (value: number | null) => (value === null ? '—' : thousandsText(Math.round(value / 10) / 100));
const pct = (current: number | null, previous: number | null): number | null => {
  if (current === null || previous === null || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
};

function Money({ valueK }: { valueK: number | null }) {
  return <span className={cx('font-mono', valueK !== null && valueK < 0 && 'text-danger')}>{thousandsText(valueK)}</span>;
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] text-white/80 ring-1 ring-inset ring-white/15">{children}</span>;
}

function Spark({ values, color }: { values: (number | null)[]; color: string }) {
  const rows = values.filter((v): v is number => v !== null);
  if (rows.length < 2) return null;
  const min = Math.min(...rows);
  const max = Math.max(...rows);
  const span = max - min || 1;
  const x = (i: number) => 2 + (i / (rows.length - 1)) * 96;
  const y = (v: number) => 26 - ((v - min) / span) * 22;
  return (
    <svg viewBox="0 0 100 30" className="h-10 w-full" aria-hidden="true">
      <polyline points={rows.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {rows.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r="1.1" fill={color} />
      ))}
    </svg>
  );
}

function Metric({ icon, label, value, hint, delta, danger, spark }: { icon: ReactNode; label: string; value: string; hint?: string; delta?: number | null; danger?: boolean; spark?: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[#2F5BFF]/10 text-[#2F5BFF]">{icon}</span>
          <span className="truncate">{label}</span>
        </p>
        {delta !== null && delta !== undefined && (
          <span className={cx('shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[11px]', delta >= 0 ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger')}>
            {delta >= 0 ? '+' : '−'}
            {Math.abs(delta).toLocaleString('ru-RU')}%
          </span>
        )}
      </div>
      <p className={cx('mt-2 break-words text-2xl font-semibold tracking-tight', danger && 'text-danger')}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
      {spark && <div className="mt-2">{spark}</div>}
    </div>
  );
}

function CheckRow({ icon, label, text, tone }: { icon: ReactNode; label: string; text: string; tone: ReportTone }) {
  const circle = tone === 'danger' ? 'bg-danger/10 text-danger' : tone === 'warn' ? 'bg-warn-surface text-warn-foreground' : 'bg-success/10 text-success';
  return (
    <li className="flex items-start gap-2 px-3 py-2">
      <span className={cx('flex size-6 shrink-0 items-center justify-center rounded-full', circle)}>{icon}</span>
      <p className="min-w-0 break-words text-[12px]">
        <span className="text-muted-foreground">{label}: </span>
        <span className={cx(tone === 'danger' && 'font-semibold text-danger', tone === 'warn' && 'font-medium')}>{text}</span>
      </p>
    </li>
  );
}

function Trend({ title, data, color }: { title: string; data: { year: number; value: number | null }[]; color: string }) {
  const rows = data
    .filter((d): d is { year: number; value: number } => d.value !== null)
    .sort((a, b) => a.year - b.year);
  if (rows.length < 2) return null;
  const values = rows.map((r) => r.value);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const x = (i: number) => 4 + (i / (rows.length - 1)) * 92;
  const y = (v: number) => 36 - ((v - min) / (max - min)) * 30;
  const line = rows.map((r, i) => `${x(i)},${y(r.value)}`).join(' ');
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-[12px] text-muted-foreground">{title}</p>
      <svg viewBox="0 0 100 40" className="h-auto w-full text-muted-foreground" role="img" aria-label={`${title}: ${rows[0].year} — ${thousandsText(rows[0].value)}, ${rows[rows.length - 1].year} — ${thousandsText(rows[rows.length - 1].value)}`}>
        <polygon points={`4,36 ${line} ${x(rows.length - 1)},36`} fill={color} opacity="0.12" />
        <polyline points={line} fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
        {rows.map((r, i) => (
          <circle key={r.year} cx={x(i)} cy={y(r.value)} r="1" fill={color} />
        ))}
        <text x="4" y="7" fontSize="3.5" fill="currentColor">{thousandsText(max)}</text>
        <text x="4" y="39.5" fontSize="3" fill="currentColor">{rows[0].year}</text>
        <text x="96" y="39.5" fontSize="3" fill="currentColor" textAnchor="end">{rows[rows.length - 1].year}</text>
      </svg>
    </div>
  );
}

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
  const hasCases = Boolean((report.courts && report.courts.cases.length > 0) || (report.enforcements && report.enforcements.items.length > 0));
  const hasChecks = Boolean(report.efrsb || report.sanctions || blocking);

  return (
    <div className="space-y-3">
      {empty ? (
        <p className="text-[13px]">
          <span className="font-semibold">Организации с ИНН {report.inn} в реестрах не нашлось.</span> Проверьте цифры ИНН: контрольная сумма сходится, но такой записи нет.
        </p>
      ) : (
        <>
          <div className="relative overflow-hidden rounded-xl border border-white/10 bg-[linear-gradient(135deg,#0a1533_0%,#153a8a_55%,#2F5BFF_100%)] p-4 text-white shadow-lg">
            <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 size-48 rounded-full bg-white/10 blur-2xl" />
            <div aria-hidden className="pointer-events-none absolute -bottom-20 right-20 size-40 rounded-full bg-[#8cc8ff]/20 blur-2xl" />
            <div className="relative space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/60">
                <span className="rounded-full bg-white/10 px-2 py-0.5 font-medium text-white/80 ring-1 ring-inset ring-white/15">Проверка контрагента</span>
                <span>{when(report.at)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="break-words text-2xl font-semibold tracking-tight">{report.name}</p>
                {report.status && (
                  <span className="rounded-full bg-white/90 p-0.5">
                    <Badge tone={TONE[report.status.tone]} wrap>
                      {report.status.text}
                    </Badge>
                  </span>
                )}
                <CertaintyBadge kind="confirmed" />
              </div>
              <p className="break-words font-mono text-[12px] text-white/70">
                ИНН {report.inn}
                {report.identity?.ogrn && ` · ОГРН ${report.identity.ogrn}`}
                {report.identity?.kpp && ` · КПП ${report.identity.kpp}`}
              </p>
              {(report.address || report.identity?.region) && <p className="break-words text-[12px] text-white/60">{report.address ?? report.identity?.region}</p>}
              {(report.msp || report.staff !== null || report.taxes) && (
                <div className="flex flex-wrap gap-1.5">
                  {report.msp && <Chip>{report.msp.category}</Chip>}
                  {report.staff !== null && report.staff !== undefined && <Chip>сотрудников: {report.staff}</Chip>}
                  {report.taxes && report.taxes.regimes.length > 0 && <Chip>{report.taxes.regimes.join(' · ')}</Chip>}
                  {rel?.scale !== null && rel?.scale !== undefined && <Chip>масштаб {rel.scale}/100</Chip>}
                </div>
              )}
            </div>
          </div>

          {report.facts.length > 0 && (
            <div className="grid gap-x-4 gap-y-1.5 rounded-xl border border-border bg-card p-3 text-[13px] shadow-sm sm:grid-cols-2">
              {report.facts.map((f) => (
                <div key={f.id} className="flex items-start gap-2">
                  <span className="mt-1.5">
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

          {rel && (
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] font-semibold">
                  Оценка надёжности <span className="font-normal text-muted-foreground">— расчёт Checko, не наше заключение</span>
                </p>
              </div>
              <div className="mt-3 grid gap-2 text-[12px] sm:grid-cols-3">
                <p>
                  Масштаб бизнеса: <b className="font-mono text-foreground">{rel.scale ?? '—'}</b> из 100
                </p>
                <p>
                  Риск номинальности: <b className={cx(nominalTone === 'danger' && 'text-danger', nominalTone === 'warn' && 'text-warn', nominalTone === 'success' && 'text-success')}>{rel.nominality.text ?? '—'}</b>
                </p>
                <p>
                  Финансовые риски: <b className={cx(financialTone === 'danger' && 'text-danger', financialTone === 'warn' && 'text-warn', financialTone === 'success' && 'text-success')}>{rel.financial.text ?? '—'}</b>
                </p>
              </div>
              <div className="mt-3">
                <div className="flex h-2 overflow-hidden rounded-full bg-secondary">
                  <span className="bg-success" style={{ width: `${rel.balance.good}%` }} />
                  <span className="bg-warn" style={{ width: `${rel.balance.warn}%` }} />
                  <span className="bg-danger" style={{ width: `${rel.balance.bad}%` }} />
                </div>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Полож {rel.balance.good}% · Внимание {rel.balance.warn}% · Негатив {rel.balance.bad}%
                </p>
                {rel.factors.length > 0 && (
                  <details className="mt-1 text-[12px]">
                    <summary className="cursor-pointer text-muted-foreground">Факторы: {rel.factors.length}</summary>
                    <ul className="mt-1 space-y-1">
                      {rel.factors.map((f, i) => (
                        <li key={`${f.code ?? 'factor'}-${i}`} className="flex items-start gap-2">
                          <span className="mt-1.5">
                            <Dot tone={TONE[f.tone]} />
                          </span>
                          <span className="min-w-0 break-words">{f.text}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </div>
          )}

          {last && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric icon={<TrendingUp className="size-3.5" />} label="Выручка" value={thousandsText(last.revenue)} hint={last.year ? `за ${last.year} год` : undefined} delta={revenueDelta} spark={<Spark values={byYear.map((s) => s.revenue)} color="#2F5BFF" />} />
              <Metric
                icon={last.netProfit !== null && last.netProfit < 0 ? <TrendingDown className="size-3.5" /> : <TrendingUp className="size-3.5" />}
                label="Чистая прибыль"
                value={thousandsText(last.netProfit)}
                hint={last.year ? `за ${last.year} год` : undefined}
                delta={profitDelta}
                danger={last.netProfit !== null && last.netProfit < 0}
                spark={<Spark values={byYear.map((s) => s.netProfit)} color="#16A34A" />}
              />
              <Metric icon={<Wallet className="size-3.5" />} label="Капитал" value={thousandsText(last.equity)} hint={last.year ? `на конец ${last.year} года` : undefined} delta={equityDelta} danger={last.equity !== null && last.equity < 0} spark={<Spark values={byYear.map((s) => s.equity)} color="#7C3AED" />} />
              {rel ? (
                <Metric
                  icon={<ShieldCheck className="size-3.5" />}
                  label="Надёжность Checko"
                  value={rel.scale !== null ? `${rel.scale}` : '—'}
                  hint="из 100, мнение сервиса"
                  spark={
                    <div className="space-y-1">
                      <div className="flex h-2 overflow-hidden rounded-full bg-secondary">
                        <span className="bg-success" style={{ width: `${rel.balance.good}%` }} />
                        <span className="bg-warn" style={{ width: `${rel.balance.warn}%` }} />
                        <span className="bg-danger" style={{ width: `${rel.balance.bad}%` }} />
                      </div>
                      <p className="text-[11px] text-muted-foreground">положительных факторов {rel.balance.good}%</p>
                    </div>
                  }
                />
              ) : (
                <Metric icon={<Building2 className="size-3.5" />} label="Активы" value={thousandsText(last.assets)} hint={last.year ? `на конец ${last.year} года` : undefined} spark={<Spark values={byYear.map((s) => s.assets)} color="#0EA5E9" />} />
              )}
            </div>
          )}

          {sorted.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                <p className="text-[13px] font-semibold">Финансовая отчётность</p>
                <p className="text-[12px] text-muted-foreground">
                  ГИР БО ФНС · {sorted[sorted.length - 1].year}–{sorted[0].year}
                </p>
              </div>
              <div className="overflow-x-auto p-4">
                <table className="w-full min-w-[520px] whitespace-nowrap text-[12px]">
                  <caption className="pb-2 text-left text-muted-foreground">Бухгалтерская отчётность (ГИР БО ФНС)</caption>
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="py-1 pr-2 text-left font-medium">Год</th>
                      <th className="px-2 py-1 text-right font-medium">Выручка</th>
                      <th className="px-2 py-1 text-right font-medium">Чистая прибыль</th>
                      <th className="px-2 py-1 text-right font-medium">Активы</th>
                      <th className="py-1 pl-2 text-right font-medium">Капитал</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((s) => (
                      <tr key={s.year} className="border-b border-border/60 last:border-0">
                        <td className="py-1 pr-2 font-mono">{s.year}</td>
                        <td className="px-2 py-1 text-right">
                          <Money valueK={s.revenue} />
                        </td>
                        <td className="px-2 py-1 text-right">
                          <Money valueK={s.netProfit} />
                        </td>
                        <td className="px-2 py-1 text-right">
                          <Money valueK={s.assets} />
                        </td>
                        <td className="py-1 pl-2 text-right">
                          <Money valueK={s.equity} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {sorted.length > 1 && (
            <div className="grid gap-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:grid-cols-2">
              <Trend title="Выручка" color="#2F5BFF" data={sorted.map((s) => ({ year: s.year, value: s.revenue }))} />
              <Trend title="Чистая прибыль" color="#16A34A" data={sorted.map((s) => ({ year: s.year, value: s.netProfit }))} />
            </div>
          )}

          {(hasCases || hasChecks) && (
            <div className={cx('grid items-start gap-3', hasCases && hasChecks && 'lg:grid-cols-2')}>
              {hasCases && (
                <div className="space-y-3">
                  {report.courts && report.courts.cases.length > 0 && (
                    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
                        <p className="flex items-center gap-2 text-[13px] font-semibold">
                          <Scale className="size-4 text-[#2F5BFF]" />
                          Арбитражные дела
                        </p>
                        <p className="text-[12px] text-muted-foreground">
                          КАД: {report.courts.total}, ответчик — {report.courts.defendant}
                        </p>
                      </div>
                      <ul className="divide-y divide-border/60 text-[12px]">
                        {report.courts.cases.slice(0, 5).map((c) => (
                          <li key={`${c.number}-${c.date ?? ''}`} className="break-words px-3 py-1.5">
                            {c.url ? (
                              <a href={c.url} target="_blank" rel="noopener noreferrer" className="font-mono font-medium underline underline-offset-2 hover:no-underline">
                                {c.number}
                              </a>
                            ) : (
                              <span className="font-mono font-medium">{c.number}</span>
                            )}
                            {c.date && ` от ${day(c.date)}`} — {ROLE[c.role]}
                            {c.opponent && `, ${c.opponent}`}
                            {c.claimSum !== null && `, иск ${rub(c.claimSum)}`}
                            {c.active && ', рассматривается'}
                          </li>
                        ))}
                      </ul>
                      {report.courts.cases.length > 5 && <p className="px-3 pb-2.5 text-[12px] text-muted-foreground">Ещё {report.courts.cases.length - 5} — в картотеке.</p>}
                    </div>
                  )}
                  {report.enforcements && report.enforcements.items.length > 0 && (
                    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
                        <p className="flex items-center gap-2 text-[13px] font-semibold">
                          <Wallet className="size-4 text-[#2F5BFF]" />
                          Исполнительные производства
                        </p>
                        <p className="text-[12px] text-muted-foreground">
                          ФССП: {report.enforcements.total}, остаток долга {rub(report.enforcements.outstandingSum)}
                        </p>
                      </div>
                      <ul className="divide-y divide-border/60 text-[12px]">
                        {report.enforcements.items.slice(0, 5).map((e) => (
                          <li key={`${e.number ?? ''}-${e.date ?? ''}`} className="break-words px-3 py-1.5">
                            <span className="font-mono font-medium">{e.number ?? '№ не указан'}</span>
                            {e.date && ` от ${day(e.date)}`}
                            {e.subject && ` — ${e.subject}`}
                            {e.outstanding !== null && `, остаток ${rub(e.outstanding)}`}
                          </li>
                        ))}
                      </ul>
                      {report.enforcements.items.length > 5 && <p className="px-3 pb-2.5 text-[12px] text-muted-foreground">Ещё {report.enforcements.items.length - 5}.</p>}
                    </div>
                  )}
                </div>
              )}

              {hasChecks && (
                <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                  <div className="border-b border-border px-3 py-2.5">
                    <p className="text-[13px] font-semibold">Реестры и риски</p>
                  </div>
                  <ul className="divide-y divide-border/60">
                    {report.efrsb && (
                      <CheckRow
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
                    {blocking && <CheckRow icon={<Lock className="size-3.5" />} label="Блокировка банковских счетов" tone={blocking.blocked ? 'danger' : 'good'} text={blocking.text} />}
                    {report.sanctions && (
                      <CheckRow
                        icon={<ShieldAlert className="size-3.5" />}
                        label="Санкции"
                        tone={report.sanctions.included ? 'danger' : 'good'}
                        text={report.sanctions.included ? `входит в санкционные списки${report.sanctions.countries.length > 0 ? `: ${report.sanctions.countries.join(', ')}` : ''}` : 'не входит в санкционные списки'}
                      />
                    )}
                    {report.sanctions && (
                      <CheckRow
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
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <p className="text-[13px] font-semibold">
                Контакты <span className="font-normal text-muted-foreground">— из открытых источников</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {report.contacts.phones.map((p) => (
                  <a key={p} href={`tel:${p.replace(/[^\d+]/g, '')}`} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] transition-colors hover:bg-secondary">
                    <Phone className="size-3.5 text-muted-foreground" />
                    <span className="font-mono">{p}</span>
                  </a>
                ))}
                {report.contacts.emails.map((e) => (
                  <a key={e} href={`mailto:${e}`} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] transition-colors hover:bg-secondary">
                    <Mail className="size-3.5 text-muted-foreground" />
                    <span>{e}</span>
                  </a>
                ))}
                {report.contacts.website && (
                  <a href={report.contacts.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] transition-colors hover:bg-secondary">
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
        <p role="alert" className="text-[12px] text-danger">
          Не всё получилось: {failed.join('; ')}. Повторите проверку позже.
        </p>
      )}

      {report.links.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[13px] font-semibold">
            Проверить вручную <span className="font-normal text-muted-foreground">— без капчи эти реестры не отдают</span>
          </p>
          <ul className="mt-2 space-y-1.5 text-[12px]">
            {report.links.map((l) => (
              <li key={l.id} className="break-words">
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline underline-offset-2 hover:no-underline">
                  <ExternalLink className="mr-1 inline size-3.5 align-[-2px] text-muted-foreground" />
                  {l.title}
                </a>
                <span className="text-muted-foreground"> — {l.hint}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[12px] text-muted-foreground">
        Данные {sourceNames} на {when(report.at)}. Это сведения реестров, а не заключение о надёжности.
      </p>
    </div>
  );
}

export type CounterpartyCardProps = {
  inn: string;
  onInn: (value: string) => void;
  onCheck: () => void;
  busy: boolean;
  /** Ошибка проверки ИНН или запроса — одной строкой. */
  error: string | null;
  report: CounterpartyReport | null;
};

export function CounterpartyCard({ inn, onInn, onCheck, busy, error, report }: CounterpartyCardProps) {
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Search className="size-4" />
        <p className="text-[14px] font-bold">Проверка контрагента по ИНН</p>
        <Badge tone="success">Бесплатно: без ИИ</Badge>
        <HelpTip
          align="start"
          content="Заказчик, поставщик, конкурент: впишите ИНН — программа за несколько секунд проверит открытые реестры (ЕГРЮЛ, Федресурс, бухгалтерская отчётность ГИР БО, КАД, ФССП и РНП — напрямую или через Checko API) и покажет, действует ли организация, нет ли банкротства, судов и долгов. В реестры уходит только ИНН."
        />
      </div>
      <form
        className="flex flex-wrap items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) onCheck();
        }}
      >
        <label className="min-w-[200px] flex-1 text-[12px]">
          <span className="sr-only">ИНН организации или ИП</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={inn}
            maxLength={16}
            onChange={(e) => onInn(e.target.value)}
            placeholder="ИНН: 10 цифр у организации, 12 у ИП"
            aria-invalid={error ? true : undefined}
            className={inputClass}
          />
        </label>
        <Button type="submit" disabled={busy}>
          {busy ? 'Проверяю…' : 'Проверить'}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      )}
      {busy && !report && (
        <p role="status" className="text-[12px] text-muted-foreground">
          Спрашиваю ЕГРЮЛ, Федресурс и ГИР БО — обычно несколько секунд…
        </p>
      )}
      {report && <CounterpartyReportView report={report} />}
    </Card>
  );
}
