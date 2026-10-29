// «Сколько стоит исполнение» по таблице обоснования цены заказчика (решение владельца 29.10.2026: «чтобы всегда вот так чётко считалось с итоговыми ценами» — образец от другой модели
// по тендеру на мебель для Братского дома-интерната). Без ИИ и без платы: минимум, средняя и максимум по позициям, самые дорогие позиции, три сценария исполнения
// (товары + резерв на доставку и сборку), остаток при начальной цене и при снижении, вывод. Минимум и максимум — сценарии: по каждой позиции самая низкая или самая высокая цена
// из предложений, а не один поставщик на весь комплект. Резерв на доставку и сборку — допущение в процентах от товаров, округлённое до круглой суммы (LOGISTICS_PCT), не цена перевозчика.

import type { FindingLine, Tone } from "@/lib/analytics-summary";
import type { CustomerPriceTable, PriceTableRow } from "@/lib/customer-price-table";
import { headNoun, tokensOf } from "@/lib/market-observations";

export type ScenarioKey = "low" | "base" | "high";

/**
 * Резерв на доставку, разгрузку, подъём и сборку — процент от стоимости товаров по сценариям (допущение: в таблице заказчика их нет отдельно).
 * 6,5 / 8,5 / 11 % с округлением до круглой суммы дают на мебели Братска те же 100 / 150 / 220 тыс. ₽, что и образец владельца.
 */
export const LOGISTICS_PCT: Record<ScenarioKey, number> = { low: 6.5, base: 8.5, high: 11 };
/** Снижение цены, для которого показывается остаток. */
export const BID_DROP_PCT = 5;
const TOP_GROUPS = 4;
/** В одну строку «самых дорогих» собираются позиции одного вида с близкой ценой за единицу (разница не больше этой доли). */
const SAME_PRICE_SPREAD = 0.25;

export type CostGroup = { label: string; positions: number; qty: number; min: number; mean: number; max: number };
export type CostScenario = { key: ScenarioKey; label: string; goods: number; logistics: number; total: number; /** Начальная цена − всего; null — начальной цены нет. */ atNmck: number | null; atBid: number | null };
export type Verdict = { tone: Exclude<Tone, "muted">; title: string; text: string };

export type ExecutionCost = {
  rows: number;
  /** Позиций, у которых цены поставщиков не прочитались: в минимум и максимум у них идёт средняя. */
  unchecked: number;
  min: number;
  mean: number;
  max: number;
  /** Сошлась ли сумма таблицы с начальной ценой (или с «Итого» под таблицей); null — сверять не с чем. */
  matchesNmck: boolean | null;
  top: CostGroup[];
  /** Доля самых дорогих позиций в стоимости заказа (по средним), 0–1. */
  topShare: number;
  scenarios: CostScenario[];
  logisticsPct: Record<ScenarioKey, number>;
  bidDropPct: number;
  bid: number | null;
  verdict: Verdict;
};

const LABELS: Record<ScenarioKey, string> = { low: "Экономный", base: "Базовый", high: "Дорогой" };
const r2 = (n: number) => Math.round(n * 100) / 100;
const glue = (t: string) => t.replace(/[  ]/g, " ");
export const rubText = (n: number) => glue(`${n < 0 ? "−" : ""}${Math.round(Math.abs(n)).toLocaleString("ru-RU")} ₽`);
export const signedRub = (n: number) => (n > 0 ? `+${rubText(n)}` : rubText(n));

const lowOf = (r: PriceTableRow) => (r.checked ? Math.min(...r.offers, r.mean) : r.mean) * r.qty;
const highOf = (r: PriceTableRow) => (r.checked ? Math.max(...r.offers, r.mean) : r.mean) * r.qty;

/** Резерв круглой суммой: от 50 тыс. — до 10 тыс., от 5 тыс. — до тысячи, меньше — до сотни. */
export function roundReserve(x: number): number {
  const step = x >= 50_000 ? 10_000 : x >= 5_000 ? 1_000 : 100;
  return Math.round(x / step) * step;
}

