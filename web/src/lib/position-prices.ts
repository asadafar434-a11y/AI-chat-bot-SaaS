// Товары закупки и их закупочные цены из интернета (lib/price-cache.ts) — по позициям, с источником и датой. Без ИИ: показывается только то, что нашли и проверили (price-extract.ts),
// нет цены — так и сказано, ничего не выдумывается. Рынок — только закупочная цена (за сколько можно купить), цены контрактов сюда не попадают (lib/price-basis.ts).

import { parseAmount, type RicData } from "@/lib/indicative-price";
import { comparable, marketStats, type Observation } from "@/lib/market-observations";
import type { PriceState, SavedPrices } from "@/lib/price-cache";
import { cleanProductName } from "@/lib/prices-request";

export type PriceSource = { host: string; product: string; price: number; date: string; url: string | null };

/** found — цен хватает для вывода (не меньше пяти); few — найдены, но мало; none — искали, подходящих нет; searching / off / failed — поиск идёт, выключен, не удался; not-searched — по этой позиции не искали. */
export type PositionPriceState = "found" | "few" | "none" | "searching" | "off" | "failed" | "not-searched";

export type PositionPriceRow = {
  id: string;
  name: string;
  unit: string;
  qty: string;
  customerUnit: number | null;
  state: PositionPriceState;
  /** Закупочная цена за единицу без НДС: медиана сопоставимых цен; null — для вывода цен мало. */
  median: number | null;
  range: { from: number; to: number } | null;
  /** Сколько сопоставимых цен найдено. */
  n: number;
  /** Начальная цена заказчика к закупочной медиане в основе НДС заказчика, %. Плюс — заказчик заложил больше, чем стоит закупка. */
  gapPct: number | null;
  /** До трёх цен, ближайших к медиане, с поставщиком, датой и ссылкой. */
  sources: PriceSource[];
  /** Закупочная стоимость позиции: медиана × количество; null — нет медианы или количества. */
  cost: number | null;
  /** Все сопоставимые цены без НДС за единицу, по возрастанию (для расчёта себестоимости). */
  unitPrices: number[];
};

export type PositionPrices = {
  rows: PositionPriceRow[];
  /** Позиций, по которым есть закупочная цена для вывода. */
  priced: number;
  /** Закупочная стоимость тех позиций, у которых есть цена и количество; null — таких нет. */
  cost: number | null;
  costPositions: number;
  /** Самая свежая дата среди показанных цен. */
  asOf: string | null;
};

/** Заказчик сам пишет, что технические требования (список товаров) идут отдельным файлом, а такого файла в закупке нет — без него искать цены не по чему. Пусто — всё на месте или заказчик об этом молчит. */
const SPEC_SEPARATE = /техническ[а-яё]+\s+(?:требовани[а-яё]+|задани[а-яё]+)[^\n]{0,240}отдельн|отдельн[^\n]{0,120}техническ[а-яё]+\s+(?:требовани[а-яё]+|задани[а-яё]+)/i;
const SPEC_FILE = /техническ|техзадан|спецификац|(?<![а-яёa-z0-9])тз(?![а-яёa-z0-9])|приложение\s*№?\s*1(?![0-9])/i;

export function missingSpecNote(docs: { name: string; text: string }[]): string | null {
  if (docs.length === 0 || !docs.some((d) => SPEC_SEPARATE.test(d.text))) return null;
  if (docs.some((d) => SPEC_FILE.test(d.name))) return null;
  return `проверила все файлы (${docs.length}): списка товаров с количеством нет, только название лота. Заказчик пишет, что технические требования идут отдельным файлом (Приложение № 1) — добавьте его в закупку, тогда появятся товары и закупочные цены`;
}

const hostOf = (source: string): string => {
  const head = source.split(": ")[0]?.trim() ?? "";
  return /^[\w.-]{3,80}$/.test(head) ? head : "поставщик";
};

