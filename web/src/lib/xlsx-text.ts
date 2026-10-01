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

type Cell = { text: string; address: string };

export async function xlsxText(buffer: Buffer): Promise<{ text: string; map?: DocMap }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const b = new TextBuilder();
  let first = true;
  for (const sheet of workbook.worksheets) {
    if (sheet.state !== "visible") continue;
    const rows: Cell[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: Cell[] = [];
      for (let col = 1; col <= row.cellCount; col++) {
        const cell = row.getCell(col);
        // Остальные клетки объединённой ячейки повторяют её значение — второй раз его не пишем.
        cells.push({ text: cell.type === ExcelJS.ValueType.Merge ? "" : clean(cellText(cell.value)), address: cell.address });
      }
      if (cells.some((c) => c.text)) rows.push(cells);
    });
    if (rows.length === 0) continue;

    // Колонки, пустые во всех строках, выбрасываем, чтобы не плодить « |  |  | ».
    const width = Math.max(...rows.map((r) => r.length));
    const used = Array.from({ length: width }, (_, col) => rows.some((r) => r[col]?.text));

    if (!first) b.raw("\n\n");
    first = false;
    b.add(`## Лист «${sheet.name}»`, { sheet: sheet.name });
    for (const row of rows) {
      b.raw("\n");
      const kept = row.filter((_, col) => used[col]);
      let last = kept.length - 1;
      while (last >= 0 && !kept[last].text) last--;
      kept.slice(0, last + 1).forEach((cell, k) => {
        if (k > 0) b.raw(" | ");
        b.add(cell.text, { sheet: sheet.name, cell: cell.address });
      });
    }
  }
  return b.build();
}
