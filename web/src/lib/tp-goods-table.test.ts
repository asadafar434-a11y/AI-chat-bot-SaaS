// Таблица товаров в файле заявки по форме заказчика: что попадает в какой столбец — npm test.
// Заголовки и строки взяты из настоящей закупки (запрос котировок: шапки, перчатки, бейсболки).
import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { registryLine } from "./registry-types.ts";
import { buildTpDocx } from "./tp-docx.ts";

const HEADERS = [
  "№ № п/п",
  "Наименование поставляемого товара (указать торговое наименование товара или имеющийся товарный знак)",
  "Указать характеристики поставляемого товара",
  "Указать страну происхождения товара",
  "Ед. изм.",
  "Цена за ед., руб.",
  "Кол-во",
  "Стоимость, руб.",
];
const FORM = { title: "Заявка", source: "", participantFields: [], consent: "Согласие", hasPrice: true, priceNote: "", smeDeclaration: "" };
const ORIGIN = "Страна происхождения товара: Россия\nНомер реестровой записи из реестра российской промышленной продукции: [номер реестровой записи — если товар относится к позициям приложений № 2, № 3 к постановлению Правительства РФ № 1875]";
type TestGood = { name: string; characteristics: string; quantity: string; registryNumber?: string; registryNeeded?: boolean };
const GOODS: TestGood[] = [
  { name: "Шапка мужская зимняя", characteristics: "Пол: мужская\nСостав материала: Шерсть [число, не меньше 30] %\nОКПД: 14.19.42.140", quantity: "80 штук", registryNumber: "10548914", registryNeeded: true },
  { name: "Перчатки мужские зимние", characteristics: "Сезон: Зима\nРазмер: универсальный\nОКПД2: 14.19.23.140", quantity: "80 пар", registryNeeded: true },
  { name: "Страна происхождения – Россия", characteristics: ORIGIN, quantity: "", registryNeeded: true },
];

// Строки таблицы файла Word: текст каждой ячейки.
async function rowsOf(headers: string[], goods: TestGood[] = GOODS): Promise<string[][]> {
  const buffer = await buildTpDocx("tp", { subject: "Поставка", form: { ...FORM, goodsTableHeaders: headers }, goods, items: [], cast: null, price: null, profile: null });
  const xml = await (await JSZip.loadAsync(buffer)).file("word/document.xml")!.async("string");
  const rows = [...xml.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((r) => r[0]);
  return rows.map((row) =>
    [...row.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((cell) =>
      [...cell[0].matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) => [...p[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join("")).join("\n"),
    ),
  );
}

test("форма заказчика с 8 столбцами: характеристики участника в своём столбце, номер вместо ОКПД, страна — «Россия», единица и количество раздельно", async () => {
  const [head, ...rows] = await rowsOf(HEADERS);
  assert.equal(head.length, 8);
  assert.equal(rows.length, 2, "строка «Страна происхождения – Россия» — не товар и в таблицу не попадает");
  const [first, second] = rows;
  assert.equal(first[0], "1");
  assert.equal(first[1], "Шапка мужская зимняя");
  assert.ok(first[2].includes("Пол: мужская"));
  assert.ok(first[2].includes("Состав материала: Шерсть [число, не меньше 30] %"), "поле для числа осталось: границу заказчика не копируем");
  assert.ok(first[2].endsWith(registryLine("10548914")), "на месте ОКПД — реестровый номер");
  assert.equal(first[2].includes("ОКПД"), false);
  assert.equal(first[3], "Россия");
  assert.equal(first[4], "штук", "Ед. изм.");
  assert.equal(first[5], "[заполните]", "цену участник вписывает сам");
  assert.equal(first[6], "80", "Кол-во — только число");
  assert.ok(second[2].endsWith("[номер реестровой записи — выберите в блоке «Реестровые номера товаров» на шаге «Пакет»]"), "номер не выбран — жёлтое поле на месте ОКПД");
  assert.equal(second[4], "пар");
  assert.equal(second[6], "80");
  for (const row of rows) assert.equal(row.some((c) => c.includes("[характеристика из ТЗ]")), false, "заглушки вместо характеристик нет");
});

test("один столбец «Характеристики товара» без столбца «Предложение участника» — это столбец участника: характеристики туда", async () => {
  const [, ...rows] = await rowsOf(["№", "Наименование", "Характеристики товара", "Количество"], GOODS.slice(0, 2));
  assert.ok(rows[0][2].includes("Пол: мужская"));
  assert.equal(rows[0][3], "80 штук", "нет столбца единицы — количество с единицей, как было");
});

test("столбец заказчика «Характеристика по ТЗ» рядом со столбцом «Предложение участника» остаётся для заказчика", async () => {
  const [, ...rows] = await rowsOf(["№", "Наименование", "Характеристика по ТЗ", "Предложение участника", "Кол-во"], GOODS.slice(0, 1));
  assert.equal(rows[0][2], "[характеристика из ТЗ]");
  assert.ok(rows[0][3].includes("Пол: мужская"));
});

test("«Ед. изм.» с точкой и пробелом узнаётся; количество с дробью и единицей делится верно", async () => {
  const [, ...rows] = await rowsOf(["№", "Наименование", "Ед. изм.", "Кол-во"], [
    { name: "Кабель", characteristics: "x", quantity: "1,5 кг" },
    { name: "Бумага", characteristics: "x", quantity: "500 пачек" },
    { name: "Услуга", characteristics: "x", quantity: "по запросу" },
  ]);
  assert.deepEqual([rows[0][2], rows[0][3]], ["кг", "1,5"]);
  assert.deepEqual([rows[1][2], rows[1][3]], ["пачек", "500"]);
  assert.deepEqual([rows[2][2], rows[2][3]], ["по запросу", "по запросу"], "числа нет — берём как есть");
});

test("стандартная таблица без формы заказчика: четыре столбца, строка про происхождение остаётся, ОКПД убран, номер на месте", async () => {
  const [head, ...rows] = await rowsOf([]);
  assert.equal(head.length, 4);
  assert.equal(rows.length, 3);
  assert.ok(rows[0][2].endsWith(registryLine("10548914")));
  assert.equal(rows[0][2].includes("ОКПД"), false);
  assert.equal(rows[0][3], "80 штук");
});
