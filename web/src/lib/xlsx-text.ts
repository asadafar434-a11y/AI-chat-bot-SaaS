import "server-only";
import ExcelJS from "exceljs";
import type { DocMap } from "@/lib/doc-source";
import { cleanText, numberText, sheetsText, type SheetCell, type SheetData } from "@/lib/sheet-text";

// Таблицу читаем по листам, строка — одна строка текста, ячейки через « | » (sheet-text.ts, общая часть с .xls).
// Формулы — их значение, а не сама формула. Объединённая ячейка стоит один раз — в первой клетке, остальные пусты.

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toLocaleDateString("ru-RU");
  if (typeof value === "number") return numberText(value);
  if (typeof value === "boolean") return value ? "да" : "нет";
  if (typeof value === "string") return value;
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  if ("result" in value) return value.result === undefined ? "" : cellText(value.result as ExcelJS.CellValue);
  if ("text" in value) return String(value.text);
  if ("error" in value) return "";
  return "";
}

// hidden — что в файле скрыто: лист, строки, столбцы с содержимым. Лист скрыт — в текст он не попадает; заказчики нередко запрещают скрытое.
export async function xlsxText(buffer: Buffer): Promise<{ text: string; map?: DocMap; hidden: string[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const sheets = workbook.worksheets.map((sheet): SheetData => {
    const visible = sheet.state === "visible";
    const rows: SheetCell[][] = [];
    let hiddenRows = 0;
    if (visible) {
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const cells: SheetCell[] = [];
        for (let col = 1; col <= row.cellCount; col++) {
          const cell = row.getCell(col);
          // Остальные клетки объединённой ячейки повторяют её значение — второй раз его не пишем.
          cells.push({ text: cell.type === ExcelJS.ValueType.Merge ? "" : cleanText(cellText(cell.value)), address: cell.address, col });
        }
        if (cells.some((c) => c.text)) {
          rows.push(cells);
          if (row.hidden) hiddenRows++;
        }
      });
    }
    const hiddenCols = visible ? Array.from({ length: sheet.columnCount }, (_, i) => i + 1).filter((col) => sheet.getColumn(col).hidden) : [];
    return { name: sheet.name, visible, rows, hiddenRows, hiddenCols };
  });
  return sheetsText(sheets);
}
