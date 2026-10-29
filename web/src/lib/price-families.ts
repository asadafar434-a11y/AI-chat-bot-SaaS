// Поиск закупочных цен по виду товара, а не по каждой позиции (решение владельца 29.10.2026, после «Цены только по 1 из 20»): сорок столов разных размеров
// ищутся одним запросом «Стол прямоугольный», а не сорока платными поисками. Найденное достаётся каждой позиции вида; что точно подходит, а что только аналог,
// решает сопоставление по позиции (position-prices.ts). Позиции с модельным обозначением («Chairman 696 LT») ищутся каждая сама: у них есть точная цена.

import { parseAmount, type RicPosition } from "@/lib/indicative-price";
import { headNoun, isAdjective, modelCodes, normalizeUnit, tokensOf } from "@/lib/market-observations";
import type { PriceResult, SavedPrices } from "@/lib/price-cache";

export const FAMILY_PREFIX = "fam:";

/** picks — что отправляется в поиск (позиция сама или представитель вида); members — для представителя вида ключи всех позиций вида. */
export type SearchPlan = { picks: RicPosition[]; members: Map<string, string[]>; searchedIds: string[] };

const value = (p: RicPosition) => {
  const qty = parseAmount(p.qty);
  return qty !== null && p.customerUnit !== undefined ? qty * p.customerUnit : -1;
};

const wordsOf = (name: string) => String(name ?? "").split(/[^A-Za-zА-Яа-яЁё0-9-]+/).filter(Boolean);
const stemOf = (word: string) => tokensOf(word).find((t) => !/^\d/.test(t)) ?? null;
const capital = (w: string) => (w ? w[0].toUpperCase() + w.slice(1) : w);

/** Название вида для поиска: главное слово и самое частое свойство среди позиций («Стол прямоугольный»); общего свойства нет — одно главное слово. */
export function familyName(head: string, names: string[]): string {
  const counts = new Map<string, { n: number; word: string }>();
  for (const name of names) {
    const seen = new Set<string>();
    for (const w of wordsOf(name)) {
      const stem = stemOf(w);
      // Свойством вида берётся только прилагательное («прямоугольный»): слова из «на 8 рабочих мест», «с полкой» названием вида не бывают.
      if (!stem || stem === head || w.length < 5 || !isAdjective(w) || seen.has(stem)) continue;
      seen.add(stem);
      const have = counts.get(stem);
      if (have) have.n++;
      else counts.set(stem, { n: 1, word: w.toLowerCase() });
    }
  }
  const best = [...counts.values()].filter((c) => c.n >= 2).sort((a, b) => b.n - a.n)[0];
  const headWord = wordsOf(names[0]).find((w) => stemOf(w) === head) ?? head;
  return best ? `${capital(headWord.toLowerCase())} ${best.word}` : capital(headWord.toLowerCase());
}

type Item = { pick: RicPosition; ids: string[]; value: number; order: number };

/**
 * Что искать. Позиция с модельным обозначением или без понятного вида — сама; остальные собираются по виду товара и единице. Из всех «искомых» берутся самые крупные по сумме (max).
 * Вид из одной позиции ищется под её собственным названием.
 */
export function planSearch(positions: RicPosition[], max: number): SearchPlan {
  const usable = positions.filter((p) => p.name.trim().length >= 2);
  const items: Item[] = [];
  const groups = new Map<string, RicPosition[]>();
  usable.forEach((p, i) => {
    const head = headNoun(p.name);
    if (!head || modelCodes(p.name).size > 0) {
      items.push({ pick: p, ids: [p.id], value: value(p), order: i });
      return;
    }
    const key = `${head}|${normalizeUnit(p.unit)}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  });
  for (const [key, list] of groups) {
    const order = usable.indexOf(list[0]);
    const known = list.map(value).filter((v) => v >= 0);
    const sum = known.length > 0 ? known.reduce((s, v) => s + v, 0) : -1;
    if (list.length === 1) {
      items.push({ pick: list[0], ids: [list[0].id], value: sum, order });
      continue;
    }
    const head = key.split("|")[0];
    items.push({
      pick: { id: `${FAMILY_PREFIX}${key}`, name: familyName(head, list.map((p) => p.name)), unit: list[0].unit, qty: "", analogs: [] },
      ids: list.map((p) => p.id),
      value: sum,
      order,
    });
  }
  const chosen = items.sort((a, b) => b.value - a.value || a.order - b.order).slice(0, max);
  return {
    picks: chosen.map((i) => i.pick),
    members: new Map(chosen.filter((i) => i.pick.id.startsWith(FAMILY_PREFIX)).map((i) => [i.pick.id, i.ids])),
    searchedIds: chosen.flatMap((i) => i.ids),
  };
}

/** Сохранённое по представителям вида → по позициям: каждая позиция вида получает результат своего вида. */
export function expandSaved(saved: SavedPrices | null | undefined, plan: SearchPlan): SavedPrices | null | undefined {
  if (!saved || plan.members.size === 0) return saved;
  const results = saved.results.flatMap((r): PriceResult[] => {
    const ids = plan.members.get(r.key);
    return ids ? ids.map((id) => ({ ...r, key: id })) : [r];
  });
  return { ...saved, results };
}
