// Таблица обоснования начальной цены у заказчика — по позициям: наименование, количество, цены поставщиков 1…6, средняя и итог строки («Братский дом-интернат», 29.10.2026:
// 20 позиций, у каждой три цены из шести столбцов, остальные «0,00»). Код читает её без ИИ и проверяет арифметикой: итог строки = средняя × количество, средняя = среднее
// ненулевых цен поставщиков. Строка, у которой цены поставщиков не сошлись со средней (не прочиталось со снимка), остаётся только со средней и итогом.
// Модуль без зависимостей от браузера и сервера.

import { parseAmount } from "@/lib/indicative-price";
import { cellsOf } from "@/lib/spec-table";

type Doc = { name: string; text: string };

export type PriceTableRow = {
  no: string | null;
  name: string;
  unit: string | null;
  qty: number;
  /** Ненулевые цены поставщиков за единицу; пусто — не сошлись со средней (checked = false). */
  offers: number[];
  /** Средняя цена за единицу из таблицы заказчика. */
  mean: number;
  /** Итог строки из таблицы заказчика (средняя × количество). */
  total: number;
  /** Цены поставщиков сошлись со средней до копейки. */
  checked: boolean;
};

export type CustomerPriceTable = {
  doc: string;
  rows: PriceTableRow[];
  /** Сумма итогов строк. */
  total: number;
  /** «Итого» или «НМЦД составляет …» под таблицей; null — не нашлось. */
  printedTotal: number | null;
  /** Таблица распознана со снимка (картинка в Word, скан): в цифрах возможны ошибки — у каждой строки они сверены арифметикой. */
  fromPicture: boolean;
  /** Таблица собрана не из документов заказчика, а из закупочных цен, найденных в интернете (lib/internet-price-table.ts). */
  internet?: { found: number; analogs: number; filled: number; missing: number };
};

const MIN_ROWS = 3;
const MAX_STAT_COLUMNS = 3;

// Ставки НДС, которые бывают в таблицах обоснования: цены поставщиков записаны без НДС, а «принятая к расчёту» цена и итог — с НДС (ВТЕ, «Обоснование начальной цены» ККБ № 2: 53 746,67 → ×1,10 = 59 121,34).
const VAT_FACTORS = [1.05, 1.07, 1.1, 1.18, 1.2, 1.22];
/** Цены поставщиков в основе итога строки: если итог на ставку НДС выше их средней — цены без НДС, их пересчитывают, иначе минимум и максимум оказались бы в другой основе, чем средняя. */
export function toPriceBasis(offers: number[], price: number): number[] {
  const avg = offers.reduce((s, x) => s + x, 0) / offers.length;
  const ratio = price / avg;
  const vat = VAT_FACTORS.find((f) => Math.abs(ratio - f) <= 0.0015);
  return vat ? offers.map((x) => r2(x * vat)) : offers;
}
const r2 = (n: number) => Math.round(n * 100) / 100;
/** Последним в окне цен бывает столбец «среднее цен поставщиков» (равен среднему остальных): это не предложение поставщика. */
function withoutAverage(offers: number[]): number[] {
  if (offers.length < 4) return offers;
  const rest = offers.slice(0, -1);
  const avg = rest.reduce((s, x) => s + x, 0) / rest.length;
  return Math.abs(offers[offers.length - 1] - avg) <= 0.011 ? rest : offers;
}

const sameMean = (avg: number, mean: number) => Math.abs(avg - mean) <= Math.max(0.011, Math.abs(mean) * 1e-6);
// Итог строки считают от неокруглённой средней: 6 905,0667 × 7 = 48 335,47, а напечатано 48 335,49 (6 905,07 × 7) — допуск несколько копеек на единицу.
const sameTotal = (mean: number, qty: number, total: number) => Math.abs(mean * qty - total) <= Math.max(0.05, qty * 0.006, total * 1e-5);
const UNIT = /^(?:шт\.?|штук[а-я]*|компл\.?|комплект[а-я]*|упак\.?|кг|т|тонн[а-я]*|м|м2|м²|м3|м³|л|пог\.?\s*м|пар[аы]?|ед\.?|усл\.?\s*ед\.?)$/i;
// Подписи строки, а не наименование: «Цена за единицу … с учетом НДС», «в соответствии с Техническим заданием».
const NOT_NAME = /^(?:цена\s+за\s+единицу|стоимост|в\s+соответствии\s+с)/i;
const MAX_OFFERS_RUN = 12;

