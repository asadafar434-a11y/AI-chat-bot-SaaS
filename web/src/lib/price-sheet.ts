// Единый расчёт цен по позициям — для ЛЮБОЙ закупки (владелец, 29.10.2026: «в одном месте ты так считаешь, в другом по-другому — считай нормально, одинаково»).
// Раньше было два пути: таблица цен заказчика (все позиции) или цены из интернета (обрывки) — одна и та же закупка выглядела то полно, то неполно.
// Теперь по каждой позиции одно правило, источник виден у каждой строки:
//   1. цена из интернета, если нашлась и похожа на правду (не в 2 раза ниже самой низкой и не в 2 раза выше самой высокой цены заказчика);
//   2. иначе цена из документов заказчика (таблица его поставщиков или цена за единицу из спецификации);
//   3. иначе ближайшие аналоги из интернета (другие размеры — ориентир);
//   4. иначе позиция «без цены»: итог неполный, вывод «можно / нельзя» не делается.
// Из этой таблицы считаются разделы блока «Сколько стоит исполнение» (execution-cost.ts). Модуль без зависимостей от браузера и сервера.

import { parseAmount } from "@/lib/indicative-price";
import type { CustomerPriceTable, PriceTableRow } from "@/lib/customer-price-table";
import { matchTableRows } from "@/lib/price-compare";
import type { PositionPriceRow, PositionPrices } from "@/lib/position-prices";

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Цена из интернета, в 2 раза ниже самой низкой или в 2 раза выше самой высокой цены заказчика, — похоже, не тот товар: берётся цена из документа. */
export const WEB_DIFFERS_FACTOR = 2;

export type PriceSource = "internet" | "document" | "analog" | "none";
export type SheetRow = {
  id: string;
  name: string;
  qty: number | null;
  /** Цены поставщиков заказчика за единицу (мин, средняя, макс); null — в документах нет. */
  doc: { min: number; mean: number; max: number } | null;
  /** Цена в интернете за единицу в основе начальной цены (с НДС, если НМЦ с НДС); null — не нашлась. */
  web: { kind: "exact" | "analog"; from: number; to: number; mid: number; n: number; host: string | null } | null;
  /** Какая цена пошла в расчёт. */
  used: PriceSource;
  /** Цена в интернете сильно отличалась от цены в документе — взята цена из документа. */
  webDiffers: boolean;
  /** Стоимость позиции в расчёте (средняя × количество); null — позиция без цены или без количества. */
  total: number | null;
};

export type PriceSheet = {
  rows: SheetRow[];
  /** Таблица для расчёта (execution-cost.ts); null — нечего считать. */
  table: CustomerPriceTable | null;
  counts: { internet: number; document: number; analog: number; missing: number };
};

const docOf = (r: PriceTableRow) => (r.checked ? { min: Math.min(...r.offers, r.mean), mean: r.mean, max: Math.max(...r.offers, r.mean) } : { min: r.mean, mean: r.mean, max: r.mean });

function webOf(p: PositionPriceRow, vat: number): SheetRow["web"] {
  if ((p.state === "found" || p.state === "few") && p.unitPrices.length > 0) {
    const raw = [...p.unitPrices].sort((a, b) => a - b);
    const mid = p.median ?? raw.reduce((s, x) => s + x, 0) / raw.length;
    return { kind: "exact", from: r2(raw[0] * vat), to: r2(raw[raw.length - 1] * vat), mid: r2(mid * vat), n: raw.length, host: p.sources[0]?.host ?? null };
  }
  if (p.analogs) {
    const a = p.analogs;
    return { kind: "analog", from: r2(a.range.from * vat), to: r2(a.range.to * vat), mid: r2(((a.range.from + a.range.to) / 2) * vat), n: a.n, host: a.sources[0]?.host ?? null };
  }
  return null;
}

/** vat — пересчёт цен из интернета (без НДС) в основу начальной цены: 1,22 при НМЦ с НДС 22 %, 1 — без НДС. */
export function buildPriceSheet(prices: PositionPrices | null, customer: CustomerPriceTable | null, vat = 1): PriceSheet {
  const rows: SheetRow[] = [];
  const tableRows: PriceTableRow[] = [];
  const counts = { internet: 0, document: 0, analog: 0, missing: 0 };
  const positions = prices?.rows ?? [];

  if (positions.length === 0 && customer) {
    // Позиций из документов нет — считаем по таблице заказчика как есть.
    for (const r of customer.rows) {
      rows.push({ id: r.name, name: r.name, qty: r.qty, doc: docOf(r), web: null, used: "document", webDiffers: false, total: r2(r.mean * r.qty) });
      tableRows.push(r);
      counts.document++;
    }
  } else {
    const match = customer ? matchTableRows(positions, customer.rows) : new Map<string, PriceTableRow>();
    for (const p of positions) {
      const own = match.get(p.id) ?? null;
      const qty = parseAmount(p.qty) ?? own?.qty ?? null;
      const docRow: PriceTableRow | null = own ?? (p.customerUnit !== null && p.customerUnit > 0 && qty !== null ? { no: null, name: p.name, unit: p.unit || null, qty, offers: [], mean: p.customerUnit, total: r2(p.customerUnit * qty), checked: false } : null);
      const doc = docRow ? docOf(docRow) : null;
      const web = webOf(p, vat);
      const base = { id: p.id, name: p.name, qty, doc, web };
      const hasQty = qty !== null && qty > 0;
      const exact = web?.kind === "exact" ? web : null;
      const differs = Boolean(exact && doc && (exact.mid * WEB_DIFFERS_FACTOR < doc.min || exact.mid > doc.max * WEB_DIFFERS_FACTOR));
      let used: PriceSource = "none";
      if (hasQty && exact && !differs) used = "internet";
      else if (hasQty && docRow) used = "document";
      else if (hasQty && web?.kind === "analog") used = "analog";
      let row: PriceTableRow | null = null;
      if (used === "internet" && exact) {
        const raw = [...p.unitPrices].sort((a, b) => a - b).map((x) => r2(x * vat));
        row = { no: null, name: p.name, unit: p.unit || null, qty: qty!, offers: raw, mean: exact.mid, total: r2(exact.mid * qty!), checked: true };
      } else if (used === "document") row = { ...docRow!, name: p.name, qty: qty! , total: r2(docRow!.mean * qty!) };
      else if (used === "analog" && web) row = { no: null, name: p.name, unit: p.unit || null, qty: qty!, offers: [web.from, web.to], mean: web.mid, total: r2(web.mid * qty!), checked: true };
      if (row) tableRows.push(row);
      counts[used === "none" ? "missing" : used]++;
      rows.push({ ...base, used, webDiffers: differs, total: row ? row.total : null });
    }
  }

  const priced = tableRows.length;
  const hasInternet = counts.internet + counts.analog > 0;
  if (priced === 0) return { rows, table: null, counts };
  const total = r2(tableRows.reduce((s, r) => s + r.total, 0));
  const table: CustomerPriceTable = {
    doc: customer?.doc ?? "закупочные цены из интернета",
    rows: tableRows,
    total,
    printedTotal: hasInternet ? null : (customer?.printedTotal ?? null),
    fromPicture: Boolean(customer?.fromPicture),
    internet: { found: counts.internet, analogs: counts.analog, filled: counts.document, missing: counts.missing },
  };
  return { rows: rows.sort((a, b) => (b.total ?? -1) - (a.total ?? -1)), table, counts };
}
