// Вписывание значений в Excel-бланк заказчика: файл остаётся прежним, меняются только нужные ячейки — npm test (без ИИ).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import ExcelJS from "exceljs";
import { EMPTY_PROFILE } from "./profile.ts";
import { applyEdits, columnLetters, columnNumber, readBook, refOf } from "./xlsx-form.ts";
import { planFill } from "./xlsx-plan.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../Татьяна-Примеры документов");
const bytesOf = (rel: string) => new Uint8Array(readFileSync(path.join(ROOT, rel)));
const RVK = "РВК-Комсомольск (маркетинговое исследование 223-ФЗ, бухучёт)";
const DGK = "ДГК (конкурс 223-ФЗ, комплектующие дымососов)";
const USGS = "УСГС (аукцион МСП 223-ФЗ, новогодние подарки, итог)";

const profile = {
  ...EMPTY_PROFILE,
  fullName: "ООО «Пример»",
  shortName: "ООО «Пример»",
  inn: "7701234567",
  kpp: "770101001",
  ogrn: "1027700000000",
  legalAddress: "г. Москва, ул. Тверская, 1",
  postalAddress: "г. Москва, ул. Тверская, 2",
  phone: "+7 495 000-00-00",
  email: "info@example.ru",
  head: "Генеральный директор Иванов И. И.",
  bankName: "АО «Банк»",
  account: "40702810000000000001",
  bik: "044525000",
};

