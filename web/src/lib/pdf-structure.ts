import "server-only";
import { TextBuilder, type DocMap, type SpanRef } from "@/lib/doc-source";

// Текст PDF — это строки в порядке, в каком они нарисованы на странице. У таблицы из такого текста пропадают строки
// и столбцы: «1. Наименование услуг … 1 1 Усл. ед.» — какое число в каком столбце, не видно. Поэтому рядом с текстом страницы
// просим у PDF разметку таблиц (по линиям, которыми нарисована сетка) и записываем строку таблицы одной строкой
// «ячейка | ячейка | ячейка» на то же место, где её текст стоял в странице. Разметка нужна только как границы ячеек: сам текст
// берётся из страницы — в разметке у края ячейки иногда теряются знаки. Не нашли место — страница остаётся как была.
// Вся сборка — функции от уже прочитанных страниц и таблиц: проверяются тестами без самого PDF.

export const letters = (text: string) => text.replace(/-- \d+ of \d+ --/g, "").replace(/[^\p{L}]/gu, "").length;

// «blank» — на странице почти нет букв: это скан или картинка; «garbled» — буквы есть, но это не русский и не английский:
// у PDF сломана кодировка шрифта, и текст читается как набор знаков.
export function pageQuality(text: string): "ok" | "blank" | "garbled" {
  const all = letters(text);
  if (all < 20) return "blank";
  const normal = (text.match(/[\p{Script=Cyrillic}A-Za-z]/gu) ?? []).length;
  const odd = (text.match(/[�-]/g) ?? []).length;
  return normal / all < 0.6 || odd > text.length * 0.1 ? "garbled" : "ok";
}

export const GARBLED_PLACEHOLDER = "(текст страницы не читается — в файле сломана кодировка; сверьте с оригиналом)";

// ---------- таблицы ----------

export type PdfPiece = { text: string; raw?: true; table?: number; row?: number; col?: number };
export type TableShape = { cols: number; rows: number };
export type Placed = { pieces: PdfPiece[]; shapes: TableShape[]; before: number; after: number };

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const compactOf = (s: string) => s.replace(/\s+/g, "");

// Между двумя найденными строками таблицы может стоять чужое (колонтитул, ненайденная строка) — но не страница.
const GAP = 2500;
const MAX_TRIES = 20;
// В разметке у края ячейки теряются отдельные знаки: строка в тексте страницы может быть длиннее на несколько знаков.
const MAX_EXTRA = 80;
const ANCHOR = 20;
const MIN_ROW = 3;
// Таблица засчитывается, если её строк нашлось не меньше этой доли: меньше — это не та таблица.
const MIN_SHARE = 0.6;

type Row = { row: number; cells: string[]; lengths: number[]; compact: string };
type RowMatch = { start: number; end: number; bounds: number[] };

// Знаки строки таблицы по порядку внутри куска страницы, где к ним добавлены лишние. Для каждого знака — место в куске.
function align(row: string, piece: string): number[] | null {
  if (piece.length - row.length > MAX_EXTRA) return null;
  const at = new Array<number>(row.length);
  let i = 0;
  for (let j = 0; j < row.length; j++) {
    while (i < piece.length && piece[i] !== row[j]) i++;
    if (i >= piece.length) return null;
    at[j] = i++;
  }
  return at;
}

// Где в тексте страницы (без пробелов) стоит строка; bounds — где начинаются её ячейки, последнее число — конец строки.
function findRow(page: string, row: Row, from: number, gap: number): RowMatch | null {
  const R = row.compact;
  if (R.length < MIN_ROW) return null;
  const offsets = row.lengths.reduce<number[]>((acc, n) => (acc.push(acc[acc.length - 1] + n), acc), [0]);

  const exact = page.indexOf(R, from);
  if (exact >= 0 && exact - from <= gap) return { start: exact, end: exact + R.length, bounds: offsets };

  // Точно нет — ищем по началу и концу строки: между ними могут стоять знаки, которых нет в разметке.
  const A = R.slice(0, ANCHOR);
  const Z = R.slice(-ANCHOR);
  let start = page.indexOf(A, from);
  for (let tries = 0; start >= 0 && tries < MAX_TRIES && start - from <= gap; tries++) {
    const z = page.indexOf(Z, Math.max(start, start + R.length - Z.length - 5));
    if (z >= 0 && z <= start + R.length + MAX_EXTRA) {
      const end = z + Z.length;
      const at = align(R, page.slice(start, end));
      if (at) {
        const total = end - start;
        const bounds = new Array<number>(row.lengths.length + 1);
        bounds[row.lengths.length] = total;
        // Ячейка начинается там, где стоит её первый знак; у пустой — там же, где следующая; лишние знаки — в предыдущую.
        for (let k = row.lengths.length - 1; k >= 0; k--) bounds[k] = row.lengths[k] > 0 ? at[offsets[k]] : bounds[k + 1];
        return { start, end, bounds };
      }
    }
    start = page.indexOf(A, start + 1);
  }
  return null;
}

