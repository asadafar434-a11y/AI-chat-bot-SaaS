/**
 * EIS Document Intelligence — извлечение из XLSX.
 *
 * Таблицы НЕ теряются: каждая ячейка — sheet + row + column (+ адрес «F17»),
 * displayed value + сырое значение, формула, числовой формат, merged cells
 * (ведомая клетка ссылается на главную, главная — на диапазон).
 * Паттерн чтения — как в xlsx-text.ts (exceljs), но с полной адреской.
 */

import ExcelJS from "exceljs";
import type { EisPage, EisTable } from "./types.ts";

export interface XlsxExtractResult {
  pages: EisPage[];
  tables: EisTable[];
  truncated: boolean;
  sheets: string[];
}

const MAX_BLOCKS_PER_DOC = 20000;
const MAX_CELLS_PER_DOC = 200000;

const clean = (text: string): string => text.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();

/** Отображаемое значение ячейки (как видит пользователь в Excel). */
function displayText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toLocaleDateString("ru-RU");
  if (typeof value === "number") return String(Math.round(value * 1e9) / 1e9).replace(".", ",");
  if (typeof value === "boolean") return value ? "да" : "нет";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    if ("richText" in value) return (value.richText as Array<{ text: string }>).map((part) => part.text).join("");
    if ("result" in value) {
      const result = (value as { result?: unknown }).result;
      return result === undefined || result === null ? "" : displayText(result as ExcelJS.CellValue);
    }
    if ("text" in value) return String((value as { text?: unknown }).text ?? "");
    if ("error" in value) return "";
  }
  return "";
}

export async function extractXlsx(bytes: Uint8Array): Promise<XlsxExtractResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  const pages: EisPage[] = [];
  const tables: EisTable[] = [];
  let tableIndex = 0;
  let blockSeq = 0;
  let cellCount = 0;
  let truncated = false;
  const nextId = (): string => `b${++blockSeq}`;

  let pageNumber = 0;
  for (const sheet of workbook.worksheets) {
    if (sheet.state !== "visible") continue;
    pageNumber++;
    const page: EisPage = { pageNumber, blocks: [] };
    tableIndex++;
    const rows: EisTable["rows"] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const out: EisTable["rows"][number] = [];
      for (let col = 1; col <= row.cellCount; col++) {
        const cell = row.getCell(col);
        const text = clean(displayText(cell.value));
        cellCount++;
        if (cellCount > MAX_CELLS_PER_DOC) {
          truncated = true;
          return;
        }
        const address = cell.address;
        const isMergeSlave = cell.type === ExcelJS.ValueType.Merge;
        const master = isMergeSlave && cell.master !== cell ? cell.master.address : undefined;
        const formula = typeof cell.value === "object" && cell.value !== null && "formula" in cell.value
          ? String((cell.value as { formula?: unknown }).formula ?? "")
          : undefined;
        const numberFormat = typeof cell.numFmt === "string" && cell.numFmt ? cell.numFmt : undefined;
        out.push({
          text,
          row: row.number,
          column: col,
          ...((address || formula || numberFormat || master) && {
            metadata: {
              ...(address ? { address } : {}),
              ...(formula ? { formula } : {}),
              ...(numberFormat ? { numberFormat } : {}),
              ...(master ? { mergedFrom: master } : {}),
            },
          }),
        });
      }
      if (out.some((c) => c.text)) rows.push(out);
    });
    if (rows.length === 0) continue;
    // Диапазоны merged-мастеров: ведомые уже ссылаются на главную.
    try {
      const merges = (sheet as unknown as { _merges?: Record<string, { shortRange?: string }> })._merges;
      if (merges) {
        const byMaster = new Map<string, string>();
        for (const [, merge] of Object.entries(merges)) {
          const range = merge?.shortRange;
          if (!range) continue;
          const masterAddr = range.split(":")[0];
          if (masterAddr) byMaster.set(masterAddr, range);
        }
        for (const r of rows) {
          for (const c of r) {
            const addr = c.metadata?.address;
            const range = addr ? byMaster.get(addr) : undefined;
            if (range && c.metadata && !c.metadata.mergedFrom) c.metadata.mergedRange = range;
          }
        }
      }
    } catch {
      // Merge-диапазоны — дополнение; не роняют извлечение.
    }
    const table: EisTable = {
      tableIndex,
      pageNumber,
      sheet: sheet.name,
      rows,
      metadata: { rows: rows.length, cols: Math.max(0, ...rows.map((r) => r.length)) },
    };
    tables.push(table);
    if (blockSeq < MAX_BLOCKS_PER_DOC) {
      page.blocks.push({
        id: nextId(),
        type: "table",
        text: rows.map((r) => r.map((c) => c.text).join(" | ")).join("\n"),
        source: { kind: "xlsx", page: pageNumber, sheet: sheet.name },
        metadata: { tableIndex },
      });
    } else {
      truncated = true;
    }
    // Адресные блоки по ячейкам не плодим (шум): точный адрес — в table.rows.
    pages.push(page);
  }
  return { pages, tables, truncated, sheets: tables.map((t) => t.sheet ?? "") };
}
