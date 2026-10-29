import type { ServiceVolume } from '@/lib/service-volume';
import { CertaintyBadge } from './Certainty';
import { Card } from './ui';

// «Объём закупки» (23.10.2026; питание было лишь примером — подходит любая услуга или работа с объёмом в документах: детодни, человеко-часы, м², смены, рейсы): сколько всего единиц и сколько заказчик закладывает за единицу.
// Себестоимость единицы программа не придумывает: её вписывают на шаге «Цена» — после этого появляется общая себестоимость и цена, ниже которой нельзя участвовать.

const glue = (t: string) => t.replace(/[  ]/g, ' ');
const num = (n: number) => glue(n.toLocaleString('ru-RU'));
const rub2 = (n: number) => glue(`${n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`);

// «10 категорий» в таблице «люди × период», «3 позиции» в таблице «количество + единица».
const rowsWord = (n: number, categories: boolean) => {
  const few = n % 10 >= 2 && n % 10 <= 4 && (n < 10 || n > 20);
  const one = n % 10 === 1 && n !== 11;
  return categories ? (one ? 'категория' : few ? 'категории' : 'категорий') : one ? 'позиция' : few ? 'позиции' : 'позиций';
};

export function ServiceVolumeCard({ volume, nmck, costs }: { volume: ServiceVolume; nmck: number | null; costs: number | null }) {
  const perUnit = nmck && nmck > 0 ? nmck / volume.total : null;
  const ownUnit = costs && costs > 0 ? costs / volume.total : null;
  return (
    <Card className="space-y-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[15px] font-bold">Объём закупки</p>
        <CertaintyBadge kind="confirmed" />
      </div>
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-2xl font-bold tracking-tight">
          {num(volume.total)} {volume.unitsLabel}
        </span>
        <span className="text-[12px] text-muted-foreground">
          {volume.people !== null && `${num(volume.people)} чел. · `}
          {volume.rows.length} {volume.rowsLabel ?? rowsWord(volume.rows.length, volume.people !== null)} · {volume.doc}
        </span>
      </p>
      {perUnit !== null && (
        <p className="text-[13px]">
          Заказчик закладывает ≈ <span className="font-mono font-bold">{rub2(perUnit)}</span> за {volume.unit} (начальная цена ÷ объём).
        </p>
      )}
      {ownUnit !== null ? (
        <p className="text-[13px]">
          Ваша себестоимость: <span className="font-mono font-bold">{rub2(ownUnit)}</span> за {volume.unit}
          {perUnit !== null && (
            <span className={perUnit >= ownUnit ? 'text-muted-foreground' : 'font-semibold text-danger'}>
              {perUnit >= ownUnit ? ` · запас до цены заказчика ${rub2(perUnit - ownUnit)}` : ` · выше цены заказчика на ${rub2(ownUnit - perUnit)} — по начальной цене убыток`}
            </span>
          )}
        </p>
      ) : (
        <p className="text-[12px] text-muted-foreground">Впишите себестоимость {volume.one} {volume.unitOf} на шаге «Цена» — программа сама посчитает общую себестоимость и цену, ниже которой нельзя участвовать.</p>
      )}
    </Card>
  );
}
