// Совместная закупка: заказчики и максимум цены по договорам — настоящий файл закупки на питание детей — npm test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { customersNotes, findCustomers } from "./customers-table.ts";
import { extractText } from "./extract-text.ts";

const FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../Татьяна-Примеры документов");
async function read(dir: string, name: string) {
  const r = await extractText(new File([new Uint8Array(readFileSync(path.join(FOLDER, dir, name)))], name), { ocr: false });
  assert.ok(r.ok, name);
  return { name, text: r.text };
}
const FOOD = "Детские сады Семикаракорска (аукцион, питание)";
const GROUNDS = "Обоснование максимальных значений цены.docx";

test("девять детских садов: название, максимум цены по договору, в сумме 17 000 000 ₽", async () => {
  const found = findCustomers([await read(FOOD, GROUNDS)])!;
  assert.equal(found.rows.length, 9);
  assert.deepEqual(found.rows.map((r) => [r.short, r.max]), [
    ["Родничок", 2_200_000],
    ["Звездочка", 1_200_000],
    ["Вишенка", 1_000_000],
    ["Сказка", 1_700_000],
    ["Золотая рыбка", 3_900_000],
    ["Росинка", 1_300_000],
    ["Светлячок", 2_600_000],
    ["Дружба", 1_700_000],
    ["Казачок", 1_400_000],
  ]);
  assert.equal(found.total, 17_000_000);
});

test("пометки для шага «Цена»: перечень одной строкой, обеспечение по каждому договору — от 10 000 до 39 000 ₽", async () => {
  const notes = customersNotes([await read(FOOD, GROUNDS)], { nmck: 17_000_000, securityPct: 1 });
  assert.equal(notes.length, 2);
  assert.match(notes[0], /^Заказчиков 9, у каждого свой договор\. Максимум цены: «Родничок» 2,2 млн; «Звездочка» 1,2 млн;/);
  assert.match(notes[0], /«Золотая рыбка» 3,9 млн/);
  assert.match(notes[0], /всего 17 000 000,00 ₽$/);
  assert.match(notes[1], /Обеспечение исполнения 1 % считается по каждому договору: от 10 000,00 ₽ до 39 000,00 ₽/);
});

test("сумма максимумов не равна начальной цене закупки — об этом сказано; обеспечения нет — строки про него нет", async () => {
  const notes = customersNotes([await read(FOOD, GROUNDS)], { nmck: 17_100_000, securityPct: null });
  assert.equal(notes.length, 2);
  assert.match(notes[1], /Сумма максимумов 17 000 000,00 ₽ не равна начальной цене закупки 17 100 000,00 ₽/);
});

test("один заказчик или нет таблицы — списка нет", async () => {
  assert.equal(findCustomers([await read("Школа № 196 (неконкурентная закупка СМСП)", "Проект договора.doc")]), null);
  const one = ["Максимальное значение цены контракта каждого заказчика (руб.)", "Муниципальное бюджетное учреждение «Один» | 2 | 1000000,00"].join("\n");
  assert.equal(findCustomers([{ name: "а.docx", text: one }]), null);
  assert.deepEqual(customersNotes([{ name: "а.docx", text: "Обычный текст" }], { nmck: 100, securityPct: 1 }), []);
});
