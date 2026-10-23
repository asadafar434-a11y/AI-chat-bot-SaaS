import type { PositionPriceRow, PositionPrices } from '@/lib/position-prices';
import { CertaintyBadge } from './Certainty';
import { Card, HelpTip } from './ui';

// «Товары и закупочные цены» (22–23.10.2026, владелец: «где товар, цена его?»): по каждой позиции закупки — за сколько её можно купить по ценам из интернета (lib/position-prices.ts),
// с поставщиком, датой и ссылкой. Цен нет — блока нет вовсе (решение владельца: «если цен нет, то не надо»). Закупочная цена, не цена контракта.

const glue = (t: string) => t.replace(/[   ]/g, ' ');
const rub = (n: number) => glue(`${Math.round(n).toLocaleString('ru-RU')} ₽`);
const signed = (n: number) => glue(`${n >= 0 ? '+' : '−'}${Math.abs(n).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} %`);
const day = (iso: string) => iso.split('-').reverse().join('.');
const MAX_ROWS = 8;

/** Строки, по которым цены есть; остальные позиции в блоке не показываются. */
export const pricedRows = (prices: PositionPrices): PositionPriceRow[] => prices.rows.filter((r) => r.state === 'found' || r.state === 'few');

function Row({ r }: { r: PositionPriceRow }) {
  const unit = r.unit ? `/${r.unit}` : '';
  return (
    <li className="space-y-1.5 py-3 first:pt-0 last:pb-0">
      <p className="break-words text-[13px] font-semibold">
        {r.name}
        {r.qty && <span className="font-normal text-muted-foreground"> · {glue(r.qty)}{r.unit ? ` ${r.unit}` : ''}</span>}
      </p>
      {r.state === 'found' && r.median !== null && r.range ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="font-mono text-xl font-bold tracking-tight text-success">{rub(r.median)}{unit}</span>
          <span className="text-[12px] text-muted-foreground">
            закупка, без НДС · диапазон {rub(r.range.from)} – {rub(r.range.to)} · цен {r.n}
          </span>
        </div>
      ) : (
        <p className="text-[13px]">
          <span className="font-mono font-bold">{r.range ? (r.range.from === r.range.to ? rub(r.range.from) : `${rub(r.range.from)} – ${rub(r.range.to)}`) : ''}{unit}</span>
          <span className="text-[12px] text-muted-foreground"> · найдено цен: {r.n}, для вывода нужно не меньше пяти</span>
        </p>
      )}
      {r.customerUnit !== null && (
        <p className="text-[12px] text-muted-foreground">
          Начальная цена заказчика <span className="font-semibold text-foreground">{rub(r.customerUnit)}{unit}</span>
          {r.gapPct !== null && <> · {signed(r.gapPct)} к закупке</>}
        </p>
      )}
      <ul className="space-y-0.5 text-[12px] text-muted-foreground">
        {r.sources.map((s) => (
          <li key={`${s.host}-${s.price}-${s.date}`} className="break-words">
            {s.url ? (
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline underline-offset-2 hover:no-underline">
                {s.host}
              </a>
            ) : (
              <span className="font-medium text-foreground">{s.host}</span>
            )}{' '}
            — {rub(s.price)}{unit}, {day(s.date)}
            {s.product.toLowerCase() !== r.name.toLowerCase() && <> · «{s.product}»</>}
          </li>
        ))}
      </ul>
    </li>
  );
}

export function PositionPricesCard({ prices, total }: { prices: PositionPrices; total: number }) {
  const rows = pricedRows(prices);
  if (rows.length === 0) return null;
  const shown = rows.slice(0, MAX_ROWS);
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[14px] font-bold">Товары и закупочные цены</p>
        <CertaintyBadge kind="unchecked" />
        <HelpTip align="start" content="Цены с сайтов поставщиков, найденные поиском в интернете: цитата со страницы проверена кодом, но это не предложение поставщика — уточните цену и условия поставки у него. Цены контрактов ЕИС не берутся: в них уже заложена прибыль победителя." />
        {prices.asOf && <span className="text-[12px] text-muted-foreground">цены на {day(prices.asOf)}</span>}
      </div>
      <ul className="divide-y divide-border">
        {shown.map((r) => (
          <Row key={r.id} r={r} />
        ))}
      </ul>
      {rows.length > shown.length && <p className="text-[12px] text-muted-foreground">и ещё {rows.length - shown.length} с ценами — в отчёте</p>}
      <p className="border-t border-border pt-3 text-[12px] text-muted-foreground">
        Цены есть по {rows.length} из {total} {total === 1 ? 'позиции' : 'позиций'}
        {prices.cost !== null && (
          <>
            {' '}· закупка по найденным ценам: <span className="font-semibold text-foreground">{rub(prices.cost)}</span>
            {prices.costPositions < rows.length || prices.costPositions < total ? ` (по ${prices.costPositions} из ${total})` : ''}
          </>
        )}
      </p>
    </Card>
  );
}
