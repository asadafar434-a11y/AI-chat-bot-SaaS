import "server-only";
import ExcelJS from "exceljs";

// Таблицу читаем по листам, строка — одна строка текста, ячейки через « | ».
// Так ИИ видит, какое значение в какой колонке, а цитата из таблицы находится в тексте.
// Формулы — их значение, а не сама формула; пустые строки и колонки пропускаем.

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

export async function xlsxText(buffer: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const sheets: string[] = [];
  for (const sheet of workbook.worksheets) {
    if (sheet.state !== "visible") continue;
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let col = 1; col <= row.cellCount; col++) cells.push(clean(cellText(row.getCell(col).value)));
      if (cells.some(Boolean)) rows.push(cells);
    });
    if (rows.length === 0) continue;

    // Колонки, пустые во всех строках, выбрасываем, чтобы не плодить « |  |  | ».
    const width = Math.max(...rows.map((r) => r.length));
    const used = Array.from({ length: width }, (_, col) => rows.some((r) => r[col]));
    const lines = rows.map((r) => r.filter((_, col) => used[col]).join(" | ").replace(/(\s\|\s)+$/, ""));
    sheets.push(`## Лист «${sheet.name}»\n${lines.join("\n")}`);
  }
  return sheets.join("\n\n");
}
