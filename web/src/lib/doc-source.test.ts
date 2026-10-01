// Карта документа: сборка текста с адресами кусков, поиск куска по позиции, пункты и заголовки по виду строк — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { clauseBefore, headingBefore, lineHeading, MAX_SPANS, pagesFromMarkers, spanAt, spanIndexAt, summaryOf, TextBuilder } from "./doc-source.ts";

test("сборка: абзацы одной страницы — один кусок, ячейки и заголовки — каждый свой; разделители без адреса", () => {
  const b = new TextBuilder();
  b.add("Приложение 2", { page: 1, head: true });
  b.raw("\n\n");
  b.add("Первый абзац.", { page: 1 });
  b.raw("\n\n");
  b.add("Второй абзац.", { page: 1 });
  b.raw("\n\n");
  b.add("Третий абзац на другой странице.", { page: 2 });
  b.raw("\n\n");
  b.add("№", { page: 2, table: 1, row: 1, col: 1 });
  b.raw(" | ");
  b.add("Название", { page: 2, table: 1, row: 1, col: 2 });
  const { text, map } = b.build();
  assert.equal(text, "Приложение 2\n\nПервый абзац.\n\nВторой абзац.\n\nТретий абзац на другой странице.\n\n№ | Название");
  assert.ok(map);
  assert.deepEqual(map.spans, [
    { from: 0, to: 12, page: 1, head: true },
    { from: 14, to: 42, page: 1 },
    { from: 44, to: 76, page: 2 },
    { from: 78, to: 79, page: 2, table: 1, row: 1, col: 1 },
    { from: 82, to: 90, page: 2, table: 1, row: 1, col: 2 },
  ]);
  assert.equal(text.slice(14, 42), "Первый абзац.\n\nВторой абзац.");
});

test("пробелы в конце текста отбрасываются, карта не вылезает за текст; пустые куски не добавляются", () => {
  const b = new TextBuilder();
  b.add("Текст.", { page: 1 });
  b.add("", { page: 9 });
  b.raw("\n\n  ");
  const { text, map } = b.build();
  assert.equal(text, "Текст.");
  assert.deepEqual(map?.spans, [{ from: 0, to: 6, page: 1 }]);
  assert.equal(b.length, 10);
});

test("карты нет, если из неё нечего узнать: простой текст без страниц, таблиц и заголовков", () => {
  const b = new TextBuilder();
  b.add("Просто абзац.");
  b.raw("\n\n");
  b.add("Ещё абзац.");
  assert.deepEqual(b.build(), { text: "Просто абзац.\n\nЕщё абзац." });
});

test("у страниц Word пометка «примерно»", () => {
  const b = new TextBuilder();
  b.add("Текст.", { page: 3 });
  assert.deepEqual(b.build(true).map, { spans: [{ from: 0, to: 6, page: 3 }], pagesApprox: true });
  assert.deepEqual(b.build(false).map, { spans: [{ from: 0, to: 6, page: 3 }] });
});

test("после предела кусков остальной текст сливается в последний — карта не растёт без конца", () => {
  const b = new TextBuilder();
  for (let i = 0; i < MAX_SPANS + 500; i++) {
    b.add("я", { table: 1, row: i + 1, col: 1 });
    b.raw("\n");
  }
  const { text, map } = b.build();
  assert.equal(map?.spans.length, MAX_SPANS);
  assert.equal(map?.spans.at(-1)?.to, text.length);
});

test("кусок по позиции: двоичный поиск, начало, середина, зазор между кусками, за концом", () => {
  const spans = [
    { from: 0, to: 10, page: 1 },
    { from: 12, to: 20, page: 2 },
    { from: 22, to: 30, page: 3 },
  ];
  assert.equal(spanIndexAt(spans, 0), 0);
  assert.equal(spanIndexAt(spans, 9), 0);
  assert.equal(spanIndexAt(spans, 11), 0, "зазор — относится к предыдущему куску");
  assert.equal(spanIndexAt(spans, 12), 1);
  assert.equal(spanIndexAt(spans, 99), 2);
  assert.equal(spanIndexAt([], 5), -1);
  assert.equal(spanIndexAt([{ from: 5, to: 8 }], 2), -1);
  assert.equal(spanAt({ spans }, 25)?.page, 3);
  assert.equal(spanAt(undefined, 25), undefined);
});

test("страницы PDF — по меткам «-- 5 of 12 --» в тексте: так читаются документы, сохранённые до карты", () => {
  const text = "Первая страница.\n\n-- 1 of 3 --\n\nВторая страница.\n\n-- 2 of 3 --\n\nТретья.\n\n-- 3 of 3 --\n\n";
  const map = pagesFromMarkers(text);
  assert.ok(map);
  assert.deepEqual(map.spans.map((s) => s.page), [1, 2, 3]);
  assert.equal(spanAt(map, text.indexOf("Вторая"))?.page, 2);
  assert.equal(spanAt(map, text.indexOf("Третья"))?.page, 3);
  assert.equal(pagesFromMarkers("Без меток страниц."), undefined);
});