async function workbook(build: (book: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook();
  build(book);
  return new Uint8Array(await book.xlsx.writeBuffer());
}

test("адреса ячеек: буквы и номера столбцов в обе стороны", () => {
  assert.equal(columnNumber("A"), 1);
  assert.equal(columnNumber("Z"), 26);
  assert.equal(columnNumber("AA"), 27);
  assert.equal(columnLetters(28), "AB");
  assert.equal(refOf(15, 9), "I15");
});

test("значения попадают в нужные ячейки; стиль, соседние ячейки, формулы и скрытый лист остаются; Excel пересчитает формулы при открытии", async () => {
  const bytes = await workbook((book) => {
    const sheet = book.addWorksheet("Анкета");
    sheet.addRow(["№", "Наименование", "Сведения"]);
    sheet.addRow([1, "ИНН Участника", ""]);
    sheet.addRow([2, "Цена", { formula: "B3*2", result: 10 }]);
    sheet.getCell("C2").font = { bold: true };
    sheet.getCell("C2").numFmt = "@";
    const hidden = book.addWorksheet("Справочник");
    hidden.state = "hidden";
    hidden.addRow(["а", "б"]);
  });
  const book = readBook(bytes);
  const out = applyEdits(book, [{ sheet: "Анкета", ref: "C2", value: "7701234567" }, { sheet: "Анкета", ref: "D5", value: 42 }]);
  const back = await new ExcelJS.Workbook().xlsx.load(Buffer.from(out) as never);
  const sheet = back.getWorksheet("Анкета")!;
  assert.equal(sheet.getCell("C2").value, "7701234567");
  assert.equal(sheet.getCell("C2").font?.bold, true, "стиль ячейки не потерян");
  assert.equal(sheet.getCell("D5").value, 42, "новая ячейка в новой строке");
  assert.equal(sheet.getCell("B2").value, "ИНН Участника");
  assert.deepEqual((sheet.getCell("C3").value as { formula: string }).formula, "B3*2", "формула на месте");
  assert.equal(back.getWorksheet("Справочник")!.state, "hidden");
  const workbookXml = Buffer.from(unzipSync(out)["xl/workbook.xml"]).toString("utf8");
  assert.match(workbookXml, /<calcPr[^>]*fullCalcOnLoad="1"/);
  assert.deepEqual(Object.keys(unzipSync(out)).sort(), Object.keys(unzipSync(bytes)).sort(), "все части файла на месте");
});

test("вписывание в уже заполненную ячейку заменяет значение, а текст с символами XML и пробелами не ломает файл", async () => {
  const bytes = await workbook((book) => {
    const sheet = book.addWorksheet("Лист");
    sheet.addRow(["Название", "старое"]);
  });
  const out = applyEdits(readBook(bytes), [{ sheet: "Лист", ref: "B1", value: '  ООО «А&Б» <тест> "кавычки" ' }]);
  const sheet = (await new ExcelJS.Workbook().xlsx.load(Buffer.from(out) as never)).getWorksheet("Лист")!;
  assert.equal(sheet.getCell("B1").value, '  ООО «А&Б» <тест> "кавычки" ');
});

test("настоящая анкета РВК: реквизиты ложатся напротив названий, строки про экологию и труд остаются «да/нет», сторона заказчика не трогается", async () => {
  const bytes = bytesOf(`${RVK}/Приложение № 3 -  Анкета Участника.xlsx`);
  const book = readBook(bytes);
  const plan = planFill(book, { profile, subject: "Услуги", goods: [] });
  const byLabel = new Map(plan.filled.map((f) => [f.label, f.value]));
  assert.equal(byLabel.get("Фирменное наименование Участника"), "ООО «Пример»");
  assert.equal(byLabel.get("ИНН Участника"), "7701234567");
  assert.equal(byLabel.get("КПП Участника"), "770101001");
  assert.equal(byLabel.get("ОГРН Участника"), "1027700000000");
  assert.equal(byLabel.get("Адрес места нахождения"), "г. Москва, ул. Тверская, 1");
  assert.equal(byLabel.get("Почтовый адрес"), "г. Москва, ул. Тверская, 2");
  assert.equal(byLabel.get("Телефоны Участника (с указанием кода города)"), "+7 495 000-00-00");
  assert.equal(byLabel.get("Адрес электронной почты Участника"), "info@example.ru");
  assert.match([...byLabel].find(([l]) => l.startsWith("Банковские реквизиты"))?.[1] ?? "", /АО «Банк», р\/с 40702810000000000001, БИК 044525000/);
  assert.ok(![...byLabel.keys()].some((l) => /да\/нет|Кодекс|Экологическая/.test(l)));
  assert.ok(plan.left.some((l) => /ответственного лица/.test(l)), "ответственное лицо — нет в «Реквизитах»");
  assert.equal(
    [...byLabel].find(([l]) => l.startsWith("Фамилия, Имя и Отчество руководителя Участника"))?.[1],
    "Генеральный директор Иванов И. И.",
    "слово «подписи» в названии строки не делает её строкой подписи",
  );
  // Строка подписи «(Должность руководителя …) ______ И.О. Фамилия» — не реквизит.
  assert.ok(![...byLabel.keys()].some((l) => /^\(Должность/.test(l)));
  const out = readBook(applyEdits(book, plan.edits));
  const sheet = out.sheets[0];
  assert.equal(sheet.cells.get("C11")?.text, "7701234567");
  assert.equal(sheet.cells.get("C27")?.text, "да/нет", "«да/нет» не затронуто");
  assert.equal(sheet.cells.get("B11")?.text, "ИНН Участника");
});

test("настоящая форма ДГК «Структура НМЦ»: шапка, предмет и по каждой позиции страна, реестр и производитель — только то, что назвал участник; одинаковые позиции идут по очереди", async () => {
  const bytes = bytesOf(`${DGK}/Форма Коммерческого предложения и Структуры НМЦ.xlsx`);
  const book = readBook(bytes);
  const goods = [
    { name: "Крыльчатка к дымососу Д18", country: "Россия", manufacturer: "ООО «Завод»", registry: "РПП (ПП 719), № 10012345" },
    { name: "Улитка аэросмеси", country: "Россия", manufacturer: "ООО «Завод»", registry: "РПП (ПП 719), № 10012346" },
    { name: "Улитка аэросмеси", country: "Беларусь", manufacturer: "ОАО «Завод»" },
  ];
  const plan = planFill(book, { profile, subject: "Поставка запасных частей к дымососам", goods });
  const at = (ref: string) => plan.filled.find((f) => f.ref === ref)?.value;
  assert.equal(at("H9"), "ООО «Пример»");
  assert.equal(at("H10"), "7701234567");
  assert.equal(at("H11"), "Поставка запасных частей к дымососам");
  assert.deepEqual([at("H15"), at("I15"), at("J15")], ["Россия", "РПП (ПП 719), № 10012345", "ООО «Завод»"]);
  assert.deepEqual([at("H18"), at("I18"), at("J18")], ["Россия", "РПП (ПП 719), № 10012346", "ООО «Завод»"]);
  assert.deepEqual([at("H19"), at("I19"), at("J19")], ["Беларусь", undefined, "ОАО «Завод»"], "у второй улитки номера нет — ячейка остаётся «…»");
  assert.ok(plan.left.some((l) => /«Улитка аэросмеси»: реестровый номер — не указано/.test(l)));
  assert.ok(plan.left.some((l) => /Стекло маслоуказательное/.test(l)), "позиции, которых нет в вашем предложении, названы");
  // Формулы и цены заказчика (Nед) не трогаем.
  assert.ok(!plan.edits.some((e) => ["L15", "M15", "N15", "O15", "K15"].includes(e.ref)));
  const filled = applyEdits(book, plan.edits);
  // Файл остаётся целым: открывается другой библиотекой, все части архива на месте.
  await new ExcelJS.Workbook().xlsx.load(Buffer.from(filled) as never);
  assert.deepEqual(Object.keys(unzipSync(filled)).sort(), Object.keys(unzipSync(bytes)).sort());
  const out = readBook(filled);
  const sheet = out.sheets.find((s) => s.name === book.sheets[0].name)!;
  assert.equal(sheet.cells.get("I15")?.text, "РПП (ПП 719), № 10012345");
  assert.equal(sheet.cells.get("L15")?.text, book.sheets[0].cells.get("L15")?.text);
  assert.equal(sheet.cells.get("K15")?.formula, true);
  assert.equal(sheet.cells.get("I19")?.text, "…");
});

test("форма УСГС и анкета-шапка: реквизиты и предмет вписываются, строки таблицы без своих товаров не выдумываются", async () => {
  const book = readBook(bytesOf(`${USGS}/Форма Коммерческого предложения и структуры НМЦ.xlsx`));
  const plan = planFill(book, { profile, subject: "Поставка новогодних подарков", goods: [] });
  assert.deepEqual(
    plan.filled.map((f) => [f.ref, f.value]),
    [["F9", "ООО «Пример»"], ["F10", "7701234567"], ["F11", "Поставка новогодних подарков"]],
  );
  assert.ok(!plan.left.some((l) => /Стоимость заявки|Кроме того/.test(l)), "итоговые строки — не товары");
});

test("не про участника — не вписываем: «ИНН Заказчика», одно слово «Наименование» в шапке таблицы", async () => {
  const bytes = await workbook((book) => {
    const sheet = book.addWorksheet("Форма");
    sheet.addRow(["ИНН Заказчика:", ""]);
    sheet.addRow(["Наименование", ""]);
    sheet.addRow(["ИНН участника закупки:", ""]);
  });
  const plan = planFill(readBook(bytes), { profile, subject: "", goods: [] });
  assert.deepEqual(plan.filled.map((f) => [f.ref, f.value]), [["B3", "7701234567"]]);
});

test("не Excel и старый .xls не вписываем — понятная ошибка", () => {
  assert.throws(() => readBook(new Uint8Array([1, 2, 3, 4])), /\.xlsx/);
});