// Текст страницы с таблицами, записанными строками; tables — таблицы страницы сверху вниз, в них строки и ячейки.
// Таблица в один столбец — это рамка вокруг текста, а не таблица: её не трогаем. Номера таблиц и строк — в пределах страницы.
export function placeTables(pageText: string, tables: string[][][]): Placed {
  const compact: string[] = [];
  const at: number[] = [];
  for (let i = 0; i < pageText.length; i++) {
    if (!/\s/.test(pageText[i])) {
      compact.push(pageText[i]);
      at.push(i);
    }
  }
  const page = compact.join("");

  type Hit = { table: number; row: number; from: number; to: number; cells: string[] };
  const hits: Hit[] = [];
  const shapes: TableShape[] = [];
  let pos = 0;
  for (const table of tables) {
    const cols = Math.max(0, ...table.map((r) => r.length));
    if (cols < 2) continue;
    // Пустые строки в разметке — не строки таблицы, а края страниц и линии сетки: не считаем их.
    const rows: Row[] = table
      .map((r) => {
        const cells = r.map(squash);
        return { cells, lengths: cells.map((c) => compactOf(c).length), compact: cells.map(compactOf).join("") };
      })
      .filter((r) => r.compact)
      .map((r, i) => ({ ...r, row: i + 1 }));
    if (rows.length === 0 || rows.reduce((n, r) => n + r.cells.filter(Boolean).length, 0) < 2) continue;

    const found: { row: Row; match: RowMatch }[] = [];
    let p = pos;
    for (const row of rows) {
      const match = findRow(page, row, p, found.length ? GAP : Infinity);
      if (!match) continue;
      found.push({ row, match });
      p = match.end;
    }
    if (found.length < Math.max(1, Math.ceil(rows.length * MIN_SHARE))) continue;

    const no = shapes.length + 1;
    shapes.push({ cols, rows: rows.length });
    for (const { row, match } of found) {
      // Текст ячейки — кусок страницы между границами; пустые ячейки в конце строки не пишем.
      const cells = row.lengths.map((_, k) =>
        match.bounds[k] < match.bounds[k + 1] ? squash(pageText.slice(at[match.start + match.bounds[k]], at[match.start + match.bounds[k + 1] - 1] + 1)) : ""
      );
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      hits.push({ table: no, row: row.row, from: at[match.start], to: at[match.end - 1] + 1, cells });
    }
    pos = p;
  }

  const pieces: PdfPiece[] = [];
  let cursor = 0;
  let before = 0;
  hits.forEach((hit, i) => {
    const gap = pageText.slice(cursor, hit.from);
    // Пробелы между строками одной таблицы — перевод строки без адреса; иначе — обычный текст страницы.
    if (gap) pieces.push({ text: gap, ...(i > 0 && hits[i - 1].table === hit.table && !gap.trim() && { raw: true as const }) });
    if (i === 0) before = pageText.slice(0, hit.from).trim().length;
    hit.cells.forEach((text, c) => {
      if (c > 0) pieces.push({ text: " | ", raw: true });
      if (text) pieces.push({ text, table: hit.table, row: hit.row, col: c + 1 });
    });
    cursor = hit.to;
  });
  const rest = pageText.slice(cursor);
  if (rest) pieces.push({ text: rest });
  const last = hits.at(-1);
  return { pieces, shapes, before, after: last ? pageText.slice(last.to).trim().length : 0 };
}

