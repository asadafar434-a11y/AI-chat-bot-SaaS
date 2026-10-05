// EIS Document Intelligence: XLSX-извлечение (листы, адреса, формулы, merge). Запуск: npm test.
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { test } from "node:test";
import { extractDocument } from "../extract/pipeline.ts";
import { extractXlsx } from "../extract/xlsx.ts";

async function workbookBytes(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const spec = workbook.addWorksheet("Технические характеристики");
  spec.getCell("A1").value = "Показатель";
  spec.getCell("B1").value = "Значение";
  spec.getCell("A2").value = "Плотность";
  spec.getCell("B2").value = 80;
  spec.getCell("B2").numFmt = "0 г/м2";
  spec.getCell("A3").value = "Количество";
  spec.getCell("B3").value = { formula: "SUM(B2,20)", result: 100 };
  const prices = workbook.addWorksheet("Цены");
  prices.getCell("A1").value = "Итого";
  prices.mergeCells("B2:C3");
  prices.getCell("B2").value = "merged-value";
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

const input = (bytes: Uint8Array) => ({
  id: "spec.xlsx",
  tenderRegistryNumber: "0373100130926000001",
  fileName: "spec.xlsx",
  documentType: "spec",
  bytes,
});

test("xlsx: листы, ячейки с адресами sheet/row/column", async () => {
  const result = await extractXlsx(await workbookBytes());
  assert.deepEqual(result.sheets, ["Технические характеристики", "Цены"]);
  assert.equal(result.tables.length, 2);
  const spec = result.tables[0];
  assert.ok(spec);
  assert.equal(spec.sheet, "Технические характеристики");
  assert.equal(spec.rows[1]?.[0]?.text, "Плотность");
  assert.equal(spec.rows[1]?.[0]?.row, 2);
  assert.equal(spec.rows[1]?.[0]?.column, 1);
  assert.equal(spec.rows[1]?.[0]?.metadata?.address, "A2");
  // Блок таблицы ссылается на лист.
  const block = result.pages[0]?.blocks[0];
  assert.equal(block?.type, "table");
  assert.equal(block?.source.sheet, "Технические характеристики");
  assert.ok(block?.text.includes("Плотность | 80"));
});

test("xlsx: формула и числовой формат сохраняются", async () => {
  const result = await extractXlsx(await workbookBytes());
  const formulaCell = result.tables[0]?.rows[2]?.[1];
  assert.equal(formulaCell?.metadata?.formula, "SUM(B2,20)");
  assert.equal(formulaCell?.text, "100");
  const fmtCell = result.tables[0]?.rows[1]?.[1];
  assert.equal(fmtCell?.metadata?.numberFormat, "0 г/м2");
});

test("xlsx: merged — ведомая клетка ссылается на главную", async () => {
  const result = await extractXlsx(await workbookBytes());
  const prices = result.tables[1];
  assert.ok(prices);
  const slave = prices.rows.flat().find((c) => c.metadata?.mergedFrom);
  assert.ok(slave);
  assert.equal(slave.metadata?.mergedFrom, "B2");
  const master = prices.rows.flat().find((c) => c.metadata?.mergedRange);
  assert.ok(master);
  assert.equal(master?.metadata?.mergedRange, "B2:C3");
});

test("xlsx: pipeline — полный проход и битый файл", async () => {
  const normalized = await extractDocument(input(await workbookBytes()), {});
  assert.equal(normalized.document.format, "xlsx");
  assert.equal(normalized.extraction.status, "complete");
  assert.equal(normalized.tables.length, 2);

  const broken = await extractDocument(input(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9])), {});
  assert.equal(broken.document.format, "xlsx");
  assert.equal(broken.extraction.status, "failed");
});