// Множественное число вида товара для «Все диваны», «Все стулья»: частые слова — словарём, остальное — по окончанию.
const PLURAL: Record<string, string> = { стул: "стулья", кресло: "кресла", шкаф: "шкафы", стол: "столы", диван: "диваны", кровать: "кровати", тумба: "тумбы", полка: "полки", комод: "комоды", стеллаж: "стеллажи" };
export function pluralOf(word: string): string {
  const w = word.toLowerCase();
  if (PLURAL[w]) return PLURAL[w];
  if (/[гкхжшчщ]$/.test(w)) return `${w}и`;
  if (/[ая]$/.test(w)) return w.slice(0, -1) + (/[гкхжшчщ]а$/.test(w) ? "и" : "ы");
  if (/ь$/.test(w)) return `${w.slice(0, -1)}и`;
  if (/о$/.test(w)) return `${w.slice(0, -1)}а`;
  if (/е$/.test(w)) return `${w.slice(0, -1)}я`;
  return `${w}ы`;
}

const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
// Цвет и размер в скобках — варианты одного товара: «Офисный диван 3-х местный (зеленый)» и «(синий)».
const baseName = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, "").trim();
const extraWords = (name: string, head: string) => tokensOf(baseName(name)).filter((t) => t !== head && !/^\d/.test(t)).sort().join(" ");

/**
 * Самые дорогие позиции. Вместе считаются варианты одного товара (одно название без скобок) и позиции одного вида с близкой ценой за единицу, если одна из них
 * названа просто видом («Диван» и «Офисный диван 3-х местный» → «Все диваны»). Разные товары одного вида («Тумба с ящиком» и «Тумба медицинская», разные столы) — отдельно.
 */
export function topGroups(rows: PriceTableRow[], max = TOP_GROUPS): CostGroup[] {
  const groups: PriceTableRow[][] = [];
  for (const r of rows) {
    const head = headNoun(r.name);
    const found = groups.find((g) => {
      const first = g[0];
      if (baseName(first.name).toLowerCase() === baseName(r.name).toLowerCase()) return true;
      if (!head || headNoun(first.name) !== head) return false;
      const units = [...g, r].map((x) => x.mean);
      const close = Math.min(...units) >= Math.max(...units) * (1 - SAME_PRICE_SPREAD);
      const plain = [...g, r].some((x) => extraWords(x.name, head) === "");
      const sameWords = new Set([...g, r].map((x) => extraWords(x.name, head)).filter(Boolean)).size <= 1;
      return close && plain && sameWords;
    });
    if (found) found.push(r);
    else groups.push([r]);
  }
  return groups
    .map((list): CostGroup => {
      const names = new Set(list.map((r) => baseName(r.name).toLowerCase()));
      const head = headNoun(list[0].name);
      const word = head ? (baseName(list.find((r) => extraWords(r.name, head) === "")?.name ?? "") || null) : null;
      const label = names.size === 1 ? baseName(list[0].name) : word ? `Все ${pluralOf(word)}` : `${baseName(list[0].name)} и похожие`;
      return {
        label: capital(label),
        positions: list.length,
        qty: list.reduce((s, r) => s + r.qty, 0),
        min: r2(list.reduce((s, r) => s + lowOf(r), 0)),
        mean: r2(list.reduce((s, r) => s + r.total, 0)),
        max: r2(list.reduce((s, r) => s + highOf(r), 0)),
      };
    })
    .sort((a, b) => b.mean - a.mean)
    .slice(0, max);
}

