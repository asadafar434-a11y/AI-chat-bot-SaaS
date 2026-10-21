// Пересчёт обоснования начальной цены у заказчика: цены поставщиков, средняя, отклонение и коэффициент вариации — на выдуманных строках и на настоящих файлах заказчиков — npm test (без ИИ).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { extractText } from "./extract-text.ts";
import { findNmckCalculations } from "./nmck-check.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../Татьяна-Примеры документов");
async function read(rel: string) {
  const file = path.join(ROOT, rel);
  const r = await extractText(new File([new Uint8Array(readFileSync(file))], path.basename(file)), { ocr: false });
  assert.ok(r.ok, `${rel} не прочитан`);
  return [{ name: path.basename(file), text: r.text }];
}
const kinds = (c: { issues: { kind: string }[] }) => c.issues.map((i) => i.kind);

const HEADER = " |  |  | Поставщик №1 | Поставщик №2 | Поставщик №3 | Средняя арифметическая цена | Среднее квадратичное отклонение | коэффициент вариации цен V (%) | Расчёт НМЦК";
const table = (row: string) => [{ name: "Обоснование.xlsx", text: ["Расчёт цены", HEADER, row].join("\n") }];

test("строка расчёта находится по арифметике: за ценами поставщиков стоит их среднее; сходится — замечаний нет", () => {
  const [c] = findNmckCalculations(table("Уголь | 2900 | 3 | 100 | 110 | 120 | 110 | 10 | 9,0909 | 319000"));
  assert.ok(c);
  assert.deepEqual(c.offers, [100, 110, 120]);
  assert.equal(c.mean, 110);
  assert.equal(c.name, "Уголь");
  assert.deepEqual(kinds(c), []);
});

test("отклонение и вариация, которые не сходятся с ценами, — замечания: как в Семикаракорске, где вариация подтянута из чужого файла", () => {
  const [c] = findNmckCalculations(table("Питание |  |  | 170 | 173 | 176 | 173 | 0,098488578 | 0,072274586 | 173"));
  assert.deepEqual(c.offers, [170, 173, 176]);
  assert.deepEqual(kinds(c), ["stdev", "cv-printed"]);
  assert.match(c.issues[0].text, /не сходится с ценами: по ним получается 3/);
  assert.match(c.issues[1].text, /7,2 % не сходится с ценами: по ним получается 1,7 %/);
});

test("отклонение, посчитанное делением на n вместо n − 1, — пометка «info», а не ошибка", () => {
  // По трём ценам 100, 110, 120: СКО по выборке 10, по n — 8,165.
  const [c] = findNmckCalculations(table("Уголь |  |  | 100 | 110 | 120 | 110 | 8,165 | 9,0909 | 330"));
  assert.deepEqual(kinds(c).filter((k) => k !== "cv-printed"), ["stdev-population"]);
  assert.equal(c.issues.find((i) => i.kind === "stdev-population")?.level, "info");
});

test("цены разошлись больше, чем на 33 %: среднее по ним использовать нельзя — замечание, даже если заказчик посчитал всё верно", () => {
  const [c] = findNmckCalculations(table("Кран | 1 | 100 | 150 | 300 | 183,33 | 104,08 | 56,8 | 183,33"));
  assert.ok(c.stats.cv > 0.33);
  assert.ok(kinds(c).includes("cv-high"));
  assert.equal(c.issues.find((i) => i.kind === "cv-high")?.level, "warn");
});

test("строки без среднего за ценами, числа-нумерация столбцов и строки без текста расчётом не считаются", () => {
  assert.deepEqual(findNmckCalculations(table("1 | 2 | 3 | 4 | 5 | 6")), []);
  assert.deepEqual(findNmckCalculations(table("Соль | 9,81 | 10,5 | 10,32 | 12950000 | 117715500")), []);
  assert.deepEqual(findNmckCalculations(table("100 | 110 | 120 | 110")), [], "нет текста — не расчёт");
  assert.deepEqual(findNmckCalculations([{ name: "x", text: "Просто текст без таблиц" }]), []);
});

