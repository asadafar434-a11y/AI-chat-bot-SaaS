import "server-only";
import ExcelJS from "exceljs";
import { TextBuilder, type DocMap } from "@/lib/doc-source";

// Таблицу читаем по листам, строка — одна строка текста, ячейки через « | ».
// Так ИИ видит, какое значение в какой колонке, а цитата из таблицы находится в тексте.
// Формулы — их значение, а не сама формула; пустые строки и колонки пропускаем. Объединённая ячейка стоит один раз —
// в первой клетке, остальные пусты. Для каждой ячейки запоминается лист и адрес («C17»): по нему видно, откуда значение.

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toLocaleDateString("ru-RU");
  if (typeof value === "number") return String(Math.round(value * 1e9) / 1e9).replace(".", ",");
  if (typeof value === "boolean") return value ? "да" : "нет";
  if (typeof value === "string") return value;
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  if ("result" in value) return value.result === undefined ? "" : cellText(value.result as ExcelJS.CellValue);
  if ("text" in value) return String(value.text);
  if ("error" in value) return "";
  return "";
}

const clean = (text: string) => text.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();

type Cell = { text: string; address: string; col: number };

// Меню и графики: дни идут по столбцам («1 день», «2 день»…). Построчно блюда разных дней слиплись бы в одну строку, поэтому под такой
// шапкой каждый день выписывается отдельным блоком: «### 1 день», дальше его строки. Шапка — три дня и больше в одной строке.
const DAY = /^(?:\d{1,2}\s*день|день\s*\d{1,2})$/i;
const dayHeader = (row: Cell[]) => {
  const days = row.filter((c) => DAY.test(c.text)).map((c) => ({ col: c.col, label: c.text }));
  return days.length >= 3 ? days : null;
};

// hidden — что в файле скрыто: лист, строки, столбцы с содержимым. Лист скрыт — в текст он не попадает; заказчики нередко запрещают скрытое.
export async function xlsxText(buffer: Buffer): Promise<{ text: string; map?: DocMap; hidden: string[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const b = new TextBuilder();
  const hidden: string[] = [];
  let first = true;
  for (const sheet of workbook.worksheets) {
    if (sheet.state !== "visible") {
      hidden.push(`лист «${sheet.name}» скрыт`);
      continue;
    }
    const rows: Cell[][] = [];
    let hiddenRows = 0;
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: Cell[] = [];
      for (let col = 1; col <= row.cellCount; col++) {
        const cell = row.getCell(col);
        // Остальные клетки объединённой ячейки повторяют её значение — второй раз его не пишем.
        cells.push({ text: cell.type === ExcelJS.ValueType.Merge ? "" : clean(cellText(cell.value)), address: cell.address, col });
      }
      if (cells.some((c) => c.text)) {
        rows.push(cells);
        if (row.hidden) hiddenRows++;
      }
    });
    if (rows.length === 0) continue;
    if (hiddenRows > 0) hidden.push(`на листе «${sheet.name}» скрыты строки: ${hiddenRows}`);
    const hiddenCols = Array.from({ length: sheet.columnCount }, (_, i) => i + 1).filter((col) => sheet.getColumn(col).hidden && rows.some((r) => r[col - 1]?.text)).length;
    if (hiddenCols > 0) hidden.push(`на листе «${sheet.name}» скрыты столбцы: ${hiddenCols}`);

    // Колонки, пустые во всех строках, выбрасываем, чтобы не плодить « |  |  | ».
    const width = Math.max(...rows.map((r) => r.length));
    const used = Array.from({ length: width }, (_, col) => rows.some((r) => r[col]?.text));

    if (!first) b.raw("\n\n");
    first = false;
    b.add(`## Лист «${sheet.name}»`, { sheet: sheet.name });
    // Строки под шапкой «1 день | 2 день | …» копятся и выписываются по дням, когда шапка сменится или лист кончится.
    let days: { col: number; label: string }[] | null = null;
    let section: Cell[][] = [];
    const flush = () => {
      if (!days) return;
      days.forEach((day, k) => {
        const to = days![k + 1]?.col ?? Infinity;
        const mine = section.map((row) => row.filter((c) => c.text && c.col >= day.col && c.col < to)).filter((cells) => cells.length > 0);
        if (mine.length === 0) return;
        b.raw("\n### ");
        b.add(day.label, { sheet: sheet.name });
        for (const cells of mine) {
          b.raw("\n");
          cells.forEach((cell, i) => {
            if (i > 0) b.raw(" | ");
            b.add(cell.text, { sheet: sheet.name, cell: cell.address });
          });
        }
      });
      section = [];
    };
    for (const row of rows) {
      const header = dayHeader(row);
      if (header) {
        flush();
        days = header;
        continue;
      }
      if (days) {
        section.push(row);
        continue;
      }
      b.raw("\n");
      const kept = row.filter((_, col) => used[col]);
      let last = kept.length - 1;
      while (last >= 0 && !kept[last].text) last--;
      kept.slice(0, last + 1).forEach((cell, k) => {
        if (k > 0) b.raw(" | ");
        b.add(cell.text, { sheet: sheet.name, cell: cell.address });
      });
    }
    flush();
  }
  return { ...b.build(), hidden };
}
