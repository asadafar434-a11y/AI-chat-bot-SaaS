// Расчёт «Сколько стоит исполнение» без таблицы цен заказчика (владелец, 29.10.2026: «при чём тут картинка? загружу другой тендер без картинки — как ты будешь искать?»).
// Таблицу строим из закупочных цен, найденных в интернете (position-prices.ts), по всем позициям закупки: минимум, средняя (медиана) и максимум — по найденным ценам; количество — из документов.
//   • точные цены — как есть; • нет точной цены, но есть аналоги — берётся их диапазон (в подписи отмечено); • нет ни тех ни других — цена заказчика за единицу, если она есть в документах
//     (по такой позиции прибыли нет: цена заказчика = затраты); • нет и её — позиция «без цены», итог неполный и вывод «можно / нельзя» не делается.
// Цены в интернете без НДС: vatFactor пересчитывает их в основу начальной цены. Модуль без зависимостей от браузера и сервера.

import { parseAmount } from "@/lib/indicative-price";
import type { CustomerPriceTable, PriceTableRow } from "@/lib/customer-price-table";
import type { PositionPriceRow, PositionPrices } from "@/lib/position-prices";

const r2 = (n: number) => Math.round(n * 100) / 100;

function rowOf(p: PositionPriceRow, vatFactor: number): { row: PriceTableRow | null; kind: "found" | "analog" | "filled" | "missing" } {
  const qty = parseAmount(p.qty);
  if (qty === null || !(qty > 0)) return { row: null, kind: "missing" };
  const base = { no: null, name: p.name, unit: p.unit || null, qty };
  if ((p.state === "found" || p.state === "few") && p.unitPrices.length > 0) {
    // НДС прибавляется один раз к цене без НДС: и к предложениям, и к средней (раньше у позиции с одной ценой он прибавлялся к средней дважды: 2 600 → 3 172 → 3 870).
    const raw = [...p.unitPrices].sort((a, b) => a - b);
    const sorted = raw.map((x) => r2(x * vatFactor));
    const mean = r2((p.median ?? raw.reduce((s, x) => s + x, 0) / raw.length) * vatFactor);
    return { row: { ...base, offers: sorted, mean, total: r2(mean * qty), checked: true }, kind: "found" };
  }
  if (p.analogs) {
    const from = r2(p.analogs.range.from * vatFactor);
    const to = r2(p.analogs.range.to * vatFactor);
    const mean = r2((from + to) / 2);
    return { row: { ...base, offers: [from, to], mean, total: r2(mean * qty), checked: true }, kind: "analog" };
  }
  if (p.customerUnit !== null && p.customerUnit > 0) {
    return { row: { ...base, offers: [], mean: p.customerUnit, total: r2(p.customerUnit * qty), checked: false }, kind: "filled" };
  }
  return { row: null, kind: "missing" };
}

/** Таблица из цен в интернете по всем позициям; null — не найдено ни одной цены (строить не из чего). */
export function internetPriceTable(prices: PositionPrices | null, vatFactor = 1, doc = "цены из интернета"): CustomerPriceTable | null {
  if (!prices || prices.rows.length === 0) return null;
  const counts = { found: 0, analog: 0, filled: 0, missing: 0 };
  const rows: PriceTableRow[] = [];
  for (const p of prices.rows) {
    const { row, kind } = rowOf(p, vatFactor);
    counts[kind]++;
    if (row) rows.push(row);
  }
  if (counts.found + counts.analog === 0) return null;
  const total = r2(rows.reduce((s, r) => s + r.total, 0));
  return { doc, rows, total, printedTotal: null, fromPicture: false, internet: { found: counts.found, analogs: counts.analog, filled: counts.filled, missing: counts.missing } };
}