// Страница, распознанная ИИ со скана: таблицы в ней уже записаны строками «а | б | в» — только размечаем их.
export function pipeTables(pageText: string): Placed {
  const lines = pageText.split("\n");
  const pieces: PdfPiece[] = [];
  const shapes: TableShape[] = [];
  // Номер строки в текущей таблице; 0 — сейчас не в таблице. before и after — знаков текста до первой таблицы и после последней.
  let row = 0;
  let before = 0;
  let after = 0;
  lines.forEach((line, i) => {
    const newline = i < lines.length - 1 ? "\n" : "";
    if (!line.includes(" | ")) {
      row = 0;
      if (shapes.length === 0) before += line.trim().length;
      else after += line.trim().length;
      pieces.push({ text: line + newline });
      return;
    }
    if (row === 0) {
      shapes.push({ cols: 0, rows: 0 });
      after = 0;
    }
    row++;
    const table = shapes.length;
    const shape = shapes[table - 1];
    const cells = line.split(" | ").map(squash);
    shape.cols = Math.max(shape.cols, cells.length);
    shape.rows = row;
    cells.forEach((text, c) => {
      if (c > 0) pieces.push({ text: " | ", raw: true });
      if (text) pieces.push({ text, table, row, col: c + 1 });
    });
    if (newline) pieces.push({ text: newline, raw: true });
  });
  return { pieces, shapes, before, after };
}

// ---------- сборка документа ----------

export type PdfPage = { num: number; text: string; ocr?: boolean; tables?: string[][][] };

// Короткий кусок текста до и после таблицы — заголовок или колонтитул: таблица на следующей странице продолжает эту.
const NEAR = 200;

// Первая строка таблицы без пробелов. Таблица на следующей странице начинается с той же строки — это шапка, которую Word
// повторяет на каждой странице: строкой таблицы она не считается.
const headOf = (pieces: PdfPiece[], table: number) =>
  pieces
    .filter((p) => p.table === table && p.row === 1)
    .map((p) => p.text.replace(/\s+/g, ""))
    .join("");

// Текст всех страниц и карта. Страница заканчивается меткой «-- 5 of 12 --», как у PDF: по ней читаются и документы, сохранённые
// до карты. Таблица, которая идёт с одной страницы на другую с теми же столбцами, остаётся одной таблицей.
export function assemblePdf(pages: PdfPage[], total: number): { text: string; map?: DocMap } {
  const b = new TextBuilder();
  let tableNo = 0;
  let prev: { no: number; cols: number; rows: number; page: number; after: number; head: string } | null = null;

  for (const page of pages) {
    const placed = page.ocr ? pipeTables(page.text) : page.tables?.length ? placeTables(page.text, page.tables) : null;
    const base: SpanRef = { page: page.num, ...(page.ocr && { ocr: true as const }) };
    if (!placed || placed.shapes.length === 0) {
      b.add(page.text, base);
      prev = null;
    } else {
      // Первая таблица страницы может быть продолжением таблицы с предыдущей: тот же номер, строки считаются дальше.
      const first = placed.shapes[0];
      const continues: boolean = !!prev && prev.page === page.num - 1 && prev.cols === first.cols && prev.after < NEAR && placed.before < NEAR;
      const numbers: number[] = placed.shapes.map((_, i) => (i === 0 && continues ? prev!.no : ++tableNo));
      const done: number = continues ? prev!.rows : 0;
      const firstHead = headOf(placed.pieces, 1);
      const repeated: boolean = continues && firstHead !== "" && firstHead === prev!.head;
      // Строка первой таблицы страницы в таблице документа: после уже записанных; повторённая шапка — снова первая строка.
      const rowOf = (local: number): number => (repeated ? (local === 1 ? 1 : done + local - 1) : done + local);
      for (const piece of placed.pieces) {
        if (piece.raw) b.raw(piece.text);
        else if (piece.table === undefined) b.add(piece.text, base);
        else b.add(piece.text, { ...base, table: numbers[piece.table - 1], row: piece.table === 1 ? rowOf(piece.row ?? 1) : piece.row, col: piece.col });
      }
      const last = placed.shapes.length - 1;
      prev = {
        no: numbers[last],
        cols: placed.shapes[last].cols,
        rows: last === 0 ? rowOf(placed.shapes[0].rows) : placed.shapes[last].rows,
        page: page.num,
        after: placed.after,
        head: last === 0 && continues ? prev!.head : headOf(placed.pieces, last + 1),
      };
    }
    b.add(`\n\n-- ${page.num} of ${total} --\n\n`, base);
  }
  return b.build();
}