test("заголовок раздела: слово и номер, римская цифра, строка из заглавных; пункты и обычные строки — нет", () => {
  for (const yes of [
    "Раздел 4. Требования к заявке",
    "Приложение № 1 к Техническому заданию",
    "Приложение 3",
    "Форма 3. СПРАВКА О КВАЛИФИКАЦИИ УЧАСТНИКА ЗАКУПКИ",
    "Статья 43. Содержание заявки",
    "II. ИЗВЕЩЕНИЕ О ПРОВЕДЕНИИ ЗАПРОСА КОТИРОВОК",
    "I. Общие положения",
    "ТЕХНИЧЕСКОЕ ЗАДАНИЕ",
  ]) {
    assert.equal(lineHeading(yes), true, yes);
  }
  for (const no of [
    "1.1. Заказчик — Государственное бюджетное учреждение культуры города Москвы",
    "1. Исполнитель обязан обеспечить площадку",
    "Форма заявки приведена в приложении",
    "Часть 2 статьи 43 предусматривает следующий порядок рассмотрения заявок участников закупки.",
    "Зал вместимостью не менее 150 мест",
    "ООО",
    "№ | Название | Количество",
    "-- 5 of 12 --",
    "Н а и м е н о в а н и е З а к а з ч и к а",
    "",
    "А".repeat(200),
  ]) {
    assert.equal(lineHeading(no), false, no);
  }
});

test("пункт: многоуровневый номер, номер с точкой или скобкой; даты, время и количества — не пункты", () => {
  const text = "2.4.1. Исполнитель обязан\nобеспечить площадку\nс гардеробом.";
  assert.equal(clauseBefore(text, text.indexOf("гардеробом")), "2.4.1");
  assert.equal(clauseBefore("5. Условия оплаты\nпо факту", 20), "5");
  assert.equal(clauseBefore("3) Срок оказания услуг\nпять дней", 25), "3");
  assert.equal(clauseBefore("12.08.2026 рассмотрение заявок\nкомиссией", 35), undefined);
  assert.equal(clauseBefore("14 ноября 2026 г. проведение", 20), undefined);
  assert.equal(clauseBefore("150 мест в зале", 5), undefined);
  assert.equal(clauseBefore("1.2. Предмет\nстрока 2\nстрока 3", 0), "1.2", "место — в самой строке с номером");
  assert.equal(clauseBefore("", 0), undefined);
});

test("пункт ищется не дальше пятнадцати строк вверх: дальний номер к месту уже не относится", () => {
  const text = `2.4.1. Начало пункта\n${"строка текста\n".repeat(20)}конец`;
  assert.equal(clauseBefore(text, text.length - 1), undefined);
  const near = `2.4.1. Начало пункта\n${"строка текста\n".repeat(10)}конец`;
  assert.equal(clauseBefore(near, near.length - 1), "2.4.1");
});

test("заголовок по виду строк: ближайший выше; нет заголовка — ничего; граница текста не зацикливает поиск", () => {
  const text = "ТЕХНИЧЕСКОЕ ЗАДАНИЕ\n\nОбщие слова.\n\nРаздел 4. Требования к заявке\n\n4.1. Заявка должна содержать документы.\n";
  assert.equal(headingBefore(text, text.indexOf("Заявка должна")), "Раздел 4. Требования к заявке");
  assert.equal(headingBefore(text, text.indexOf("Общие")), "ТЕХНИЧЕСКОЕ ЗАДАНИЕ");
  assert.equal(headingBefore("обычный текст\nещё строка", 20), undefined);
  assert.equal(headingBefore("\n\n\nтекст", 5), undefined);
  assert.equal(headingBefore("", 0), undefined);
});

test("что видно о файле: страницы, таблицы, листы, страницы со скана; нет карты — нули", () => {
  const b = new TextBuilder();
  b.add("Текст", { page: 1 });
  b.add("а", { page: 2, table: 1, row: 1, col: 1 });
  b.add("б", { page: 3, table: 1, row: 2, col: 1 });
  b.add("в", { page: 3, table: 2, row: 1, col: 1 });
  b.add("скан", { page: 4, ocr: true });
  assert.deepEqual(summaryOf(b.build(true).map), { pages: 4, tables: 2, sheets: 0, scanPages: 1, approx: true });

  const x = new TextBuilder();
  x.add("Лист", { sheet: "Смета" });
  x.add("ячейка", { sheet: "Смета", cell: "A1" });
  x.add("ячейка", { sheet: "Итоги", cell: "A1" });
  assert.deepEqual(summaryOf(x.build().map), { pages: 0, tables: 0, sheets: 2, scanPages: 0, approx: false });
  assert.deepEqual(summaryOf(undefined), { pages: 0, tables: 0, sheets: 0, scanPages: 0, approx: false });
});
