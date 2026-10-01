// Где в документах стоит цитата: страница, таблица, строка, лист, ячейка, пункт, раздел — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocator, describeLocation, describeSource } from "./doc-locate.ts";
import { TextBuilder } from "./doc-source.ts";

// Документ, собранный так же, как его собирает чтение Word: заголовок, пункт, таблица, абзац на следующей странице.
function wordLike() {
  const b = new TextBuilder();
  b.add("Приложение 2", { page: 3, head: true });
  b.raw("\n\n");
  b.add("2.1. Зал вместимостью не менее 150 мест.", { page: 3 });
  b.raw("\n\n");
  const cell = (text: string, row: number, col: number, last = false) => {
    b.add(text, { page: 3, table: 1, row, col });
    b.raw(last ? "\n" : " | ");
  };
  cell("№", 1, 1);
  cell("Наименование", 1, 2);
  cell("Количество", 1, 3, true);
  cell("1", 2, 1);
  cell("Бумага офисная А4", 2, 2);
  cell("100 пачек", 2, 3, true);
  b.raw("\n");
  b.add("Заключительное примечание о приёмке услуг.", { page: 4 });
  const { text, map } = b.build(true);
  return { name: "ТЗ.docx", text, map };
}

test("место цитаты в Word: страница, таблица, строка, название столбца, пункт, раздел", () => {
  const doc = wordLike();
  const place = createLocator([doc]).locate("Бумага офисная А4");
  assert.ok(place);
  assert.equal(place.doc, "ТЗ.docx");
  assert.equal(doc.text.slice(place.from, place.to), "Бумага офисная А4");
  assert.deepEqual(
    { page: place.page, pageApprox: place.pageApprox, table: place.table, row: place.row, col: place.col, colName: place.colName, clause: place.clause, section: place.section, more: place.more },
    { page: 3, pageApprox: true, table: 1, row: 2, col: 2, colName: "Наименование", clause: "2.1", section: "Приложение 2", more: 0 }
  );
  assert.equal(describeLocation(place), "≈ стр. 3, таблица 1, строка 2, «Наименование», п. 2.1, раздел «Приложение 2»");
  assert.equal(describeSource(place), "«ТЗ.docx» — ≈ стр. 3, таблица 1, строка 2, «Наименование», п. 2.1, раздел «Приложение 2»");
});

test("у ячейки шапки своего названия столбца нет; без шапки — номер столбца; абзац — просто страница и пункт", () => {
  const doc = wordLike();
  const loc = createLocator([doc]);
  const head = loc.locate("Количество");
  assert.ok(head);
  assert.equal(head.colName, undefined);
  assert.match(describeLocation(head), /таблица 1, строка 1, столбец 3/);

  const paragraph = loc.locate("Зал вместимостью не менее 150 мест");
  assert.ok(paragraph);
  assert.equal(describeLocation(paragraph), "≈ стр. 3, п. 2.1, раздел «Приложение 2»");

  const next = loc.locate("Заключительное примечание о приёмке услуг");
  assert.ok(next);
  assert.equal(next.page, 4);
});

test("PDF без карты (сохранён до неё): страница — по меткам в тексте, раздел — по виду строк", () => {
  const text =
    "II. ИЗВЕЩЕНИЕ О ПРОВЕДЕНИИ ЗАПРОСА КОТИРОВОК\n3. Предмет запроса\nОказание услуг по организации праздника\n\n-- 1 of 2 --\n\n" +
    "4.2. Срок оказания услуг — пять рабочих дней со дня заключения договора.\n\n-- 2 of 2 --\n\n";
  const place = createLocator([{ name: "Извещение.pdf", text }]).locate("Срок оказания услуг — пять рабочих дней");
  assert.ok(place);
  assert.equal(place.page, 2);
  assert.equal(place.pageApprox, undefined);
  assert.equal(place.clause, "4.2");
  assert.equal(place.section, "II. ИЗВЕЩЕНИЕ О ПРОВЕДЕНИИ ЗАПРОСА КОТИРОВОК");
  assert.equal(describeLocation(place), "стр. 2, п. 4.2, раздел «II. ИЗВЕЩЕНИЕ О ПРОВЕДЕНИИ ЗАПРОСА КОТИРОВОК»");
});