const urlOf = (source: string): string | null => {
  const m = /;\s*(https?:\/\/\S+)\s*$/.exec(source);
  if (!m) return null;
  try {
    const u = new URL(m[1]);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
};

const sourceOf = (o: Observation): PriceSource => ({ host: hostOf(o.source), product: o.name, price: o.priceNoVat, date: o.observedAt, url: urlOf(o.source) });

const glue = (t: string) => t.replace(/[\u00a0\u202f]/g, " ");
const rub = (n: number) => glue(`${Math.round(n).toLocaleString("ru-RU")} ₽`);

/** Короткие строки про найденные цены — для подписи внизу экрана и подсказки ценового бейджа. Даже одна найденная цена называется целиком (поставщик и дата), а не «цен мало»: решение владельца 23.10.2026. */
export function priceLines(prices: PositionPrices): string[] {
  return prices.rows.flatMap((r) => {
    const name = `«${cleanProductName(r.name)}»`;
    if (r.state === "found" && r.median !== null && r.range) return [`${name}: ${rub(r.median)} за ${r.unit || "ед."} (диапазон ${rub(r.range.from)} – ${rub(r.range.to)}, цен ${r.n})`];
    if (r.state !== "few" || !r.range) return [];
    if (r.n === 1) return [`${name}: ${rub(r.range.from)} за ${r.unit || "ед."} — ${r.sources[0]?.host ?? "поставщик"}, одна цена`];
    return [`${name}: ${rub(r.range.from)} – ${rub(r.range.to)} за ${r.unit || "ед."}, цен ${r.n} (для вывода нужно не меньше пяти)`];
  });
}

// ——— Себестоимость закупки по найденным закупочным ценам ———

export type CostLine = { id: string; name: string; qty: number; unit: number; sum: number };
export type PurchaseCost = {
  /** Сумма по всем позициям; null — хотя бы по одной позиции нет цены или количества: полную себестоимость закупки назвать нельзя. */
  total: number | null;
  /** По скольким позициям есть и цена, и количество; из скольких всего. */
  covered: number;
  of: number;
  /** Сумма по тем позициям, где она посчитана (когда total = null). */
  partial: number | null;
  lines: CostLine[];
};

const median = (sorted: number[]) => (sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);

/** Цена единицы для расчёта: медиана найденных цен; цен одна — она; цен две — большая (запас: «лучше недооценить прибыль, чем переоценить»). Цены без НДС. */
export const unitForCost = (row: Pick<PositionPriceRow, "unitPrices" | "median">): number | null => {
  const p = row.unitPrices;
  if (p.length === 0) return null;
  if (p.length === 2) return p[1];
  return row.median ?? median(p);
};

/**
 * Себестоимость закупки по найденным закупочным ценам: цена единицы × количество по каждой позиции, плюс НДС, если начальная цена с НДС (покупаете вы тоже с НДС; лекарства из реестра предельных цен — 10 %).
 * Только то, что найдено: позиции без цены или количества в сумму не входят, и тогда полной суммы нет (total = null). Доставка, работа и ваши расходы сюда не входят.
 */
export function purchaseCost(prices: PositionPrices, opts: { withVat: boolean; vatRate: number }): PurchaseCost {
  const lines: CostLine[] = [];
  for (const r of prices.rows) {
    const unit = unitForCost(r);
    const qty = parseAmount(r.qty);
    if (unit === null || qty === null || qty <= 0) continue;
    const rate = r.sources.some((s) => s.host === "grls.rosminzdrav.ru") ? 10 : opts.vatRate;
    const gross = opts.withVat ? unit * (1 + rate / 100) : unit;
    lines.push({ id: r.id, name: r.name, qty, unit: Math.round(gross * 100) / 100, sum: Math.round(gross * qty * 100) / 100 });
  }
  const sum = lines.reduce((s, l) => s + l.sum, 0);
  const of = prices.rows.length;
  return { total: of > 0 && lines.length === of ? Math.round(sum * 100) / 100 : null, covered: lines.length, of, partial: lines.length > 0 ? Math.round(sum * 100) / 100 : null, lines };
}

export function positionPrices(data: RicData, saved: SavedPrices | null | undefined, searchedIds: string[], state: PriceState, today: string): PositionPrices {
  const searched = new Set(searchedIds);
  const results = new Map((saved?.results ?? []).map((r) => [r.key, r.observations]));
  const rows = data.positions.map((p): PositionPriceRow => {
    const quantity = parseAmount(p.qty);
    const customerUnit = p.customerUnit !== undefined && p.customerUnit > 0 ? p.customerUnit : null;
    const empty = { id: p.id, name: p.name, unit: p.unit, qty: p.qty, customerUnit, median: null, range: null, n: 0, gapPct: null, sources: [] as PriceSource[], cost: null, unitPrices: [] as number[] };
    if (!searched.has(p.id)) return { ...empty, state: "not-searched" };
    if (state !== "done") return { ...empty, state: state === "off" ? "off" : state === "failed" ? "failed" : "searching" };
    const target = { name: p.name, unit: p.unit, quantity: quantity !== null && quantity > 0 ? quantity : null };
    const usable = (results.get(p.id) ?? []).filter((o) => comparable(target, o).ok);
    if (usable.length === 0) return { ...empty, state: "none" };
    const stats = marketStats(target, usable, today);
    const median = stats.status !== "insufficient" ? stats.median : null;
    const prices = usable.map((o) => o.priceNoVat);
    const range = stats.range ?? { from: Math.min(...prices), to: Math.max(...prices) };
    const around = median ?? prices.reduce((s, x) => s + x, 0) / prices.length;
    const sources = [...usable].sort((a, b) => Math.abs(a.priceNoVat - around) - Math.abs(b.priceNoVat - around)).slice(0, 3).map(sourceOf);
    const inBasis = median === null ? null : data.settings.nmckVat === "with" ? median * (1 + data.settings.vatRate / 100) : median;
    return {
      ...empty,
      state: median === null ? "few" : "found",
      median,
      range,
      n: usable.length,
      gapPct: inBasis !== null && customerUnit !== null ? ((customerUnit - inBasis) / inBasis) * 100 : null,
      sources,
      cost: median !== null && quantity !== null && quantity > 0 ? Math.round(median * quantity * 100) / 100 : null,
      unitPrices: [...prices].sort((a, b) => a - b),
    };
  });
  const costRows = rows.filter((r) => r.cost !== null);
  const dates = rows.flatMap((r) => r.sources.map((s) => s.date)).sort();
  return {
    rows,
    priced: rows.filter((r) => r.state === "found").length,
    cost: costRows.length > 0 ? Math.round(costRows.reduce((s, r) => s + r.cost!, 0) * 100) / 100 : null,
    costPositions: costRows.length,
    asOf: dates.length > 0 ? dates[dates.length - 1] : null,
  };
}
