// Рыночные цены из общей базы (lib/market-observations.ts, /api/market) в расчёте закупки: позиции берутся из бланка заказчика, к ним добавляются сопоставимые цены базы как цены-аналоги — только в памяти
// на время расчёта, в сохранённые данные закупки они не пишутся. Дальше всё считают прежние правила (lib/indicative-price.ts, lib/price-badge.ts): не меньше пяти цен по позиции, цена с источником и датой.
// Базы нет, она пуста или цен мало — расчёт остаётся таким, каким был: ничего не выдумывается.

import { parseAmount, type Analog, type RicData } from "@/lib/indicative-price";
import { MAX_POSITIONS } from "@/lib/market-request";
import { analogsFrom, marketStats, type MarketStats, type Observation } from "@/lib/market-observations";

export type MarketResultLite = { key: string; stats: MarketStats; analogs: Analog[] };

/** Позиции расчёта → запрос к базе: название, единица, количество и регион закупки. */
export function marketRequestOf(data: RicData, region: string | null): { positions: { key: string; name: string; unit: string; quantity?: number; region?: string }[] } {
  return {
    positions: data.positions
      .filter((p) => p.name.trim().length >= 2)
      .slice(0, MAX_POSITIONS)
      .map((p) => {
        const quantity = parseAmount(p.qty);
        return { key: p.id, name: p.name, unit: p.unit, ...(quantity !== null && quantity > 0 && { quantity }), ...(region && { region }) };
      }),
  };
}

const sameAnalog = (a: Analog, b: Analog) => a.price === b.price && a.date === b.date && a.source === b.source;

/** К позициям добавляются цены базы; уже введённые участником остаются первыми, повторов нет. */
export function withMarketAnalogs(data: RicData, results: MarketResultLite[]): RicData {
  if (results.length === 0) return data;
  const byKey = new Map(results.map((r) => [r.key, r]));
  return {
    ...data,
    positions: data.positions.map((p) => {
      const found = byKey.get(p.id);
      if (!found || found.analogs.length === 0) return p;
      const extra = found.analogs.filter((a) => !p.analogs.some((own) => sameAnalog(own, a))).map((a) => ({ ...a, id: `${p.id}-${a.id}` }));
      return extra.length === 0 ? p : { ...p, analogs: [...p.analogs, ...extra] };
    }),
  };
}

const glue = (t: string) => t.replace(/[   ]/g, " ");
const rub = (n: number) => glue(`${Math.round(n).toLocaleString("ru-RU")} ₽`);
const signed = (n: number) => glue(`${n >= 0 ? "+" : "−"}${Math.abs(n).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} %`);

/** Строки для подсказки у ценового бейджа: по каждой позиции, где данных хватило, — медиана, диапазон, динамика и регион. Позиции без данных молчат. */
export function marketLines(data: RicData, results: MarketResultLite[], max = 3): string[] {
  const names = new Map(data.positions.map((p) => [p.id, p.name]));
  return results
    .filter((r) => r.stats.status !== "insufficient" && r.stats.median !== null && r.stats.range)
    .slice(0, max)
    .map((r) => {
      const s = r.stats;
      const parts = [`медиана ${rub(s.median!)}`, `диапазон ${rub(s.range!.from)} – ${rub(s.range!.to)}`, `цен ${s.n}`];
      if (s.dynamics) parts.push(`динамика ${signed(s.dynamics.changePct)} к прежним ценам`);
      if (s.targetRegion) parts.push(`в регионе закупки ${signed(s.targetRegion.diffPct)} к общей медиане`);
      if (s.status === "heterogeneous") parts.push("цены неоднородны");
      return `«${names.get(r.key) ?? r.key}»: ${parts.join(", ")}`;
    });
}

/** Найденные в интернете закупочные цены (lib/price-cache.ts) → то же, что даёт база: аналоги позиции и статистика. Позиции берутся по ключу; без цен у позиции записи нет. */
export function liveToLite(positions: RicData["positions"], results: { key: string; observations: Observation[] }[], today: string, newId: () => string): MarketResultLite[] {
  const byId = new Map(positions.map((p) => [p.id, p]));
  return results.flatMap((r) => {
    const p = byId.get(r.key);
    if (!p || r.observations.length === 0) return [];
    const quantity = parseAmount(p.qty);
    const target = { name: p.name, unit: p.unit, quantity: quantity !== null && quantity > 0 ? quantity : null };
    return [{ key: r.key, stats: marketStats(target, r.observations, today), analogs: analogsFrom(target, r.observations, today, newId) }];
  });
}
