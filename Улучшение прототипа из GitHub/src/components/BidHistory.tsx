import { Trophy, TrendingUp, TrendingDown, Calendar, BarChart2, Star } from '../lib/icons';
import { Card, Badge, HelpTip, AIDisclaimer } from './ui';
import { bidHistory, bidResultMeta, procedureMeta, rub } from '../lib/data';

// Mini horizontal bar
function MiniBar({ value, max, tone }: { value: number; max: number; tone: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
      <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${(value / max) * 100}%` }} />
    </div>
  );
}

export function BidHistory() {
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

  return (
    <div className="animate-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">История заявок</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Все поданные заявки, результаты и аналитика побед / поражений.
          </p>
        </div>
      </div>

      {/* Compact stat strip */}
      <Card className="flex divide-x divide-border overflow-hidden p-0">
        {[
          { label: 'Подано', value: total, color: 'text-foreground' },
          { label: 'Победы', value: won, color: 'text-success' },
          { label: 'Win-rate', value: `${winRate}%`, color: winRate >= 50 ? 'text-success' : 'text-warn-foreground' },
          { label: 'Сумма побед', value: `${(wonSum / 1_000_000).toFixed(1)}M`, color: 'text-foreground' },
        ].map(({ label, value, color }) => (
          <div key={label} className="flex flex-1 flex-col items-center gap-0.5 px-2 py-3">
            <span className={`text-lg font-semibold tabular-nums leading-none ${color}`}>{value}</span>
            <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
          </div>
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
              <span className="text-muted-foreground flex items-center gap-1">
                Упущенная выручка
                <HelpTip content="Сумма контрактов, где победитель предложил меньшую цену." />
              </span>
              <span className="font-mono font-semibold text-danger">{(missedRevenue / 1_000_000).toFixed(1)}M ₽</span>
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
          <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">Рекомендации</p>
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

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-medium">Все заявки</span>
          <span className="font-mono text-[11px] text-muted-foreground">{total} записей</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Закупка</th>
                <th className="px-4 py-2.5 text-right font-medium">
                  <span className="inline-flex items-center gap-1">
                    Наша цена
                    <HelpTip content="Цена, поданная в заявке." />
                  </span>
                </th>
                <th className="px-4 py-2.5 text-right font-medium">
                  <span className="inline-flex items-center gap-1">
                    Победитель
                    <HelpTip content="Итоговая цена победителя торгов." />
                  </span>
                </th>
                <th className="px-4 py-2.5 text-center font-medium">Место</th>
                <th className="px-4 py-2.5 text-right font-medium">Итог</th>
              </tr>
            </thead>
            <tbody>
              {bidHistory.map((b) => {
                const meta = bidResultMeta[b.result];
                const delta = b.ourPrice - b.winnerPrice;
                const pct = b.winnerPrice ? Math.round((delta / b.winnerPrice) * 100) : 0;
                return (
                  <tr key={b.id} className="border-b border-border last:border-0 align-top hover:bg-secondary/30 transition-colors">
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
            </tbody>
          </table>
        </div>
      </Card>

      {/* Pending explanation */}
      {bidHistory.some((b) => b.result === 'pending') && (
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