test("одна и та же строка в нескольких местах документа показывается один раз", () => {
  const row = "Уголь | 3 | 100 | 110 | 120 | 110 | 10 | 9,0909 | 319000";
  assert.equal(findNmckCalculations([{ name: "a", text: [HEADER, row, HEADER, row].join("\n") }]).length, 1);
});

test("настоящее обоснование МУП «Тепло» (.xls): три предложения, средняя 8 941,38, отклонение 894,14, вариация 10 % — всё сходится", async () => {
  const calcs = findNmckCalculations(await read("МУП Тепло Корсаков (аукцион 223-ФЗ, уголь)/Обоснование НМЦД.xls"));
  assert.equal(calcs.length, 1);
  assert.deepEqual(calcs[0].offers, [8941.38, 9835.52, 8047.24]);
  assert.equal(calcs[0].mean, 8941.38);
  assert.equal(calcs[0].printed.stdev, 894.14);
  assert.ok(Math.abs(calcs[0].printed.cv! - 10) < 0.001);
  assert.deepEqual(kinds(calcs[0]), []);
});

test("настоящий расчёт «Комфортной среды»: два этапа, по три предложения, вариация 9,4 % и 12,8 %, расхождений нет", async () => {
  const calcs = findNmckCalculations(await read("Комфортная среда (конкурентный отбор 223-ФЗ, обследование и ПИР)/Расчет НМЦК (по рынку) на Обсл-е и ПСД  на ККР, Екб, Мостовая-57(v1).xlsx"));
  assert.equal(calcs.length, 2);
  assert.deepEqual(calcs[0].offers, [1928947.78, 2318000, 2063020]);
  assert.deepEqual(calcs[1].offers, [7339405.8, 9470860, 8252080]);
  assert.ok(Math.abs(calcs[0].stats.cv - 0.093962) < 1e-6);
  assert.ok(Math.abs(calcs[1].stats.cv - 0.128007) < 1e-6);
  for (const c of calcs) assert.deepEqual(kinds(c), [], c.name);
});

test("настоящий расчёт детских садов Семикаракорска: вариация и отклонение подтянуты из чужого файла и не сходятся с ценами — программа это находит", async () => {
  const calcs = findNmckCalculations(await read("Детские сады Семикаракорска (аукцион, питание)/Приложение № 2 ОНМЦК.xlsx"));
  assert.ok(calcs.length >= 2, `найдено строк: ${calcs.length}`);
  const first = calcs.find((c) => c.offers.join() === "170,173,176")!;
  assert.ok(first, "строка 170 / 173 / 176");
  assert.deepEqual(kinds(first), ["stdev", "cv-printed"]);
  assert.ok(Math.abs(first.stats.cv * 100 - 1.734) < 0.001, "по ценам вариация около 1,7 %, а в файле 7,23 %");
  for (const c of calcs) assert.ok(kinds(c).includes("cv-printed"), `${c.name}: ${c.offers}`);
});

test("настоящий расчёт ГАУ ЦТО: заказчик принял к расчёту не среднюю, а минимальную цену из трёх — программа об этом говорит", async () => {
  const calcs = findNmckCalculations(await read("ГАУ ЦТО Москва (аукцион МСП 223-ФЗ, стенды для СПО)/Расчет НМЦД СПО-КР2027-36.xlsx"));
  assert.equal(calcs.length, 6, "три позиции, у каждой цены с НДС и без");
  const first = calcs[0];
  assert.deepEqual(first.offers, [6100000, 5480000, 6190000]);
  assert.equal(first.printed.adopted, 5480000);
  const note = first.issues.find((i) => i.kind === "adopted");
  assert.ok(note);
  assert.match(note.text, /минимальная из предложений/);
  assert.match(note.text, /ниже средней/);
  for (const c of calcs) assert.ok(kinds(c).includes("adopted"), c.name);
});
