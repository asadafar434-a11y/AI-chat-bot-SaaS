// Объём закупки из документов заказчика: сколько всего единиц услуги или работы (детодней, человеко-часов, м², рейсов…).
// Заказчик считает цену за единицу объёма, и участнику нужна себестоимость той же единицы. Читает код по таблицам, без ИИ; чисел не выдумывает.
// Три вида таблиц: «люди × период» (количество человек и количество дней, часов или месяцев), «количество + единица измерения»
// (одна и та же единица во всех строках: м², пог. м, час, смена, рейс…) и «период × год» с единицей в заголовке («Планируемые объёмы (в тоннах)»).
// Товары в штуках сюда не попадают — по ним блок «Товары и закупочные цены».

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
  /** Чем названы строки, если это не категории и не позиции: «периодов» у таблицы «месяц × год». */
  rowsLabel?: string;
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
  // Тонна как объём обработки груза («оказание услуг 3PL-оператора»: планируемые объёмы в тоннах); в таблицах «количество + единица» т по-прежнему товар.
  tonne: unit("тонна", "тонн", "тонны", "одной"),
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

// Единица названа в заголовке над таблицей, а не в столбце: «1.2.4. Планируемые объёмы (в тоннах):» и ниже «Месяц | 2025 | 2026».
const CAPTION = /объ[её]м[а-яё]*[^\n|]{0,60}\(\s*(?:в\s+)?([^)\n]{1,30}?)\s*\)\s*:?\s*$/i;
const CAPTION_UNITS: [RegExp, Unit][] = [
  [/^(?:тонн[а-яё]*|т\.?)$/, U.tonne],
  [/^(?:кв(?:адратн[а-яё]*)?\.?\s*м(?:етр[а-яё]*)?\.?|м2|м²)$/, U.m2],
  [/^(?:куб(?:ическ[а-яё]*)?\.?\s*м(?:етр[а-яё]*)?\.?|м3|м³)$/, U.m3],
  [/^чел(?:овеко)?[-. ]?час[а-яё]*$/, U.manHour],
  [/^час[а-яё]*$/, U.hour],
  [/^рейс[а-яё]*$/, U.trip],
  [/^смен[а-яё]*$/, U.shift],
];

/** Таблица «период × год» с единицей в заголовке: сумма всех чисел строк периодов; итоговая строка заказчика должна сходиться с нашей суммой (допуск 2 %), иначе таблице не верим. */
function periodMatrix(doc: Doc, lines: string[], i: number): ServiceVolume | null {
  const caption = CAPTION.exec(lines[i].trim());
  if (!caption) return null;
  const u = CAPTION_UNITS.find(([re]) => re.test(caption[1].trim().toLowerCase()))?.[1];
  if (!u) return null;
  let start = i + 1;
  while (start < lines.length && !lines[start].trim() && start < i + 3) start++;
  if (!lines[start]?.includes(" | ") || cellsOf(lines[start]).length < 2) return null;
  const rows: VolumeRow[] = [];
  let printedTotal: number | null = null;
  for (const line of bodyLines(lines, start + 1)) {
    const cells = cellsOf(line);
    const label = cells[0] ?? "";
    const numbers = cells.slice(1).map(quantityOf);
    if (numbers.every((n) => n === null)) continue;
    const sum = numbers.reduce<number>((s, n) => s + (n ?? 0), 0);
    if (TOTAL.test(label)) printedTotal = sum;
    else if (/\p{L}{3}/u.test(label)) rows.push({ category: label.replace(/[\s:]+$/, ""), units: sum });
  }
  if (rows.length < 2) return null;
  const total = Math.round(rows.reduce((s, r) => s + r.units, 0) * 1000) / 1000;
  if (printedTotal !== null && Math.abs(printedTotal - total) > Math.max(1, total * 0.02)) return null;
  return { doc: doc.name, ...u, rows, people: null, total, rowsLabel: "периодов" };
}

/** Объём закупки: найдена таблица «люди × период», «количество + единица измерения» с одной единицей во всех строках или «период × год» с единицей в заголовке. Нет такой таблицы — null. */
export function findServiceVolume(documents: Doc[]): ServiceVolume | null {
  for (const doc of documents) {
    const lines = doc.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const matrix = periodMatrix(doc, lines, i);
      if (matrix) return matrix;
      const head = cellsOf(lines[i]);
      if (head.length < 3) continue;
      const found = peopleTimesPeriod(doc, lines, i, head) ?? quantityWithMeasure(doc, lines, i, head);
      if (found) return found;
    }
  }
  return null;
}
