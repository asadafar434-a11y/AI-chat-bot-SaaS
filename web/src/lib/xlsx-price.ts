// Цены в Excel-бланке заказчика (lib/xlsx-form.ts). Три устройства бланка, которые встречаются в закупках:
//  1) «Понижающий коэффициент (К)» одной ячейкой (ДГК): цена участника = начальная цена × К. К считается из цены, выбранной на шаге «Цена»: К = цена / НМЦ.
//  2) Начальная цена за единицу у заказчика и пустая графа «Предлагаемая цена одной единицы» (УСГС): цена участника раскладывается по позициям пропорционально
//     начальным ценам, с точностью до копейки, сумма не выше цены (price-split.ts).
//  3) Графа «Цена за единицу» без начальных цен (тариф «за единицу драйвера» у РВК, ведомость объёмов): цену за единицу называет только участник — строки
//     отдаются на ввод, введённое вписывается в файл.
// Формулы итогов в файле не трогаются: Excel пересчитает их при открытии. Модуль без зависимостей от браузера и сервера.
import { splitPrice, toKop } from "@/lib/price-split";
import { refOf, type CellEdit, type FormCell, type FormSheet } from "@/lib/xlsx-form";

export type FillItem = { sheet: string; ref: string; label: string; value: string; kind: "requisite" | "position" | "price" };

export type PriceInput = {
  /** Начальная (максимальная) цена закупки, руб. */
  nmck: number | null;
  /** Цена участника, выбранная на шаге «Цена», руб. */
  tpPrice: number | null | undefined;
  /** Цены за единицу, которые участник ввёл сам: ключ «лист!ячейка» → число как написано. */
  manual?: Record<string, string>;
};

/** Строка бланка, где цену за единицу называет только участник. */
export type ManualPriceRow = { key: string; sheet: string; ref: string; name: string; qty: number; value: string };

export type PricePlan = { edits: CellEdit[]; filled: FillItem[]; left: string[]; manual: ManualPriceRow[] };

const isBlank = (text: string) => /^[\s….._\-–—]*$/.test(text);
const flat = (text: string) => text.replace(/\s+/g, " ").trim();
const numberOf = (text: string): number | null => {
  const t = text.replace(/\s/g, "").replace(",", ".");
  return t !== "" && /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};
const rowsOf = (sheet: FormSheet): Map<number, FormCell[]> => {
  const rows = new Map<number, FormCell[]>();
  for (const cell of sheet.cells.values()) rows.set(cell.row, [...(rows.get(cell.row) ?? []), cell]);
  for (const list of rows.values()) list.sort((a, b) => a.col - b.col);
  return rows;
};
// Деньги словами: пробелы между тысячами — обычные, чтобы текст можно было искать и сравнивать.
const money = (rub: number) => rub.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, " ");

// ---------- графы по заголовкам ----------

type Kind = "qty" | "base" | "price";
const lower = (text: string) => text.toLowerCase().replace(/ё/g, "е");
function kindOf(header: string): Kind | null {
  const t = lower(flat(header));
  // Начальная цена за единицу у заказчика: «НМЦ единицы…», «предельная цена за единицу», «максимальная цена единицы».
  if (/нмц\s+един|начальн\S*\s+(?:\(?максимальн\S*\)?\s+)?цен\S*\s+(?:за\s+)?един|предельн\S*\s+цен|максимальн\S*\s+цен\S*\s+(?:за\s+)?един/.test(t)) return "base";
  if (/предлагаем\S*\s+цен\S*\s+(?:одной\s+)?(?:за\s+)?един|цен[аы]\s+за\s+(?:1\s+)?ед|цен[аы]\s+единиц/.test(t)) return "price";
  if (/кол-?во|количеств|объ[её]м/.test(t)) return "qty";
  return null;
}

type Header = { row: number; qty: number[]; base: number[]; price: number[] };

