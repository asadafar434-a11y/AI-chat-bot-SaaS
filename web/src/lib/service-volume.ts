// Объём закупки из документов заказчика: сколько всего единиц услуги или работы (детодней, человеко-часов, м², рейсов…).
// Заказчик считает цену за единицу объёма, и участнику нужна себестоимость той же единицы. Читает код по таблицам, без ИИ; чисел не выдумывает.
// Два вида таблиц: «люди × период» (количество человек и количество дней, часов или месяцев) и «количество + единица измерения»
// (одна и та же единица во всех строках: м², пог. м, час, смена, рейс…). Товары в штуках сюда не попадают — по ним блок «Товары и закупочные цены».

import { cellsOf, numberOf } from "@/lib/spec-table";

type Doc = { name: string; text: string };

export type VolumeRow = {
  category: string;
  /** Единиц объёма в строке: «люди × период» или количество из таблицы. */
  units: number;
  /** Только в таблице «люди × период». */
  people?: number;
  period?: number;
};
export type ServiceVolume = {
  doc: string;
  /** «детодень», «человеко-час», «м²». */
  unit: string;
  /** Для подписи с числом: «детодней». */
  unitsLabel: string;
  /** Единица в родительном падеже: «детодня» — «себестоимость одного детодня». */
  unitOf: string;
  /** «одного» или «одной» (смена) — к родительному падежу. */
  one: "одного" | "одной";
  rows: VolumeRow[];
  /** Сумма людей по строкам; в таблице «количество + единица» людей нет. */
  people: number | null;
  /** Всего единиц объёма. */
  total: number;
};

type Unit = Pick<ServiceVolume, "unit" | "unitsLabel" | "unitOf" | "one">;
const unit = (name: string, plural: string, genitive: string, one: Unit["one"] = "одного"): Unit => ({ unit: name, unitsLabel: plural, unitOf: genitive, one });
const U = {
  childDay: unit("детодень", "детодней", "детодня"),
  manDay: unit("человеко-день", "человеко-дней", "человеко-дня"),
  manHour: unit("человеко-час", "человеко-часов", "человеко-часа"),
  manMonth: unit("человеко-месяц", "человеко-месяцев", "человеко-месяца"),
  m2: unit("м²", "м²", "м²"),
  m3: unit("м³", "м³", "м³"),
  m: unit("пог. м", "пог. м", "пог. м"),
  km: unit("км", "км", "км"),
  ha: unit("га", "га", "га"),
  hour: unit("час", "часов", "часа"),
  shift: unit("смена", "смен", "смены", "одной"),
  trip: unit("рейс", "рейсов", "рейса"),
  month: unit("месяц", "месяцев", "месяца"),
};

// Единица измерения в ячейке: пробелы, точки, дефисы и косые убраны («кв. м» → «квм», «чел.-час» → «челчас»).
// Товарные единицы (шт., уп., кг, л) нарочно не узнаются: объём штук — это позиции товаров, а не объём услуги.
const MEASURES: [RegExp, Unit][] = [
  [/^(?:м2|квм|мкв|квметр[а-яё]*)$/, U.m2],
  [/^(?:м3|кубм|мкуб|кубметр[а-яё]*)$/, U.m3],
  [/^(?:пм|погм|мп|м|погонн[а-яё]*метр[а-яё]*)$/, U.m],
  [/^км$/, U.km],
  [/^га$/, U.ha],
  [/^(?:челчас[а-яё]*|челч|человекочас[а-яё]*)$/, U.manHour],
  [/^(?:челдень|челдн[а-яё]*|человекодень|человекодн[а-яё]*)$/, U.manDay],
  [/^(?:час[а-яё]*|ч)$/, U.hour],
  [/^смен[а-яё]*$/, U.shift],
  [/^рейс[а-яё]*$/, U.trip],
  [/^(?:месяц[а-яё]*|мес)$/, U.month],
];

function measureOf(cell: string): Unit | null {
  const key = cell.toLowerCase().replace(/²/g, "2").replace(/³/g, "3").replace(/[\s.,/()\-–—]/g, "");
  if (!key) return null;
  return MEASURES.find(([re]) => re.test(key))?.[1] ?? null;
}

// Количество в ячейке: «1 200,5» с пробелом-разделителем тысяч — тоже число.
const quantityOf = (cell: string) => numberOf(cell.replace(/[\s  ]/g, ""));

const PEOPLE_COL =
  /(?:количеств[а-яё]*|кол-?во|численност[а-яё]*)\s*(?:обучающ[а-яё]*|дет[а-яё]*|человек|чел\.?|питающ[а-яё]*|воспитанник[а-яё]*|работник[а-яё]*|сотрудник[а-яё]*|персонал[а-яё]*|охранник[а-яё]*|специалист[а-яё]*)/i;
