import { useState } from 'react';
import { Trophy, TrendingUp, TrendingDown, Calendar, BarChart2, Star, Search, Info } from '../lib/icons';
import { Card, Badge, HelpTip, AIDisclaimer, Soon, Tooltip } from './ui';
import { bidHistory, bidResultMeta, procedureMeta, rub, mln, type BidResult } from '../lib/data';

// Mini horizontal bar
function MiniBar({ value, max, tone }: { value: number; max: number; tone: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
      <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${(value / max) * 100}%` }} />
    </div>
  );
}

const resultFilters: { id: BidResult | 'all'; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'won', label: 'Победы' },
  { id: 'lost', label: 'Проигрыши' },
  { id: 'pending', label: 'На рассмотрении' },
];

export function BidHistory() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<BidResult | 'all'>('all');

  const total = bidHistory.length;
  const won = bidHistory.filter((b) => b.result === 'won').length;
  const lost = bidHistory.filter((b) => b.result === 'lost').length;
  const pending = bidHistory.filter((b) => b.result === 'pending').length;
  const decided = won + lost;
  const winRate = decided ? Math.round((won / decided) * 100) : 0;
  const wonSum = bidHistory.filter((b) => b.result === 'won').reduce((s, b) => s + b.ourPrice, 0);
  const lostBids = bidHistory.filter((b) => b.result === 'lost');
  const missedRevenue = lostBids.reduce((s, b) => s + b.ourPrice, 0);
  const avgGap = lostBids.length
    ? Math.round(
        lostBids.reduce((s, b) => s + ((b.ourPrice - b.winnerPrice) / b.winnerPrice) * 100, 0) /
          lostBids.length,
      )
    : 0;

  const q = query.trim().toLowerCase();
  const rows = bidHistory.filter(
    (b) =>
      (result === 'all' || b.result === result) &&
      (!q ||
        b.title.toLowerCase().includes(q) ||
        b.customer.toLowerCase().includes(q) ||
        b.id.includes(q) ||
        procedureMeta[b.procedure].label.toLowerCase().includes(q)),
  );

  const stats = [
    { label: 'Подано', value: String(total), color: 'text-foreground', hint: 'Все заявки, которые вы подали через сервис.' },
    { label: 'Победы', value: String(won), color: 'text-success', hint: 'Заявки, по которым с вами заключают контракт.' },
    {
      label: 'Win-rate',
      value: `${winRate}%`,
      color: winRate >= 50 ? 'text-success' : 'text-warn-foreground',
      hint: 'Доля побед среди закупок, где итоги уже подведены.',
    },
    { label: 'Сумма побед', value: mln(wonSum), color: 'text-foreground', hint: `Сумма выигранных контрактов: ${rub(wonSum)}.` },
  ];

  return (
    <div className="animate-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">История заявок</h1>
            <Soon />
          </div>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Все поданные заявки, результаты и аналитика побед / поражений.
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2.5 rounded-lg border border-dashed border-border bg-secondary/40 px-4 py-3 text-[13px] text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>
          <span className="font-medium text-foreground">Итоги торгов с площадок — в разработке.</span> Сейчас на экране
          пример: так история будет выглядеть, когда результаты начнут подтягиваться автоматически.
        </p>
      </div>

      {/* Compact stat strip */}
      <Card className="flex divide-x divide-border p-0">
        {stats.map(({ label, value, color, hint }, i) => (
          <Tooltip
            key={label}
            content={hint}
            side="bottom"
            align={i === 0 ? 'start' : i === stats.length - 1 ? 'end' : 'center'}
            className="flex-1"
          >
            <div className="flex w-full cursor-default flex-col items-center gap-0.5 px-2 py-3">
              <span className={`whitespace-nowrap text-lg font-semibold tabular-nums leading-none ${color}`}>{value}</span>
              <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
            </div>
          </Tooltip>
        ))}
      </Card>

      {/* AI analysis */}
      <Card className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <BarChart2 className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">ИИ-анализ результатов</span>
          <HelpTip content="ИИ сравнивает вашу историю ставок с победными ценами и даёт рекомендации по стратегии." />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {/* Win rate bar */}
          <div className="space-y-1.5 rounded-lg border border-border bg-secondary/30 p-3">
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-muted-foreground">Win-rate в решённых</span>
              <span className="font-mono font-semibold">{winRate}%</span>
            </div>
            <MiniBar value={won} max={decided || 1} tone="bg-success" />
            <p className="text-[11px] text-muted-foreground">
              {winRate >= 50
                ? 'Выше среднего по рынку (≈42%). Стратегия ценообразования эффективна.'
                : 'Ниже среднего (≈42%). Рекомендуем снизить ценовую планку на 2–3%.'}
            </p>
          </div>

          {/* Missed revenue */}
          <div className="space-y-1.5 rounded-lg border border-border bg-secondary/30 p-3">
            <div className="flex items-center justify-between text-[12px]">
              <span className="flex items-center gap-1 text-muted-foreground">
                Упущенная выручка
                <HelpTip content="Сумма контрактов, где победитель предложил меньшую цену." />
              </span>
              <span className="whitespace-nowrap font-mono font-semibold text-danger">{mln(missedRevenue)}</span>
            </div>
            <MiniBar value={lost} max={total || 1} tone="bg-danger/60" />
            <p className="text-[11px] text-muted-foreground">
              В среднем вы превышали цену победителя на{' '}
              <span className="font-semibold text-foreground">+{avgGap}%</span>. Небольшое снижение могло
              изменить результат.
            </p>
          </div>
        </div>

        {/* Recommendations */}
        <div className="space-y-2">
          <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Рекомендации</p>
          {[
            {
              icon: TrendingDown,
              color: 'text-success',
              text: 'При следующей закупке у ДЗМ снизьте цену на 6–8% — исторически победители торгуются именно в этом диапазоне.',
            },
            {
              icon: Star,
              color: 'text-warn-foreground',
              text: 'Закупки по 223-ФЗ показывают меньший win-rate (0/2) — возможно, вес квалификации недооценён. Усильте описание опыта в заявке.',
            },
            {
              icon: TrendingUp,
              color: 'text-muted-foreground',
              text: 'Запрос котировок — ваш самый сильный формат (100% побед). Продолжайте приоритизировать эти процедуры.',
            },
          ].map(({ icon: Icon, color, text }) => (
            <div key={text} className="flex items-start gap-2.5 text-[12px] text-muted-foreground">
              <Icon className={`mt-0.5 size-3.5 shrink-0 ${color}`} />
              <span>{text}</span>
            </div>
          ))}
        </div>

        <AIDisclaimer />
      </Card>

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-md border border-border bg-card px-3 focus-within:border-foreground focus-within:ring-2 focus-within:ring-ring/20">
          <Search className="size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по названию, заказчику, № или способу закупки"
            aria-label="Поиск по истории заявок"
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {resultFilters.map((f) => (
            <button
              key={f.id}
              onClick={() => setResult(f.id)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                result === f.id
                  ? 'border-foreground bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <Card>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-medium">Все заявки</span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {rows.length === total ? `${total} записей` : `${rows.length} из ${total}`}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Закупка</th>
                <th className="px-4 py-2.5 text-right font-medium">
                  <span className="inline-flex items-center gap-1">
                    Наша цена
                    <HelpTip content="Цена, поданная в заявке." side="bottom" />
                  </span>
                </th>
                <th className="px-4 py-2.5 text-right font-medium">
                  <span className="inline-flex items-center gap-1">
                    Победитель
                    <HelpTip content="Итоговая цена победителя торгов." side="bottom" />
                  </span>
                </th>
                <th className="px-4 py-2.5 text-center font-medium">
                  <span className="inline-flex items-center gap-1">
                    Место
                    <HelpTip content="Ваше место среди участников: 1/4 — первое из четырёх." side="bottom" />
                  </span>
                </th>
                <th className="px-4 py-2.5 text-right font-medium">Итог</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const meta = bidResultMeta[b.result];
                const delta = b.ourPrice - b.winnerPrice;
                const pct = b.winnerPrice ? Math.round((delta / b.winnerPrice) * 100) : 0;
                return (
                  <tr key={b.id} className="border-b border-border align-top transition-colors last:border-0 hover:bg-secondary/30">
                    <td className="px-4 py-3">
                      <p className="max-w-[280px] font-medium leading-snug">{b.title}</p>
                      <p className="mt-0.5 text-[12px] text-muted-foreground">{b.customer}</p>
                      <p className="mt-1 inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                        <Calendar className="size-3" /> {b.date} · {b.law} · {procedureMeta[b.procedure].short}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums">
                      {rub(b.ourPrice)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                      {rub(b.winnerPrice)}
                      {b.result === 'lost' && delta > 0 && (
                        <span className="mt-0.5 block text-[11px] text-danger">
                          +{pct}% дороже
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center font-mono tabular-nums">
                      <span className={b.rank === 1 ? 'font-semibold text-success' : ''}>
                        {b.rank}
                      </span>
                      <span className="text-muted-foreground">/{b.participants}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[13px] text-muted-foreground">
                    Ничего не найдено. Измените запрос или фильтр.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Pending explanation */}
      {pending > 0 && (
        <Card className="flex items-start gap-3 bg-secondary/40 p-4">
          <Trophy className="mt-0.5 size-4 shrink-0 text-warn-foreground" />
          <p className="text-[13px] text-muted-foreground">
            <span className="font-medium text-foreground">{pending} заявк{pending === 1 ? 'а' : 'и'} на рассмотрении.</span>{' '}
            Результаты будут обновлены автоматически после подведения итогов на площадке.
          </p>
        </Card>
      )}

      <AIDisclaimer />
    </div>
  );
}
