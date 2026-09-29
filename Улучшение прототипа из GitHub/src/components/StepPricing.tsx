import { useMemo, useState } from 'react';
import { TrendingDown, Info } from '../lib/icons';
import { Button, Card } from './ui';
import { priceRows, tender, rub } from '../lib/data';

export function StepPricing({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [discount, setDiscount] = useState(6.5);

  const totals = useMemo(() => {
    const nmc = priceRows.reduce((s, r) => s + r.nmc * r.qty, 0);
    const our = Math.round((nmc * (100 - discount)) / 100);
    return { nmc, our, save: nmc - our };
  }, [discount]);

  const winChance = Math.max(20, Math.min(94, Math.round(38 + discount * 6.2)));

  return (
    <div className="animate-fade-up space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Составление и цена</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Документы заявки сформированы автоматически. Определите конкурентную цену — ИИ оценивает
          вероятность победы по истории закупок заказчика.
        </p>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Позиция</th>
              <th className="px-4 py-2.5 text-right font-medium">Кол-во</th>
              <th className="px-4 py-2.5 text-right font-medium">НМЦ / ед.</th>
              <th className="px-4 py-2.5 text-right font-medium">Наша / ед.</th>
            </tr>
          </thead>
          <tbody>
            {priceRows.map((r) => {
              const our = Math.round((r.nmc * (100 - discount)) / 100);
              return (
                <tr key={r.position} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium">{r.position}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                    {r.qty}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                    {rub(r.nmc)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{rub(our)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Снижение от НМЦК</label>
            <span className="font-mono text-lg font-semibold tabular-nums">
              {discount.toFixed(1)}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={15}
            step={0.5}
            value={discount}
            onChange={(e) => setDiscount(Number(e.target.value))}
            className="mt-4 w-full accent-[var(--foreground)]"
          />
          <div className="mt-2 flex justify-between font-mono text-[11px] text-muted-foreground">
            <span>0% (НМЦК)</span>
            <span>15% (риск демпинга)</span>
          </div>

          <div className="mt-5 space-y-2.5 text-sm">
            <Row label="НМЦК" value={rub(totals.nmc)} muted />
            <Row label="Ваше предложение" value={rub(totals.our)} strong />
            <Row
              label="Экономия для заказчика"
              value={
                <span className="inline-flex items-center gap-1 text-success">
                  <TrendingDown className="size-3.5" /> {rub(totals.save)}
                </span>
              }
            />
          </div>
        </Card>

        <Card className="flex flex-col justify-between p-5">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              Прогноз ИИ
            </p>
            <p className="mt-3 text-4xl font-semibold tabular-nums">{winChance}%</p>
            <p className="mt-1 text-xs text-muted-foreground">
              вероятность победы при текущей цене
            </p>
          </div>
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-foreground transition-all duration-300"
              style={{ width: `${winChance}%` }}
            />
          </div>
          {discount >= 12 && (
            <p className="mt-3 flex items-start gap-1.5 text-[12px] leading-snug text-warn-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0 text-warn" />
              Снижение свыше 25% от НМЦК потребует обоснования (антидемпинг, ст. 37).
            </p>
          )}
          <p className="mt-3 font-mono text-[11px] text-muted-foreground">
            Обеспечение заявки: {rub(tender.security)}
          </p>
        </Card>
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          ← Назад
        </Button>
        <Button onClick={onNext}>Проверить заявку →</Button>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: React.ReactNode;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={muted ? 'text-muted-foreground' : 'text-foreground'}>{label}</span>
      <span
        className={`font-mono tabular-nums ${
          strong ? 'text-base font-semibold' : muted ? 'text-muted-foreground' : ''
        }`}
      >
        {value}
      </span>
    </div>
  );
}