test("скан: страница с пометкой; Excel: лист и ячейка", () => {
  const scan = new TextBuilder();
  scan.add("Заявка участника: цена договора 450 000 рублей", { page: 2, ocr: true });
  const s = scan.build();

  const sheet = new TextBuilder();
  sheet.add("## Лист «Смета»", { sheet: "Смета" });
  sheet.raw("\n");
  sheet.add("Бумага А4", { sheet: "Смета", cell: "B2", row: 2, col: 2 });
  sheet.raw(" | ");
  sheet.add("25050", { sheet: "Смета", cell: "C2", row: 2, col: 3 });
  const x = sheet.build();

  const loc = createLocator([
    { name: "Скан.pdf", ...s },
    { name: "Смета.xlsx", ...x },
  ]);
  const a = loc.locate("цена договора 450 000 рублей");
  assert.ok(a);
  assert.equal(describeLocation(a), "стр. 2 (скан)");
  const b = loc.locate("25050");
  assert.equal(b, null, "короче восьми знаков — не цитата");
  const c = loc.at("Смета.xlsx", x.text.indexOf("25050"));
  assert.ok(c);
  assert.equal(describeLocation(c), "лист «Смета», ячейка C2");
  assert.equal(loc.at("Нет такого.pdf", 0), undefined);
});

test("цитата повторяется — показываем первое место и сколько ещё; цитаты нет — null", () => {
  const text = "Срок подачи заявок — до 10 октября.\n\nКак сказано выше: срок подачи заявок — до 10 октября, 10:00.\n\nИтог.";
  const loc = createLocator([{ name: "Извещение.txt", text }]);
  const place = loc.locate("срок подачи заявок — до 10 октября");
  assert.ok(place);
  assert.equal(place.from, 0);
  assert.equal(place.more, 1);
  assert.match(describeSource(place), /· ещё 1 место$/);
  assert.equal(loc.locate("такого в документах нет совсем"), null);
  assert.equal(loc.locate(""), null);
});

test("куски цитаты с многоточием в разных документах: место — по первому куску", () => {
  const loc = createLocator([
    { name: "Извещение.txt", text: "Зал вместимостью не менее 150 мест." },
    { name: "Договор.txt", text: "Срок оказания услуг — пять рабочих дней." },
  ]);
  const place = loc.locate("Зал вместимостью не менее 150 мест ... Срок оказания услуг — пять рабочих дней");
  assert.ok(place);
  assert.equal(place.doc, "Извещение.txt");
});

test("документ без пунктов и заголовков: адрес пустой, а не выдуманный", () => {
  const place = createLocator([{ name: "Заметка.txt", text: "обычная строка без номера и заголовка про услуги" }]).locate("строка без номера и заголовка");
  assert.ok(place);
  assert.equal(describeLocation(place), "");
  assert.equal(describeSource(place), "«Заметка.txt»");
});

test("длинный заголовок раздела в адресе сокращается", () => {
  const long = `Раздел 4. ${"Очень длинное название раздела ".repeat(3)}`.trim();
  const b = new TextBuilder();
  b.add(long, { page: 1, head: true });
  b.raw("\n\n");
  b.add("Текст, который лежит под этим заголовком раздела.", { page: 1 });
  const doc = b.build();
  const place = createLocator([{ name: "Д.docx", ...doc }]).locate("Текст, который лежит под этим заголовком");
  assert.ok(place);
  const text = describeLocation(place);
  assert.match(text, /^стр\. 1, раздел «Раздел 4\. Очень длинное название раздела .+…»$/);
  assert.ok(text.length < 85, text);
});