const PERIOD_COL = /(?:количеств[а-яё]*|кол-?во)\s*(?:учебн[а-яё]*\s+|рабоч[а-яё]*\s+|календарн[а-яё]*\s+)?(дн[а-яё]*|час[а-яё]*|месяц[а-яё]*|мес\.?)/i;
const CHILD = /дет|обучающ|воспитанник|школьник|учени/i;

// Заголовок столбца без пояснений в скобках и хвостовой пунктуации: «Количество (объём)» → «Количество».
const headOf = (c: string) => c.replace(/\([^)]*\)/g, "").replace(/[\s,;:]+$/, "").trim();
const QTY_COL = /^(?:количеств[а-яё]*|кол-?во|объ[её]м[а-яё]*)(?:\s+(?:работ|услуг|выполняем)[а-яё]*)?$/i;
const UNIT_COL = /^ед(?:иниц[а-яё]*)?\.?\s*изм(?:ерени[а-яё]*)?\.?$/i;
const TOTAL = /^(итого|всего)(?![а-яё])/i;

/** Название строки: первая ячейка с буквами, кроме столбцов с числами. */
function categoryOf(cells: string[], skip: number[]): string {
  const cell = cells.find((c, i) => !skip.includes(i) && /\p{L}{3}/u.test(c));
  return (cell ?? "").replace(/[\s:]+$/, "");
}

/** Строки таблицы под заголовком: до первой пустой строки после строк данных или до строки без столбцов. */
function* bodyLines(lines: string[], from: number): Generator<string> {
  let seen = false;
  for (let j = from; j < lines.length; j++) {
    const line = lines[j];
    if (!line.trim()) {
      if (seen) return;
      continue;
    }
    if (!line.includes(" | ") && !line.includes("\t")) return;
    seen = true;
    yield line;
  }
}

function peopleTimesPeriod(doc: Doc, lines: string[], i: number, head: string[]): ServiceVolume | null {
  const people = head.findIndex((c) => PEOPLE_COL.test(c));
  const period = head.findIndex((c) => PERIOD_COL.test(c));
  if (people < 0 || period < 0 || people === period) return null;
  const kind = (PERIOD_COL.exec(head[period])?.[1] ?? "").toLowerCase();
  const rows: VolumeRow[] = [];
  for (const line of bodyLines(lines, i + 1)) {
    const cells = cellsOf(line);
    if (cells.length <= Math.max(people, period)) continue;
    const p = quantityOf(cells[people]);
    const d = quantityOf(cells[period]);
    const category = categoryOf(cells, [people, period]);
    if (p === null || d === null || p <= 0 || d <= 0 || !category || TOTAL.test(category)) continue;
    rows.push({ category, people: p, period: d, units: p * d });
  }
  if (rows.length === 0) return null;
  const children = CHILD.test(head[people]) || rows.some((r) => CHILD.test(r.category));
  const u = kind.startsWith("дн") ? (children ? U.childDay : U.manDay) : kind.startsWith("час") ? U.manHour : U.manMonth;
  return { doc: doc.name, ...u, rows, people: rows.reduce((s, r) => s + (r.people ?? 0), 0), total: rows.reduce((s, r) => s + r.units, 0) };
}

function quantityWithMeasure(doc: Doc, lines: string[], i: number, head: string[]): ServiceVolume | null {
  const cleaned = head.map(headOf);
  const qty = cleaned.findIndex((c) => QTY_COL.test(c));
  const meas = cleaned.findIndex((c) => UNIT_COL.test(c));
  if (qty < 0 || meas < 0 || qty === meas) return null;
  const rows: VolumeRow[] = [];
  let found: Unit | null = null;
  for (const line of bodyLines(lines, i + 1)) {
    const cells = cellsOf(line);
    if (cells.length <= Math.max(qty, meas)) continue;
    const category = categoryOf(cells, [qty, meas]);
    if (TOTAL.test(category)) continue;
    const q = quantityOf(cells[qty]);
    const label = cells[meas];
    if (q === null || q <= 0 || !label) continue;
    const m = measureOf(label);
    // Одна товарная или другая единица в таблице — суммировать нечего: объём в разных единицах не складывается.
    if (!m || (found && found.unit !== m.unit)) return null;
    found = m;
    rows.push({ category: category || label, units: q });
  }
  if (!found || rows.length === 0) return null;
  return { doc: doc.name, ...found, rows, people: null, total: rows.reduce((s, r) => s + r.units, 0) };
}

/** Объём закупки: найдена таблица «люди × период» или «количество + единица измерения» с одной единицей во всех строках. Нет такой таблицы — null. */
export function findServiceVolume(documents: Doc[]): ServiceVolume | null {
  for (const doc of documents) {
    const lines = doc.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const head = cellsOf(lines[i]);
      if (head.length < 3) continue;
      const found = peopleTimesPeriod(doc, lines, i, head) ?? quantityWithMeasure(doc, lines, i, head);
      if (found) return found;
    }
  }
  return null;
}