export function executionCost(table: CustomerPriceTable, nmck: number | null, opts: { logisticsPct?: Partial<Record<ScenarioKey, number>>; bidDropPct?: number } = {}): ExecutionCost {
  const missing = table.internet?.missing ?? 0;
  const rows = table.rows;
  const min = r2(rows.reduce((s, r) => s + lowOf(r), 0));
  const mean = r2(rows.reduce((s, r) => s + r.total, 0));
  const max = r2(rows.reduce((s, r) => s + highOf(r), 0));
  const pct = { ...LOGISTICS_PCT, ...opts.logisticsPct };
  const drop = opts.bidDropPct ?? BID_DROP_PCT;
  const bid = nmck !== null ? r2(nmck * (1 - drop / 100)) : null;
  const goods: Record<ScenarioKey, number> = { low: min, base: mean, high: max };
  const scenarios = (["low", "base", "high"] as ScenarioKey[]).map((key): CostScenario => {
    const logistics = roundReserve((goods[key] * pct[key]) / 100);
    const total = r2(goods[key] + logistics);
    return { key, label: LABELS[key], goods: goods[key], logistics, total, atNmck: nmck !== null ? r2(nmck - total) : null, atBid: bid !== null ? r2(bid - total) : null };
  });
  const reference = nmck ?? table.printedTotal;
  const matchesNmck = reference === null ? null : Math.abs(reference - mean) <= Math.max(1, reference * 0.0005);
  const top = topGroups(rows);
  return {
    rows: rows.length,
    unchecked: rows.filter((r) => !r.checked).length,
    min,
    mean,
    max,
    matchesNmck,
    top,
    topShare: mean > 0 ? top.reduce((s, g) => s + g.mean, 0) / mean : 0,
    scenarios,
    logisticsPct: pct,
    bidDropPct: drop,
    bid,
    // Цен в интернете нет хотя бы по одной позиции и цены заказчика тоже нет: итог неполный, вывод «можно / нельзя» по нему делать нельзя.
    verdict: missing > 0 ? { tone: "warn", title: "Цен найдено не по всем позициям", text: `Итог неполный: по ${missing} ${missing === 1 ? "позиции" : "позициям"} цены нет ни в интернете, ни у заказчика — вывод об участии делать рано. Запросите у поставщиков цены на эти позиции.` } : verdictOf(scenarios, bid, drop),
  };
}

function verdictOf(scenarios: CostScenario[], bid: number | null, drop: number): Verdict {
  const [low, base] = scenarios;
  if (low.atNmck === null || base.atNmck === null) {
    return { tone: "warn", title: "Начальной цены нет", text: `Исполнение стоит от ${rubText(low.total)} до ${rubText(scenarios[2].total)} — сравните со своей ценой.` };
  }
  const atBid = low.atBid !== null && bid !== null ? ` Даже предложение на ${drop} % ниже — ${rubText(bid)} — оставит в экономном сценарии ${signedRub(low.atBid)} до прочих расходов.` : "";
  if (base.atNmck >= 0) {
    return { tone: "good", title: "Можно участвовать", text: `Даже по средним ценам поставщиков с доставкой остаётся ${signedRub(base.atNmck)}.${atBid}` };
  }
  if (low.atNmck > 0) {
    return {
      tone: "warn",
      title: "Интересно, но рискованно",
      text: `Прибыль есть только при самых низких ценах поставщиков (${signedRub(low.atNmck)}), по средним — ${signedRub(base.atNmck)}. Не снижайте цену до получения письменных цен на весь комплект с доставкой и сборкой.${atBid}`,
    };
  }
  return { tone: "danger", title: "Убыточно", text: `Даже по самым низким ценам поставщиков с доставкой остаётся ${signedRub(low.atNmck)}.` };
}

/** Строка подписи внизу экрана закупки: разброс по таблице заказчика и остаток по средним ценам с доставкой. */
export function executionFinding(c: ExecutionCost): FindingLine {
  const base = c.scenarios[1];
  const rest = base.atNmck !== null ? `; по средним ценам с доставкой остаток ${signedRub(base.atNmck)}` : "";
  return { label: "Цены заказчика", text: `по ${c.rows} позициям: от ${rubText(c.min)} до ${rubText(c.max)}${rest} — ${c.verdict.title.toLowerCase()}`, tone: c.verdict.tone };
}
