// Чем заказчик велит исполнять услугу или работу: персонал (должность — сколько человек) и техника (наименование — сколько единиц), срок. Читает код по таблицам документов, без ИИ и без платы.
// По этому составу расчёт себестоимости (lib/crew-cost.ts) ищет в интернете зарплаты и аренду. Числа берутся только из таблиц заказчика, ничего не выдумывается.
// Годится для любых закупок: охрана, уборка, склад, перевозки, строительство, обслуживание — везде, где заказчик пишет «минимальное количество персонала» и «техники».

import { cellsOf, numberOf } from "@/lib/spec-table";

type Doc = { name: string; text: string };

export type StaffRow = { role: string; count: number; /** Требование к опыту или квалификации, как написано в строке. */ requirement: string | null };
export type EquipmentRow = { name: string; count: number };
export type ResourceNeed = { doc: string; staff: StaffRow[]; equipment: EquipmentRow[]; months: number | null };

const ROLE_COL = /^(?:должност[а-яё]*|професси[а-яё]*|специальност[а-яё]*|наименование\s+должност[а-яё]*|категори[а-яё]*\s+персонал[а-яё]*)(?![а-яё])/i;
const COUNT_COL = /(?:количеств[а-яё]*|кол-?во|численност[а-яё]*|штатн[а-яё]*\s+единиц[а-яё]*)/i;
const EXPERIENCE_COL = /(?:квалификаци[а-яё]*|опыт|стаж|требовани[а-яё]*)/i;
const EQUIP_COL = /^(?:наименование|вид|тип)(?:\s+(?:техники|оборудования|транспорта|механизмов|транспортных\s+средств))?\s*$/i;
const EQUIP_UNITS = /(?:кол-?во|количеств[а-яё]*)\s*(?:единиц[а-яё]*|шт[а-яё.]*|ед\.?)?/i;
const EQUIP_CONTEXT = /техник|оборудовани|транспорт|механизм|погрузчик|автомобил|спецтехник|машин/i;
const TOTAL = /^(итого|всего)(?![а-яё])/i;
const NESTED = /^из\s+них(?![а-яё])/i;

const countOf = (cell: string | undefined): number | null => {
  if (cell === undefined) return null;
  const n = numberOf(cell.replace(/[\s  ]/g, ""));
  return n !== null && Number.isInteger(n) && n > 0 && n <= 5000 ? n : null;
};

/** Строки таблицы под шапкой: пока идут строки с « | » или табуляцией; пустая строка после строк данных — конец. */
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

function staffTable(lines: string[], i: number): StaffRow[] {
  const head = cellsOf(lines[i]);
  const role = head.findIndex((c) => ROLE_COL.test(c));
  const count = head.findIndex((c, k) => k !== role && COUNT_COL.test(c));
  if (role < 0 || count < 0) return [];
  const exp = head.findIndex((c, k) => k !== role && k !== count && EXPERIENCE_COL.test(c));
  const rows: StaffRow[] = [];
  for (const line of bodyLines(lines, i + 1)) {
    const cells = cellsOf(line);
    const name = (cells[role] ?? "").replace(/[\s:]+$/, "");
    const n = countOf(cells[count]);
    if (!name || TOTAL.test(name) || NESTED.test(name) || !/\p{L}{3}/u.test(name) || n === null) continue;
    rows.push({ role: name, count: n, requirement: exp >= 0 && cells[exp] ? cells[exp] : null });
  }
  return rows;
}

function equipmentTable(lines: string[], i: number): EquipmentRow[] {
  const head = cellsOf(lines[i]);
  if (head.length < 2 || !EQUIP_COL.test(head[0])) return [];
  const count = head.findIndex((c, k) => k > 0 && EQUIP_UNITS.test(c));
  if (count < 0) return [];
  // Таблица про технику, а не про товары: рядом выше названа техника, оборудование или транспорт.
  const above = lines.slice(Math.max(0, i - 8), i).join(" ") + " " + head.join(" ");
  if (!EQUIP_CONTEXT.test(above)) return [];
  const rows: EquipmentRow[] = [];
  for (const line of bodyLines(lines, i + 1)) {
    const cells = cellsOf(line);
    const name = (cells[0] ?? "").replace(/[\s:]+$/, "");
    const n = countOf(cells[count]);
    if (!name || TOTAL.test(name) || NESTED.test(name) || !/\p{L}{3}/u.test(name) || n === null) continue;
    rows.push({ name, count: n });
  }
  return rows;
}

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/** Срок оказания услуг в месяцах: «в течение 24 месяцев» или «с 01 января 2025 г. по 31 декабря 2026 г.». Нет — null. */
export function termMonths(documents: Doc[]): number | null {
  for (const doc of documents) {
    const direct = /срок[а-яё]*\s+(?:оказани[а-яё]*|выполнени[а-яё]*|действи[а-яё]*)[^.\n]{0,120}?(\d{1,3})\s*(?:\([^)]{0,40}\)\s*)?месяц/i.exec(doc.text);
    if (direct) return Number(direct[1]);
  }
  for (const doc of documents) {
    const range = new RegExp(String.raw`срок[а-яё]*[^.\n]{0,160}?с\s+[«"]?(\d{1,2})[»"]?\s+(${MONTHS.join("|")})\s+(\d{4})\s*г\.?[^.\n]{0,20}?по\s+[«"]?(\d{1,2})[»"]?\s+(${MONTHS.join("|")})\s+(\d{4})`, "i").exec(doc.text);
    if (range) {
      const from = Number(range[3]) * 12 + MONTHS.indexOf(range[2].toLowerCase());
      const to = Number(range[6]) * 12 + MONTHS.indexOf(range[5].toLowerCase());
      if (to >= from) return to - from + 1;
    }
  }
  return null;
}

/** Состав исполнения из первых найденных таблиц персонала и техники. Нет ни той, ни другой — null. */
export function findResourceNeed(documents: Doc[]): ResourceNeed | null {
  let staff: StaffRow[] = [];
  let equipment: EquipmentRow[] = [];
  let source = "";
  for (const doc of documents) {
    const lines = doc.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes(" | ") && !lines[i].includes("\t")) continue;
      if (staff.length === 0) {
        const found = staffTable(lines, i);
        if (found.length > 0) {
          staff = found;
          source ||= doc.name;
        }
      }
      if (equipment.length === 0) {
        const found = equipmentTable(lines, i);
        if (found.length > 0) {
          equipment = found;
          source ||= doc.name;
        }
      }
    }
  }
  if (staff.length === 0 && equipment.length === 0) return null;
  return { doc: source, staff, equipment, months: termMonths(documents) };
}
