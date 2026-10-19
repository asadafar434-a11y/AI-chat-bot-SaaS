// Excel-бланк заказчика: чтение ячеек и вписывание значений прямо в его файл (.xlsx), без потери формул, формата, выпадающих списков и скрытых листов.
// Файл разбирается как архив из XML (fflate), правятся только нужные ячейки: у них остаётся стиль, у соседних ничего не меняется. Модуль без зависимостей
// от браузера и сервера: работает и в экране (файл лежит в браузере), и в тестах.
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export type FormCell = {
  ref: string;
  row: number;
  col: number;
  // Текст ячейки: для чисел — как записано в файле; пусто — ячейка свободна.
  text: string;
  formula: boolean;
  // Ячейка — левая верхняя в объединении: сколько строк и столбцов оно занимает.
  span?: { rows: number; cols: number };
};

export type FormSheet = { name: string; path: string; hidden: boolean; cells: Map<string, FormCell> };
export type FormBook = { sheets: FormSheet[]; files: Record<string, Uint8Array> };

export class XlsxFormError extends Error {}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.includes("&")
    ? s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (whole, code: string) => {
        if (code[0] !== "#") return ENTITIES[code] ?? whole;
        const n = code[1] === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
      })
    : s;
const encode = (s: string) =>
  s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const columnNumber = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
export function columnLetters(n: number): string {
  let out = "";
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) out = String.fromCharCode(65 + ((k - 1) % 26)) + out;
  return out;
}
const REF = /^([A-Z]+)(\d+)$/;
export function parseRef(ref: string): { col: number; row: number } {
  const m = REF.exec(ref);
  if (!m) throw new XlsxFormError(`Неверный адрес ячейки: ${ref}`);
  return { col: columnNumber(m[1]), row: Number(m[2]) };
}
export const refOf = (row: number, col: number) => `${columnLetters(col)}${row}`;

const textOf = (xml: string) =>
  [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join("");

function sharedStrings(files: Record<string, Uint8Array>): string[] {
  const raw = files["xl/sharedStrings.xml"];
  if (!raw) return [];
  return [...strFromU8(raw).matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((m) => (m[1] ? textOf(m[1]) : ""));
}

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  return m ? decode(m[1]) : undefined;
};

function sheetList(files: Record<string, Uint8Array>): { name: string; path: string; hidden: boolean }[] {
  const book = files["xl/workbook.xml"];
  if (!book) throw new XlsxFormError("Это не файл Excel (.xlsx): нет xl/workbook.xml");
  const rels = new Map<string, string>();
  for (const m of strFromU8(files["xl/_rels/workbook.xml.rels"] ?? new Uint8Array()).matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (id && target) rels.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
  }
  const out: { name: string; path: string; hidden: boolean }[] = [];
  for (const m of strFromU8(book).matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], "name");
    const id = attr(m[0], "r:id") ?? attr(m[0], "id");
    const path = id ? rels.get(id) : undefined;
    if (name && path) out.push({ name, path, hidden: /^(hidden|veryHidden)$/.test(attr(m[0], "state") ?? "") });
  }
  return out;
}

function readSheet(xml: string, strings: string[]): Map<string, FormCell> {
  const cells = new Map<string, FormCell>();
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const head = m[1];
    const ref = attr(` ${head}`, "r");
    if (!ref || !REF.test(ref)) continue;
    const body = m[2] ?? "";
    const type = attr(` ${head}`, "t");
    const formula = /<f\b/.test(body);
    let text = "";
    if (type === "s") {
      const v = /<v>([\s\S]*?)<\/v>/.exec(body);
      text = v ? (strings[Number(v[1])] ?? "") : "";
    } else if (type === "inlineStr") {
      text = textOf(body);
    } else {
      const v = /<v>([\s\S]*?)<\/v>/.exec(body);
      text = v ? decode(v[1]) : "";
    }
    const { row, col } = parseRef(ref);
    cells.set(ref, { ref, row, col, text, formula });
  }
  for (const m of xml.matchAll(/<mergeCell\b[^>]*>/g)) {
    const [from, to] = (attr(m[0], "ref") ?? "").split(":");
    if (!from || !to || !REF.test(from) || !REF.test(to)) continue;
    const a = parseRef(from);
    const b = parseRef(to);
    const cell = cells.get(from) ?? { ref: from, row: a.row, col: a.col, text: "", formula: false };
    cell.span = { rows: b.row - a.row + 1, cols: b.col - a.col + 1 };
    cells.set(from, cell);
  }
  return cells;
}

export function readBook(bytes: Uint8Array): FormBook {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new XlsxFormError("Файл не открывается как .xlsx (старый .xls вписывать не умеем)");
  }
  const strings = sharedStrings(files);
  const sheets: FormSheet[] = [];
  for (const sheet of sheetList(files)) {
    const raw = files[sheet.path];
    if (!raw) continue;
    sheets.push({ ...sheet, cells: readSheet(strFromU8(raw), strings) });
  }
  if (sheets.length === 0) throw new XlsxFormError("В файле нет листов");
  return { sheets, files };
}

