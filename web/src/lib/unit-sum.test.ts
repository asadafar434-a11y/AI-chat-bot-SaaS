// Торг по сумме цен единиц: настоящие файлы закупки на питание детей (9 детских садов Семикаракорска) — npm test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { extractText } from "./extract-text.ts";
import { findUnitSum, unitSumNotes } from "./unit-sum.ts";

const FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../Татьяна-Примеры документов");
async function read(dir: string, name: string) {
  const r = await extractText(new File([new Uint8Array(readFileSync(path.join(FOLDER, dir, name)))], name), { ocr: false });
  assert.ok(r.ok, name);
  return { name, text: r.text };
}
const FOOD = "Детские сады Семикаракорска (аукцион, питание)";
const CONTRACT = "Приложение № 4 Проект контракта.docx";
const GROUNDS = "Обоснование максимальных значений цены.docx";
const ONMCK = "Приложение № 2 ОНМЦК.xlsx";

test("начальная сумма цен единиц — 173 + 200 = 373 ₽: из таблицы обоснования (цены и сумма в одной строке)", async () => {
  const unit = findUnitSum([await read(FOOD, CONTRACT), await read(FOOD, GROUNDS)]);
  assert.deepEqual(unit && [unit.parts, unit.sum, unit.doc], [[173, 200], 373, GROUNDS]);
});

test("та же сумма из расчёта НМЦК: сумма — в строке шапки, цены единиц — в последних столбцах строк выше", async () => {
  const unit = findUnitSum([await read(FOOD, CONTRACT), await read(FOOD, ONMCK)]);
  assert.deepEqual(unit && [unit.parts, unit.sum], [[173, 200], 373]);
});

test("нет слов «сумма цен единиц» в документах — режима нет: обоснование само по себе и закупка школы не считаются", async () => {
  assert.equal(findUnitSum([await read(FOOD, GROUNDS)]), null);
  assert.equal(findUnitSum([await read("Школа № 196 (неконкурентная закупка СМСП)", "Проект договора.doc")]), null);
  assert.deepEqual(unitSumNotes([await read(FOOD, ONMCK)]), []);
});

test("номера столбцов (1 | 2 | 3) суммой цен не считаются", () => {
  const text = ["Договор: сумма цен единиц товара", "Начальная сумма цен услуги", "1 | 2 | 3 | 4", "Условная единица | 5 | 5 | 10"].join("\n");
  assert.equal(findUnitSum([{ name: "а.docx", text }]), null);
});

test("пометки для шага «Цена»: торг по сумме цен единиц и порог снижения на 25 % — 279,75 ₽ (обеспечение — по проекту договора)", async () => {
  const notes = unitSumNotes([await read(FOOD, CONTRACT), await read(FOOD, GROUNDS)]);
  assert.equal(notes.length, 2);
  assert.match(notes[0], /Торг идёт по сумме цен единиц: начальная сумма 373,00 ₽ \(173,00 ₽ \+ 200,00 ₽\), а не по начальной цене договора/);
  assert.match(notes[1], /Снижение на 25 % и более — это сумма ниже 279,75 ₽: по проекту договора обеспечение исполнения тогда в 1,5 раза больше обычного и не меньше 10 %/);
  // правила про антидемпинг в документах нет — пороговую пометку не пишем
  const withoutRule = unitSumNotes([{ name: "а.docx", text: "сумма цен единиц" }, await read(FOOD, GROUNDS)]);
  assert.equal(withoutRule.length, 1);
});