const headOf = (cells: string[], before: number, qty: number) => {
  const texts = cells.slice(0, before).filter((c) => /\p{L}{3}/u.test(c) && !UNIT.test(c.trim()));
  const named = texts.filter((c) => !NOT_NAME.test(c.trim()));
  const unitCell = cells.slice(0, before).reverse().find((c) => UNIT.test(c.trim()));
  return { no: /^\d{1,4}\.?$/.test(cells[0].trim()) ? cells[0].trim().replace(/\.$/, "") : null, name: (named.length > 0 ? named : texts).join(" · ").slice(0, 200), unit: unitCell?.trim() ?? null, qty };
};

/** Количество и итог: до цен поставщиков (кол-во → цены … → итог) или после средней (… средняя → [принятая цена] → кол-во → итог). Итог = цена × количество, где цена — средняя или «принятая к расчёту» после неё. */
function qtyAndTotal(nums: (number | null)[], start: number, e: number, mean: number): { qty: number; price: number; total: number; before: boolean } | null {
  const prices = (upTo: number) => [mean, ...(nums.slice(e + 1, upTo).filter((x) => x !== null && x > 0) as number[])];
  const before = nums[start - 1];
  if (before !== null && before !== undefined && before > 0 && before <= 10_000_000) {
    for (let j = e + 1; j <= Math.min(nums.length - 1, e + 3); j++) {
      const total = nums[j];
      if (total === null || !(total > 0)) continue;
      const price = prices(j).find((p) => sameTotal(p, before, total));
      if (price !== undefined) return { qty: before, price, total, before: true };
    }
  }
  for (let j = e + 1; j <= Math.min(nums.length - 2, e + 4); j++) {
    const qty = nums[j];
    const total = nums[j + 1];
    if (qty === null || total === null || !(qty > 0) || !(total > 0)) continue;
    const price = prices(j).find((p) => sameTotal(p, qty, total));
    if (price !== undefined) return { qty, price, total, before: false };
  }
  return null;
}

/**
 * Одна строка таблицы обоснования. Цены поставщиков — подряд идущие числа (нули — «поставщик цену не дал» — пропускаются), чьё среднее равно «средней» в той же строке
 * (между ними — до трёх столбцов статистики); количество и итог — до или после них (qtyAndTotal). Цены не сошлись со средней — строка берётся только со средней и итогом.
 */
export function parsePriceRow(line: string): PriceTableRow | null {
  if (!line.includes(" | ") && !line.includes("\t")) return null;
  const cells = cellsOf(line);
  const nums = cells.map((c) => (/\d/.test(c) && !/\d\.\d+\.\d/.test(c) ? parseAmount(c) : null));
  for (let e = 3; e < cells.length; e++) {
    const mean = nums[e];
    if (mean === null || !(mean > 0)) continue;
    for (let k = e - 1; k >= Math.max(1, e - 1 - MAX_STAT_COLUMNS); k--) {
      for (let s = k - 1; s >= Math.max(1, k - MAX_OFFERS_RUN); s--) {
        if (nums[s] === null) break;
        const offers = (nums.slice(s, k + 1) as number[]).filter((x) => x > 0);
        if (offers.length < 2 || !sameMean(offers.reduce((a, x) => a + x, 0) / offers.length, mean)) continue;
        const found = qtyAndTotal(nums, s, e, mean);
        if (!found) continue;
        const head = headOf(cells, found.before ? s - 1 : s, found.qty);
        if (!head.name) continue;
        return { ...head, offers: toPriceBasis(withoutAverage(offers), found.price), mean: found.price, total: found.total, checked: true };
      }
    }
  }
  // Цены поставщиков не сошлись (не прочиталось со снимка): количество → числа → средняя → итог = средняя × количество.
  for (let q = 1; q < cells.length - 3; q++) {
    const qty = nums[q];
    if (qty === null || !(qty > 0) || qty > 1_000_000) continue;
    for (let e = q + 3; e < cells.length - 1; e++) {
      const mean = nums[e];
      const total = nums[e + 1];
      if (mean === null || total === null || !(mean > 0) || !sameTotal(mean, qty, total)) continue;
      if (!nums.slice(q + 1, e).every((x) => x !== null)) continue;
      const head = headOf(cells, q, qty);
      if (head.name) return { ...head, offers: [], mean, total, checked: false };
    }
  }
  // Часть цифр поставщиков закрыта водяным знаком или «(неразборчиво)» (снимок страницы с надписью «Страница 1»), но средняя и итог читаются: берём количество, среднюю
  // и итог — две последние цифры строки, итог = средняя × количество. Цены поставщиков такой строки неизвестны: минимум и максимум у неё равны средней (checked = false).
  const tail = nums.map((x, i) => ({ x, i })).filter((c) => c.x !== null);
  if (tail.length >= 4) {
    const total = tail[tail.length - 1].x!;
    const mean = tail[tail.length - 2].x!;
    if (mean > 0 && total > 0) {
      for (let q = 1; q < tail[tail.length - 2].i; q++) {
        const qty = nums[q];
        if (qty === null || !(qty > 0) || qty > 1_000_000 || !sameTotal(mean, qty, total)) continue;
        // Между количеством и средней — столбцы цен поставщиков и статистики (не меньше четырёх ячеек): иначе это спецификация «количество, цена, сумма», а не обоснование.
        if (tail[tail.length - 2].i - q < 4) continue;
        const head = headOf(cells, q, qty);
        if (head.name && cells.slice(0, q).some((c) => /\p{L}{3}/u.test(c))) return { ...head, offers: [], mean, total, checked: false };
      }
    }
  }
  return null;
}

