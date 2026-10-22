import type { PriceBadge } from '@/lib/price-badge';
import { Badge, HelpTip } from './ui';

// Ценовой бейдж в карточке тендера: «Цена ниже рынка», «Цена выше рынка», «В рыночном диапазоне» или «Недостаточно данных» (lib/price-badge.ts).
// Рядом — на чём основан вывод: сколько цен-аналогов, на сколько процентов начальная цена отличается от РИЦ, откуда цены. Без данных вывода нет.

const TONE = { below: 'warn', above: 'warn', within: 'success', insufficient: 'neutral' } as const;
const pct = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} %`;

export function PriceBadgeChip({ badge, market = [] }: { badge: PriceBadge; /** Рыночный ориентир по позициям из общей базы цен: медиана, диапазон, динамика, регион. */ market?: string[] }) {
  const d = badge.detail;
  const marketText = market.length > 0 ? ` Рынок по базе цен: ${market.join('; ')}.` : '';
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Badge tone={TONE[badge.status]}>{badge.title}</Badge>
      {d && (
        <span className="text-[12px] text-muted-foreground">
          цен-аналогов {d.observations.total} · {pct(d.pct)} к РИЦ · источников: {d.sources.length}
        </span>
      )}
      {d ? (
        <HelpTip
          align="start"
          content={`РИЦ ${Math.round(d.ric).toLocaleString('ru-RU')} ₽, начальная цена ${Math.round(d.nmck).toLocaleString('ru-RU')} ₽; рыночный диапазон ${Math.round(d.range.from).toLocaleString('ru-RU')} – ${Math.round(d.range.to).toLocaleString('ru-RU')} ₽; цены с ${d.dates.from} по ${d.dates.to}. Источники: ${d.sources.join('; ')}. Рыночная цена здесь — закупочная (прайсы, предложения поставщиков, биржа); цены контрактов не берутся — в них маржа победителя. Вывод — повод проверить характеристики и объёмы, а не обвинение заказчика.${marketText}`}
        />
      ) : (
        (badge.missing.length > 0 || marketText) && <HelpTip align="start" content={`${badge.missing.length > 0 ? `Чего не хватает: ${badge.missing.join('; ')}.` : ''}${marketText}`.trim()} />
      )}
    </div>
  );
}
