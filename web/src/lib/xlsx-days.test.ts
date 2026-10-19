// Меню в Excel, где дни идут по столбцам: каждый день читается отдельным блоком — npm test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { extractText } from "./extract-text.ts";
import { xlsxText } from "./xlsx-text.ts";

test("три дня по столбцам: блюда не слипаются в одну строку, у каждого дня свой блок, адрес ячейки остаётся", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Меню");
  sheet.addRow(["Меню на неделю"]);
  sheet.addRow(["1 день", null, "2 день", null, "3 день", null]);
  sheet.addRow(["Завтрак", null, "Завтрак", null, "Завтрак", null]);
  sheet.addRow(["Каша геркулесовая", 200, "Омлет", 150, "Сырники", 180]);
  sheet.addRow(["Чай", 180, "Какао", 180, "Компот", 180]);
  const { text, map } = await xlsxText(Buffer.from(await book.xlsx.writeBuffer()));
  assert.equal(
    text,
    ["## Лист «Меню»", "Меню на неделю", "### 1 день", "Завтрак", "Каша геркулесовая | 200", "Чай | 180", "### 2 день", "Завтрак", "Омлет | 150", "Какао | 180", "### 3 день", "Завтрак", "Сырники | 180", "Компот | 180"].join("\n")
  );
  const at = text.indexOf("Омлет");
  const span = map?.spans.find((s) => s.from <= at && s.to > at) as { sheet?: string; cell?: string } | undefined;
  assert.deepEqual([span?.sheet, span?.cell], ["Меню", "C4"]);
});

test("обычная таблица и две «дня» в строке — построчно, как раньше", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Лист1");
  sheet.addRow(["Наименование", "1 день", "2 день"]);
  sheet.addRow(["Хлеб", 10, 20]);
  const { text } = await xlsxText(Buffer.from(await book.xlsx.writeBuffer()));
  assert.equal(text, "## Лист «Лист1»\nНаименование | 1 день | 2 день\nХлеб | 10 | 20");
});

test("меню детских садов Семикаракорска (настоящий файл): десять дней, строки одного блюда вместе, граммовка при блюде", async () => {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../Татьяна-Примеры документов/Детские сады Семикаракорска (аукцион, питание)/Приложение № 1.1 Меню Сад.xlsx");
  const r = await extractText(new File([new Uint8Array(readFileSync(file))], "Меню Сад.xlsx"), { ocr: false });
  assert.ok(r.ok);
  const day4 = r.text.slice(r.text.indexOf("### 4 день"), r.text.indexOf("### 5 день"));
  assert.equal((r.text.match(/^### \d+ день$/gm) ?? []).length, 10);
  assert.match(day4, /Щи с картофелем на\nмясном бульоне со сметаной \| 200\nГуляш из отварного мяса \| 50\/50\nМакароны отварные \| 180/);
  assert.ok(!day4.includes("Каша гречневая"), "блюда пятого дня в блок четвёртого не попали");
});