const PRINTED_TOTAL = /(?:итого|нмц[дк]?\s*(?:\([^)]*\)\s*)?составляет|начальн[а-яё]+\s+\(?максимальн[а-яё]+\)?\s+цен[а-яё]+\s+(?:договора|контракта)\s+составляет)[^\d\n]{0,40}(\d[\d\s  ]*[.,]\d{2})/gi;

function printedTotalNear(text: string, total: number): number | null {
  const found: number[] = [];
  for (const m of text.matchAll(PRINTED_TOTAL)) {
    const v = parseAmount(m[1]);
    if (v !== null) found.push(v);
  }
  // Строка таблицы «Итого: | … | 117715500»: числа ячеек, в том числе без копеек.
  for (const line of text.split("\n")) {
    if (!/^\s*\|?\s*итого/i.test(line) || (!line.includes(" | ") && !line.includes("\t"))) continue;
    for (const c of cellsOf(line)) {
      const v = /\d/.test(c) ? parseAmount(c) : null;
      if (v !== null && v > 0) found.push(v);
    }
  }
  return found.reduce<number | null>((best, v) => (best === null || Math.abs(v - total) < Math.abs(best - total) ? v : best), null);
}

const sameSum = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, b * 0.0005);

/**
 * Таблица обоснования начальной цены по позициям: документ, в котором больше всего таких строк — не меньше трёх, сверенных арифметикой, и это не меньше 60 % строк;
 * или все строки сверены и их сумма равна «Итого» под таблицей (так бывает у закупки из одной позиции).
 */
export function findCustomerPriceTable(documents: Doc[]): CustomerPriceTable | null {
  let best: CustomerPriceTable | null = null;
  for (const doc of documents) {
    const rows: PriceTableRow[] = [];
    const seen = new Set<string>();
    let firstAt = -1;
    doc.text.split("\n").forEach((line, i) => {
      const row = parsePriceRow(line);
      if (!row) return;
      const key = `${row.no}|${row.name}|${row.qty}|${row.total}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (firstAt < 0) firstAt = i;
      rows.push(row);
    });
    const checked = rows.filter((r) => r.checked).length;
    if (checked === 0) continue;
    const total = Math.round(rows.reduce((s, r) => s + r.total, 0) * 100) / 100;
    const printedTotal = printedTotalNear(doc.text, total);
    const enough = checked >= MIN_ROWS && checked >= rows.length * 0.6;
    const confirmed = checked === rows.length && printedTotal !== null && sameSum(printedTotal, total);
    if (!enough && !confirmed) continue;
    if (best && best.rows.length >= rows.length) continue;
    const before = doc.text.split("\n").slice(Math.max(0, firstAt - 40), firstAt).join("\n");
    best = { doc: doc.name, rows, total, printedTotal, fromPicture: /Картинка в документе[^\n]*\(распознано\)/.test(before) };
  }
  return best;
}