// ---------- запись ----------

export type CellEdit = { sheet: string; ref: string; value: string | number };

function cellXml(ref: string, style: string | undefined, value: string | number): string {
  const s = style ? ` s="${style}"` : "";
  if (typeof value === "number") return `<c r="${ref}"${s}><v>${Number.isFinite(value) ? String(value) : "0"}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${encode(value)}</t></is></c>`;
}

const rowTag = (row: number) => new RegExp(`<row\\b(?=[^>]*\\sr="${row}")[^>]*?(?:/>|>)`);

function setInSheet(xml: string, ref: string, value: string | number): string {
  const { row, col } = parseRef(ref);
  const sheetData = /<sheetData\b[^>]*?(?:\/>|>)/.exec(xml);
  if (!sheetData) throw new XlsxFormError("В листе нет данных");
  // Пустой <sheetData/> раскрываем.
  if (sheetData[0].endsWith("/>")) xml = xml.replace(sheetData[0], sheetData[0].replace(/\s*\/>$/, "></sheetData>"));

  const found = rowTag(row).exec(xml);
  if (!found) {
    // Строки нет: вставляем её по порядку номеров.
    const rows = [...xml.matchAll(/<row\b[^>]*>/g)].map((m) => ({ index: m.index!, number: Number(attr(m[0], "r") ?? 0) }));
    const next = rows.find((r) => r.number > row);
    const fresh = `<row r="${row}">${cellXml(ref, undefined, value)}</row>`;
    if (next) return xml.slice(0, next.index) + fresh + xml.slice(next.index);
    return xml.replace("</sheetData>", `${fresh}</sheetData>`);
  }
  let opening = found[0];
  const start = found.index;
  // <row ... /> — пустая строка: раскрываем.
  if (opening.endsWith("/>")) {
    const open = opening.replace(/\s*\/>$/, ">");
    xml = xml.slice(0, start) + open + "</row>" + xml.slice(start + opening.length);
    opening = open;
  }
  const bodyStart = start + opening.length;
  const bodyEnd = xml.indexOf("</row>", bodyStart);
  const body = xml.slice(bodyStart, bodyEnd);
  const cellRe = /<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g;
  let replaced: string | null = null;
  let insertAt = body.length;
  for (let m = cellRe.exec(body); m; m = cellRe.exec(body)) {
    const own = attr(` ${m[1]}`, "r");
    if (!own) continue;
    if (own === ref) {
      replaced = body.slice(0, m.index) + cellXml(ref, attr(` ${m[1]}`, "s"), value) + body.slice(m.index + m[0].length);
      break;
    }
    if (parseRef(own).col > col) {
      insertAt = m.index;
      break;
    }
  }
  const nextBody = replaced ?? body.slice(0, insertAt) + cellXml(ref, undefined, value) + body.slice(insertAt);
  return xml.slice(0, bodyStart) + nextBody + xml.slice(bodyEnd);
}

// После правки значений формулы в файле остаются со старым результатом: просим Excel пересчитать всё при открытии.
function withRecalc(workbookXml: string): string {
  if (/<calcPr\b/.test(workbookXml)) {
    return workbookXml.replace(/<calcPr\b([^>]*?)(\/?)>/, (_w, attrs: string, close: string) => {
      const clean = attrs.replace(/\sfullCalcOnLoad="[^"]*"/, "");
      return `<calcPr${clean} fullCalcOnLoad="1"${close}>`;
    });
  }
  const tag = '<calcPr fullCalcOnLoad="1"/>';
  const after = /<(?:oleSize|customWorkbookViews|pivotCaches|smartTagPr|smartTagTypes|webPublishing|fileRecoveryPr|webPublishObjects|extLst)\b|<\/workbook>/.exec(workbookXml);
  if (!after) return workbookXml;
  return workbookXml.slice(0, after.index) + tag + workbookXml.slice(after.index);
}

export function applyEdits(book: FormBook, edits: CellEdit[]): Uint8Array {
  const files: Record<string, Uint8Array> = { ...book.files };
  const bySheet = new Map<string, CellEdit[]>();
  for (const edit of edits) bySheet.set(edit.sheet, [...(bySheet.get(edit.sheet) ?? []), edit]);
  for (const [name, list] of bySheet) {
    const sheet = book.sheets.find((s) => s.name === name);
    if (!sheet) throw new XlsxFormError(`Нет листа «${name}»`);
    let xml = strFromU8(files[sheet.path]);
    if (/<x:sheetData\b/.test(xml)) throw new XlsxFormError(`Лист «${name}» записан с префиксом x: — такой файл вписывать не умеем`);
    for (const edit of list) xml = setInSheet(xml, edit.ref, edit.value);
    files[sheet.path] = strToU8(xml);
  }
  if (edits.length > 0 && files["xl/workbook.xml"]) files["xl/workbook.xml"] = strToU8(withRecalc(strFromU8(files["xl/workbook.xml"])));
  return zipSync(files, { level: 6 });
}
