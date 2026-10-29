import type { PositionPriceRow, PositionPrices } from '@/lib/position-prices';
import { cleanProductName } from '@/lib/prices-request';
import { CertaintyBadge } from './Certainty';
import { Badge, Card, HelpTip } from './ui';

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

/** Позиции, по которым точной цены нет, но найдены аналоги — тот же вид товара с другими характеристиками. */
export const analogRows = (prices: PositionPrices): PositionPriceRow[] => prices.rows.filter((r) => Boolean(r.analogs));

/** Позиции с одинаковыми аналогами (поиск идёт по виду товара — столы, стулья) показываются одним блоком. */
export function groupAnalogs(rows: PositionPriceRow[]): PositionPriceRow[][] {
  const groups = new Map<string, PositionPriceRow[]>();
  for (const r of rows) {
    const a = r.analogs!;
    const key = `${r.unit}|${a.n}|${a.range.from}|${a.range.to}|${a.sources.map((x) => `${x.host}${x.price}${x.product}`).join(',')}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()];
}

const NAMES_SHOWN = 3;

function AnalogRow({ rows }: { rows: PositionPriceRow[] }) {
  const r = rows[0];
  const a = r.analogs!;
  const unit = r.unit ? `/${r.unit}` : '';
  const names = rows.slice(0, NAMES_SHOWN).map((x) => cleanProductName(x.name)).join('; ');
  return (
    <li className="space-y-1 py-3 first:pt-0 last:pb-0">
      <p className="break-words text-[13px] font-semibold">
        {names}
        {rows.length > NAMES_SHOWN && <span className="font-normal text-muted-foreground"> и ещё {rows.length - NAMES_SHOWN}</span>}
        {rows.length === 1 && r.qty && <span className="font-normal text-muted-foreground"> · {glue(r.qty)}{r.unit ? ` ${r.unit}` : ''}</span>}
      </p>
      <p className="text-[13px]">
        <span className="font-mono font-bold">{a.range.from === a.range.to ? rub(a.range.from) : `${rub(a.range.from)} – ${rub(a.range.to)}`}{unit}</span>
        <span className="text-[12px] text-muted-foreground"> · аналогов: {a.n}</span>
      </p>
      <ul className="space-y-0.5 text-[12px] text-muted-foreground">
        {a.sources.map((s) => (
          <li key={`${s.host}-${s.price}-${s.product}`} className="break-words">
            {s.url ? (
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline underline-offset-2 hover:no-underline">
                {s.host}
              </a>
            ) : (
              <span className="font-medium text-foreground">{s.host}</span>
            )}{' '}
            — {rub(s.price)}{unit}, {day(s.date)} · «{s.product}»
          </li>
        ))}
      </ul>
    </li>
  );
}

export function PositionPricesCard({ prices, total }: { prices: PositionPrices; total: number }) {
  const rows = pricedRows(prices);
  const analogs = analogRows(prices);
  if (rows.length === 0 && analogs.length === 0) return null;
  const shown = rows.slice(0, MAX_ROWS);
  const complete = rows.length >= total;
  const missing = prices.rows.filter((r) => r.state !== 'found' && r.state !== 'few' && !r.analogs);
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[14px] font-bold">Товары и закупочные цены</p>
        <CertaintyBadge kind="unchecked" />
        <HelpTip align="start" content="Цены с сайтов поставщиков, найденные поиском в интернете: цитата со страницы проверена кодом, но это не предложение поставщика — уточните цену и условия поставки у него. Цены контрактов ЕИС не берутся: в них уже заложена прибыль победителя." />
        {prices.asOf && <span className="text-[12px] text-muted-foreground">цены на {day(prices.asOf)}</span>}
      </div>
      {shown.length > 0 && (
        <ul className="divide-y divide-border">
          {shown.map((r) => (
            <Row key={r.id} r={r} />
          ))}
        </ul>
      )}
      {analogs.length > 0 && (
        <div className="space-y-2 border-t border-border pt-3 first:border-t-0 first:pt-0">
          <p className="flex flex-wrap items-center gap-x-2 text-[13px] font-semibold">
            Ближайшие аналоги
            <span className="text-[12px] font-normal text-muted-foreground">по {analogs.length} {analogs.length === 1 ? 'позиции' : 'позициям'} точной цены нет</span>
            <HelpTip align="start" content="Тот же вид товара, но другие размер или характеристики (например, стол 120×60 вместо «стола на 1 рабочее место»). Это реальные закупочные цены с сайтов поставщиков, но не цена вашей позиции: в расчёт цены, рейтинг и «закупку по найденным ценам» они не входят — только ориентир." />
          </p>
          <ul className="divide-y divide-border">
            {groupAnalogs(analogs).slice(0, MAX_ROWS).map((rows) => (
              <AnalogRow key={rows[0].id} rows={rows} />
            ))}
          </ul>
        </div>
      )}
      {rows.length > shown.length && <p className="text-[12px] text-muted-foreground">и ещё {rows.length - shown.length} с ценами — в отчёте</p>}
      <div className="space-y-2 border-t border-border pt-3 text-[12px] text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {/* Цены не по всем позициям — красным бейджем (владелец, 23.10.2026: «это заметнее красным цветом или бейджик»): итог закупки по найденным ценам тогда неполный. */}
          <Badge tone={complete ? 'success' : 'danger'} wrap>
            {complete ? `Цены по всем ${total} ${total === 1 ? 'позиции' : 'позициям'}` : rows.length === 0 ? `Точных цен нет — только аналоги (${analogs.length} из ${total})` : `Точные цены только по ${rows.length} из ${total} ${total === 1 ? 'позиции' : 'позиций'}`}
          </Badge>
          {prices.cost !== null && (
            <span>
              закупка по найденным ценам: <span className="font-semibold text-foreground">{rub(prices.cost)}</span>
              {prices.costPositions < rows.length || prices.costPositions < total ? ` (по ${prices.costPositions} из ${total})` : ''}
            </span>
          )}
        </div>
        {missing.length > 0 && (
          <p className="break-words">
            <span className="font-semibold text-danger">Без цены:</span> {missing.slice(0, 4).map((r) => cleanProductName(r.name)).join(', ')}
            {missing.length > 4 ? ` и ещё ${missing.length - 4}` : ''}
            {missing.some((r) => r.state === 'none') && ' — поиск подходящих цен не нашёл: у продавцов может быть «цена по запросу», запросите коммерческое предложение'}
            {missing.some((r) => r.state === 'not-searched') && ' — по части позиций не искали: ищем до шести главных'}
          </p>
        )}
      </div>
    </Card>
  );
}
