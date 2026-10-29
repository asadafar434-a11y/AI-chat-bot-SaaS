// Сравнение цен заказчика с ценами в интернете по каждой позиции (владелец, 29.10.2026: «поиск в интернете нужен обязательно! и сопоставление цен»).
// У заказчика — цены поставщиков из таблицы обоснования (customer-price-table.ts), в интернете — закупочные цены и ближайшие аналоги (position-prices.ts).
// Позиция закупки и строка таблицы сопоставляются по виду товара, словам названия и количеству; названия у них разные («Офисное кресло» и «Офисное кресло Chairman 696 LT»).
// Без ИИ; модуль без зависимостей от браузера и сервера.

import { parseAmount, type RicPosition } from "@/lib/indicative-price";
import type { CustomerPriceTable, PriceTableRow } from "@/lib/customer-price-table";
import { headNoun, tokensOf } from "@/lib/market-observations";
import type { PositionPriceRow, PositionPrices } from "@/lib/position-prices";

type Named = { id: string; name: string; qty: string };

const MIN_SCORE = 0.35;
const words = (name: string) => new Set(tokensOf(name).filter((t) => !/^\d/.test(t)));

function score(p: Named, r: PriceTableRow, sameOrder: boolean): number {
  const hp = headNoun(p.name);
  const hr = headNoun(r.name);
  if (hp && hr && hp !== hr) return 0;
  const a = words(p.name);
  const b = words(r.name);
  const common = [...a].filter((t) => b.has(t)).length;
  const jaccard = common / Math.max(1, new Set([...a, ...b]).size);
  const qty = parseAmount(p.qty);
  return jaccard + (qty !== null && qty === r.qty ? 0.3 : 0) + (sameOrder ? 0.25 : 0);
}

/** Строка таблицы заказчика для каждой позиции: лучшие пары по виду товара, словам и количеству (каждая строка — одной позиции); позиций и строк поровну — порядок тоже в счёт. */
export function matchTableRows(positions: Named[], rows: PriceTableRow[]): Map<string, PriceTableRow> {
  const sameCount = positions.length === rows.length;
  const pairs = positions.flatMap((p, i) => rows.map((r, j) => ({ p, r, j, s: score(p, r, sameCount && i === j) })));
  pairs.sort((x, y) => y.s - x.s);
  const out = new Map<string, PriceTableRow>();
  const used = new Set<number>();
  for (const { p, r, j, s } of pairs) {
    if (s < MIN_SCORE || out.has(p.id) || used.has(j)) continue;
    out.set(p.id, r);
    used.add(j);
  }
  return out;
}

/** Позиции с ценой заказчика за единицу из таблицы обоснования (если своей нет): по ней поиск в интернете начинается с самых дорогих видов товара, а на экране видно отличие от закупки. */
export function withTablePrices<T extends RicPosition>(positions: T[], table: CustomerPriceTable | null): T[] {
  if (!table) return positions;
  const match = matchTableRows(positions, table.rows);
  return positions.map((p) => {
    const row = match.get(p.id);
    return row && p.customerUnit === undefined ? { ...p, customerUnit: row.mean } : p;
  });
}

export type WebPrice = { kind: "exact" | "analog"; from: number; to: number; mid: number; n: number; host: string | null };
export type CompareRow = {
  id: string;
  name: string;
  qty: number;
  /** Цены поставщиков заказчика за единицу. */
  customer: { min: number; mean: number; max: number };
  /** Цена в интернете за единицу в основе НДС заказчика. */
  web: WebPrice;
  /** Середина цен в интернете к средней заказчика, %: минус — в интернете дешевле. */
  diffPct: number;
  where: "below" | "inside" | "above";
  /** В 2–3 раза дешевле самой низкой или дороже самой высокой цены заказчика: «проверьте, тот ли товар». */
  suspicious: boolean;
};
export type PriceCompare = {
  rows: CompareRow[];
  /** Позиций с ценой заказчика (сопоставились со строкой таблицы). */
  matched: number;
  exact: number;
  analog: number;
  /** Средняя разница по позициям с точной ценой в интернете, %; null — таких нет. */
  exactDiffPct: number | null;
};

const r1 = (n: number) => Math.round(n * 10) / 10;