function headers(rows: Map<number, FormCell[]>): Header[] {
  const out: Header[] = [];
  for (const [row, cells] of rows) {
    if (cells.filter((c) => !isBlank(c.text)).length < 3) continue;
    const h: Header = { row, qty: [], base: [], price: [] };
    for (const cell of cells) {
      const kind = kindOf(cell.text);
      if (kind) h[kind].push(cell.col);
    }
    if (h.price.length > 0) out.push(h);
  }
  return out;
}

// Из подходящих по заголовку граф берём ту, где под заголовком больше чисел (графа «Метод подсчёта объёма» тоже называется «объём», но числами в ней не пахнет); при равенстве — ближайшую.
function pickColumn(sheet: FormSheet, cols: number[], to: number, fromRow: number, within: number): number | null {
  const numbers = (col: number) => {
    let n = 0;
    for (let row = fromRow + 1; row <= fromRow + 60; row++) if (numberOf(sheet.cells.get(refOf(row, col))?.text ?? "") !== null) n++;
    return n;
  };
  const scored = cols
    .filter((c) => Math.abs(c - to) <= within)
    .map((c) => ({ c, n: numbers(c) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || Math.abs(a.c - to) - Math.abs(b.c - to) || a.c - b.c);
  return scored[0]?.c ?? null;
}

// Строка номеров граф «1 2 3 4 …» под заголовком — не данные.
const isNumbering = (cells: FormCell[]) => {
  const filled = cells.filter((c) => !isBlank(c.text));
  return filled.length > 0 && filled.every((c) => /^\d{1,3}$/.test(c.text.trim()));
};

const nameOf = (cells: FormCell[], skip: Set<number>): string => {
  const hit = cells.find((c) => !skip.has(c.col) && numberOf(c.text) === null && /\p{L}{3,}/u.test(c.text) && !c.formula);
  return hit ? flat(hit.text).slice(0, 120) : "";
};

// ---------- 1. понижающий коэффициент ----------

function planCoefficient(sheet: FormSheet, rows: Map<number, FormCell[]>, price: PriceInput, plan: PricePlan, taken: Set<string>) {
  for (const [row, cells] of rows) {
    if (cells.filter((c) => !isBlank(c.text)).length > 3) continue;
    const label = cells.find((c) => /^понижающ\S*\s+коэффициент/.test(lower(flat(c.text))) && flat(c.text).length < 80);
    if (!label) continue;
    let target: FormCell | null = null;
    for (let col = label.col + (label.span?.cols ?? 1); col <= label.col + (label.span?.cols ?? 1) + 40; col++) {
      const cell = sheet.cells.get(refOf(row, col));
      if (!cell) continue;
      if (!cell.formula && (isBlank(cell.text) || numberOf(cell.text) !== null)) target = cell;
      break;
    }
    if (!target) continue;
    const ref = target.ref;
    if (taken.has(`${sheet.name}!${ref}`)) continue;
    const { nmck, tpPrice } = price;
    if (!nmck || nmck <= 0 || !tpPrice || tpPrice <= 0) {
      plan.left.push(`«${flat(label.text)}» (${ref}) — выберите цену на шаге «Цена»: коэффициент считается из неё`);
      continue;
    }
    if (tpPrice > nmck) {
      plan.left.push(`«${flat(label.text)}» (${ref}) — ваша цена выше начальной: коэффициент не больше 1`);
      continue;
    }
    // НМЦ в самой форме («НМЦ: … Итого без НДС: 59 103 088,52»): если она не та, что в закупке, коэффициент по закупке дал бы чужую цену.
    const formNmck = nmckOfForm(rows);
    if (formNmck !== null && Math.abs(formNmck - nmck) / nmck > 0.001) {
      plan.left.push(`«${flat(label.text)}» (${ref}) — НМЦ в форме (${money(formNmck)} ₽) не совпала с НМЦ закупки (${money(nmck)} ₽): впишите коэффициент сами`);
      continue;
    }
    const k = Number((tpPrice / nmck).toFixed(12));
    taken.add(`${sheet.name}!${ref}`);
    plan.edits.push({ sheet: sheet.name, ref, value: k });
    plan.filled.push({ sheet: sheet.name, ref, label: `${flat(label.text).replace(/:$/, "")} = цена ${money(tpPrice)} ÷ НМЦ ${money(nmck)}`, value: String(k).replace(".", ","), kind: "price" });
  }
}

// «НМЦ:» … число правее в той же строке (чаще всего — «Итого без НДС: 59 103 088,52», значение посчитано формулой).
function nmckOfForm(rows: Map<number, FormCell[]>): number | null {
  for (const cells of rows.values()) {
    const label = cells.find((c) => /^нмц\s*:?$/.test(lower(flat(c.text))));
    if (!label) continue;
    const value = cells.filter((c) => c.col > label.col).map((c) => numberOf(c.text)).find((n): n is number => n !== null && n > 0);
    if (value !== undefined) return value;
  }
  return null;
}

// ---------- 2 и 3. цена за единицу по строкам ----------

type RowData = { row: number; name: string; qty: number; base: number | null; ref: string };

function dataRows(sheet: FormSheet, rows: Map<number, FormCell[]>, h: Header, priceCol: number, qtyCol: number, baseCol: number | null): RowData[] {
  const out: RowData[] = [];
  let dead = 0;
  for (let row = h.row + 1; row <= h.row + 400 && dead < 6; row++) {
    const cells = rows.get(row) ?? [];
    if (isNumbering(cells)) continue;
    const qtyCell = sheet.cells.get(refOf(row, qtyCol));
    const qty = qtyCell ? numberOf(qtyCell.text) : null;
    const priceCell = sheet.cells.get(refOf(row, priceCol));
    const free = !priceCell || (!priceCell.formula && isBlank(priceCell.text));
    const baseCell = baseCol === null ? null : sheet.cells.get(refOf(row, baseCol));
    const base = baseCell ? numberOf(baseCell.text) : null;
    if (qty === null || qty < 0 || !free || (baseCol !== null && (base === null || base <= 0))) {
      if (out.length > 0) dead++;
      continue;
    }
    dead = 0;
    out.push({ row, name: nameOf(cells, new Set([priceCol, qtyCol, ...(baseCol === null ? [] : [baseCol])])), qty, base, ref: refOf(row, priceCol) });
  }
  return out;
}

// Надпись над группой граф («Работы», «Материалы») — в строке под заголовком, слева от графы цены, не дальше шести столбцов.
function groupOf(rows: Map<number, FormCell[]>, row: number, priceCol: number): string {
  const cells = rows.get(row) ?? [];
  // Строка с цифрами — уже данные, а не подписи групп граф.
  if (cells.some((c) => numberOf(c.text) !== null)) return "";
  const hit = cells.filter((c) => c.col <= priceCol && priceCol - c.col <= 6 && numberOf(c.text) === null && /\p{L}{3,}/u.test(c.text)).sort((a, b) => b.col - a.col)[0];
  return hit ? flat(hit.text).slice(0, 30) : "";
}

function planRows(sheet: FormSheet, rows: Map<number, FormCell[]>, price: PriceInput, plan: PricePlan, taken: Set<string>) {
  for (const h of headers(rows)) {
    for (const priceCol of h.price) {
      const qtyCol = pickColumn(sheet, h.qty, priceCol, h.row, 8);
      if (qtyCol === null) continue;
      const baseCol = pickColumn(sheet, h.base, priceCol, h.row, 8);
      const group = groupOf(rows, h.row + 1, priceCol);
      const list = dataRows(sheet, rows, h, priceCol, qtyCol, baseCol).map((r) => ({ ...r, name: group && r.name ? `${group}: ${r.name}` : r.name }));
      if (list.length === 0) continue;
      if (baseCol === null) manualRows(sheet, list, price, plan, taken);
      else splitRows(sheet, list, price, plan, taken);
    }
  }
}

function splitRows(sheet: FormSheet, list: RowData[], price: PriceInput, plan: PricePlan, taken: Set<string>) {
  const { nmck, tpPrice } = price;
  const first = list[0];
  if (!nmck || nmck <= 0 || !tpPrice || tpPrice <= 0) {
    plan.left.push(`Цены за единицу по ${list.length} позициям (с ${first.ref}) — выберите цену на шаге «Цена»: она раскладывается по позициям`);
    return;
  }
  if (tpPrice > nmck) {
    plan.left.push(`Цены за единицу (с ${first.ref}) — ваша цена выше начальной, по позициям раскладывать нечего`);
    return;
  }
  const ints = list.every((r) => Number.isInteger(r.qty) && r.qty > 0);
  const base = list.map((r) => ({ name: r.name, qty: r.qty, baseKop: toKop(r.base ?? 0) }));
  // Цена участника относится к НМЦ так же, как сумма по строкам бланка к своей начальной сумме (пропорция верна, даже если НМЦ закупки — с НДС, а в бланке — без).
  const baseKop = base.reduce((sum, p) => sum + p.qty * p.baseKop, 0);
  const split = ints ? splitPrice(base, Math.round((baseKop * tpPrice) / nmck)) : null;
  if (!split) {
    plan.left.push(`Цены за единицу (с ${first.ref}) — количества не целые или нет начальных цен: впишите сами`);
    return;
  }
  list.forEach((r, i) => {
    const key = `${sheet.name}!${r.ref}`;
    if (taken.has(key)) return;
    taken.add(key);
    const unit = split.lines[i].unitKop / 100;
    plan.edits.push({ sheet: sheet.name, ref: r.ref, value: unit });
    plan.filled.push({ sheet: sheet.name, ref: r.ref, label: `${r.name || `строка ${r.row}`} — цена за единицу (НМЦ ${money(r.base ?? 0)})`, value: money(unit), kind: "price" });
  });
  if (split.shortKop > 0) plan.left.push(`По позициям набралось ${money(split.totalKop / 100)} ₽ — на ${money(split.shortKop / 100)} ₽ меньше вашей цены: количества не дают набрать её точно. На площадке укажите ${money(split.totalKop / 100)} ₽`);
}

function manualRows(sheet: FormSheet, list: RowData[], price: PriceInput, plan: PricePlan, taken: Set<string>) {
  let empty = 0;
  for (const r of list) {
    const key = `${sheet.name}!${r.ref}`;
    if (taken.has(key)) continue;
    const typed = price.manual?.[key] ?? "";
    plan.manual.push({ key, sheet: sheet.name, ref: r.ref, name: r.name || `строка ${r.row}`, qty: r.qty, value: typed });
    const value = numberOf(typed.trim());
    if (value === null || value < 0) {
      empty++;
      continue;
    }
    taken.add(key);
    plan.edits.push({ sheet: sheet.name, ref: r.ref, value });
    plan.filled.push({ sheet: sheet.name, ref: r.ref, label: `${r.name || `строка ${r.row}`} — цена за единицу (вы ввели)`, value: money(value), kind: "price" });
  }
  if (empty > 0) plan.left.push(`Цены за единицу (с ${list[0].ref}) — ещё ${empty} из ${list.length} строк: введите в блоке «Цены по строкам» или впишите в файле`);
}

export function planPrices(sheet: FormSheet, price: PriceInput, taken: Set<string>): PricePlan {
  const plan: PricePlan = { edits: [], filled: [], left: [], manual: [] };
  const rows = rowsOf(sheet);
  planCoefficient(sheet, rows, price, plan, taken);
  planRows(sheet, rows, price, plan, taken);
  return plan;
}