function webOf(row: PositionPriceRow, vatFactor: number): WebPrice | null {
  if ((row.state === "found" || row.state === "few") && row.range) {
    const mid = row.median ?? (row.range.from + row.range.to) / 2;
    return { kind: "exact", from: row.range.from * vatFactor, to: row.range.to * vatFactor, mid: mid * vatFactor, n: row.n, host: row.sources[0]?.host ?? null };
  }
  if (row.analogs) {
    const a = row.analogs;
    return { kind: "analog", from: a.range.from * vatFactor, to: a.range.to * vatFactor, mid: ((a.range.from + a.range.to) / 2) * vatFactor, n: a.n, host: a.sources[0]?.host ?? null };
  }
  return null;
}

/**
 * Цены заказчика ↔ цены в интернете по позициям. vatFactor — пересчёт цен из интернета (без НДС) в основу заказчика: 1,22 при начальной цене с НДС 22 %, 1 — без НДС.
 * Самые дорогие у заказчика позиции — первыми.
 */
export function comparePrices(prices: PositionPrices, table: CustomerPriceTable, vatFactor = 1): PriceCompare {
  const match = matchTableRows(prices.rows, table.rows);
  const rows: CompareRow[] = [];
  for (const row of prices.rows) {
    const t = match.get(row.id);
    const web = t ? webOf(row, vatFactor) : null;
    if (!t || !web) continue;
    const min = t.checked ? Math.min(...t.offers, t.mean) : t.mean;
    const max = t.checked ? Math.max(...t.offers, t.mean) : t.mean;
    rows.push({
      id: row.id,
      name: row.name,
      qty: t.qty,
      customer: { min, mean: t.mean, max },
      web,
      diffPct: r1(((web.mid - t.mean) / t.mean) * 100),
      where: web.mid < min ? "below" : web.mid > max ? "above" : "inside",
      suspicious: web.mid * SUSPICIOUS_FACTOR < min || web.mid > max * SUSPICIOUS_FACTOR,
    });
  }
  rows.sort((a, b) => b.customer.mean * b.qty - a.customer.mean * a.qty);
  const exactRows = rows.filter((r) => r.web.kind === "exact");
  return {
    rows,
    matched: match.size,
    exact: exactRows.length,
    analog: rows.length - exactRows.length,
    exactDiffPct: exactRows.length > 0 ? r1(exactRows.reduce((s, r) => s + r.diffPct, 0) / exactRows.length) : null,
  };
}

// ——— Правдоподобие цен из интернета ———
// Цена из интернета в 3 раза ниже самой низкой цены поставщиков заказчика (или в 3 раза выше самой высокой) — почти наверняка не тот товар
// (экзамен 29.10.2026: «Диван офисный» за 1 502 ₽ при 62–90 тыс. у заказчика — чехол или подушка): такая цена в расчёт и сравнение не идёт.
// В 2–3 раза ниже или выше — цена остаётся, но в сравнении помечена «проверьте, тот ли товар».

export const IMPLAUSIBLE_FACTOR = 3;
export const SUSPICIOUS_FACTOR = 2;

export type PriceBounds = Map<string, { min: number; max: number }>;

/** Самая низкая и самая высокая цена поставщиков заказчика за единицу — по каждой позиции, сопоставленной со строкой таблицы. */
export function tableBounds(positions: Named[], table: CustomerPriceTable | null): PriceBounds {
  const out: PriceBounds = new Map();
  if (!table) return out;
  for (const [id, r] of matchTableRows(positions, table.rows)) {
    out.set(id, { min: r.checked ? Math.min(...r.offers, r.mean) : r.mean, max: r.checked ? Math.max(...r.offers, r.mean) : r.mean });
  }
  return out;
}

/** Найденное без неправдоподобных цен; у результата позиции — сколько цен отброшено (implausible). vatFactor — пересчёт цен без НДС в основу заказчика. */
export function dropImplausible<T extends { results: { key: string; observations: { priceNoVat: number }[] }[] }>(saved: T, bounds: PriceBounds, vatFactor = 1): T & { dropped: number } {
  let dropped = 0;
  const results = saved.results.map((r) => {
    const b = bounds.get(r.key);
    if (!b) return r;
    const kept = r.observations.filter((o) => {
      const p = o.priceNoVat * vatFactor;
      return p * IMPLAUSIBLE_FACTOR >= b.min && p <= b.max * IMPLAUSIBLE_FACTOR;
    });
    const n = r.observations.length - kept.length;
    dropped += n;
    return n > 0 ? { ...r, observations: kept, implausible: n } : r;
  });
  return { ...saved, results, dropped };
}
