// Таблицы и страницы PDF: строки таблицы на своём месте в тексте страницы, продолжение таблицы на следующей странице,
// сканы и сломанная кодировка — npm test. Страницы и таблицы здесь — готовые данные, так же как их отдаёт чтение PDF.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DocSpan } from "./doc-source.ts";
import { assemblePdf, letters, pageQuality, pipeTables, placeTables, type PdfPiece } from "./pdf-structure.ts";

const joined = (pieces: PdfPiece[]) => pieces.map((p) => p.text).join("");

test("страница по буквам: обычная, английская, почти пустая, с испорченной кодировкой", () => {
  assert.equal(pageQuality("Исполнитель обязан обеспечить площадку проведения мероприятия."), "ok");
  assert.equal(pageQuality("The Contractor shall provide the venue for the event."), "ok");
  assert.equal(pageQuality("Таблица 12 3 4 5 6 7 8 9 0\n-- 5 of 12 --"), "blank");
  assert.equal(pageQuality(""), "blank");
  assert.equal(pageQuality("ǻǱǫǹǽǿȀȂȄȆȈȊȌȎȐȒȔȖȘȚȜȞ ǻǱǫǹǽǿȀȂȄȆ ǻǱǫǹǽǿȀȂȄȆȈȊȌ"), "garbled");
  assert.equal(pageQuality("Ελληνικό κείμενο που ένα ρωσικό έγγραφο не должно содержать εδώ"), "garbled");
  assert.equal(pageQuality(" Текст страницы с кодами из частной области "), "garbled");
  assert.equal(pageQuality("Формула мощности: P = α·U·I, где α — коэффициент, β — потери, обязательные для расчёта по ТЗ."), "ok");
  assert.equal(letters("-- 1 of 2 --\nабв"), 3, "метка страницы — не текст");
});

const PAGE = [
  "Приложение 3",
  "Перечень услуг",
  "№",
  "п/п",
  "Наименование",
  "Количество",
  "1",
  "Услуги по разработке",
  "концепции",
  "2",
  "2",
  "Услуги по монтажу оборудования",
  "3",
  "Итого на странице 5",
].join("\n");

const TABLE = [
  ["№\nп/п", "Наименование", "Количество"],
  ["1", "Услуги по разработке\nконцепции", "2"],
  ["2", "Услуги по монтажу оборудования", "3"],
];

test("строки таблицы записываются «а | б | в» на то же место страницы; текст вокруг не меняется", () => {
  const placed = placeTables(PAGE, [TABLE]);
  assert.equal(
    joined(placed.pieces),
    "Приложение 3\nПеречень услуг\n№ п/п | Наименование | Количество\n1 | Услуги по разработке концепции | 2\n2 | Услуги по монтажу оборудования | 3\nИтого на странице 5"
  );
  assert.deepEqual(placed.shapes, [{ cols: 3, rows: 3 }]);
  assert.equal(placed.before, "Приложение 3\nПеречень услуг".replace(/\s/g, " ").trim().length);
  assert.equal(placed.after, "Итого на странице 5".length);
  const cell = placed.pieces.find((p) => p.text === "Услуги по монтажу оборудования");
  assert.deepEqual({ table: cell?.table, row: cell?.row, col: cell?.col }, { table: 1, row: 3, col: 2 });
  assert.ok(placed.pieces.filter((p) => p.raw).every((p) => p.text === " | " || !p.text.trim()), "разделители — без адреса");
});

test("в разметке у края ячейки пропали знаки — в строку попадает полный текст из страницы", () => {
  const page = "Порядок подачи\nЗаявки подаются по адресу в сети «Интернет»:\nhttps://www.example.ru/search/com#login в соответствии с Регламентом\nПодпись";
  // В разметке у ячейки потеряны «т»:».
  const table = [["Заявки подаются по адресу в сети «Интерне", "https://www.example.ru/search/com#login в соответствии с Регламентом"]];
  const placed = placeTables(page, [table]);
  assert.equal(
    joined(placed.pieces),
    "Порядок подачи\nЗаявки подаются по адресу в сети «Интернет»: | https://www.example.ru/search/com#login в соответствии с Регламентом\nПодпись"
  );
});

test("таблица не найдена в тексте страницы, рамка в один столбец, одна непустая ячейка — страница остаётся как была", () => {
  const same = (tables: string[][][]) => {
    const placed = placeTables(PAGE, tables);
    assert.equal(joined(placed.pieces), PAGE);
    assert.deepEqual(placed.shapes, []);
  };
  same([[["Совсем", "другой", "текст"], ["которого", "на странице", "нет"]]]);
  same([[["Приложение 3"], ["Перечень услуг"]]]);
  same([[["Приложение 3", "", ""]]]);
  same([[["", "", ""]]]);
  same([]);
  // Порядок ячеек не как в странице (по столбцам) — не угадываем.
  same([[["Количество", "Наименование", "№"], ["2", "Услуги по монтажу оборудования", "2"]]]);
});

test("часть строк таблицы не нашлась — найденные записываются, остальные остаются текстом; найдено меньше 60% — таблица не засчитывается", () => {
  const some = placeTables(PAGE, [[...TABLE, ["3", "Строки, которой на странице нет", "9"]]]);
  assert.equal(some.shapes.length, 1);
  assert.match(joined(some.pieces), /№ п\/п \| Наименование \| Количество\n1 \| Услуги по разработке концепции \| 2\n2 \| Услуги по монтажу оборудования \| 3\nИтого/);

  const few = placeTables(PAGE, [[TABLE[0], ["8", "Нет такой строки на странице", "1"], ["9", "И такой тоже не будет", "2"], ["10", "И этой нет совсем нигде", "3"]]]);
  assert.deepEqual(few.shapes, []);
  assert.equal(joined(few.pieces), PAGE);
});

test("две таблицы на странице идут по порядку; пустые строки и пустые ячейки в конце не пишутся", () => {
  const page = "Первая таблица\nАльфа\nБета\nВторая таблица\nВега\nГамма\nКонец";
  const placed = placeTables(page, [
    [["Альфа", "Бета", ""], ["", "", ""]],
    [["Вега", "Гамма"]],
  ]);
  assert.equal(joined(placed.pieces), "Первая таблица\nАльфа | Бета\nВторая таблица\nВега | Гамма\nКонец");
  assert.deepEqual(placed.shapes.map((s) => s.cols), [3, 2]);
  assert.deepEqual([...new Set(placed.pieces.map((p) => p.table).filter(Boolean))], [1, 2]);
});

test("страница, прочитанная ИИ со скана: строки «а | б» размечаются как таблицы, остальной текст не меняется", () => {
  const text = "Справка о квалификации\n\n№ | Заказчик | Сумма\n1 | ООО «Ромашка» | 100 000\n2 | ИП Иванов | 50 000\n\nПодпись руководителя\n\n| лишнее | не таблица?";
  const placed = pipeTables(text);
  assert.equal(joined(placed.pieces), text.replace("\n\n| лишнее | не таблица?", "\n\n| лишнее | не таблица?"));
  assert.equal(placed.shapes.length, 2, "последняя строка с «|» — отдельная таблица из одной строки");
  assert.deepEqual(placed.shapes[0], { cols: 3, rows: 3 });
  const cell = placed.pieces.find((p) => p.text === "ИП Иванов");
  assert.deepEqual({ table: cell?.table, row: cell?.row, col: cell?.col }, { table: 1, row: 3, col: 2 });
  assert.equal(placed.before, "Справка о квалификации".length);
  assert.equal(pipeTables("Просто текст без таблиц.").shapes.length, 0);
});

const spansOf = (r: { text: string; map?: { spans: DocSpan[] } }) => (r.map?.spans ?? []).map((s) => ({ ...s, t: r.text.slice(s.from, s.to) }));

test("сборка: метка страницы после текста, как у PDF; страницы без таблиц — текст как был; адрес каждой страницы", () => {
  const r = assemblePdf(
    [
      { num: 1, text: "Первая страница.\n1" },
      { num: 2, text: "Вторая страница.\n2" },
    ],
    2
  );
  assert.equal(r.text, "Первая страница.\n1\n\n-- 1 of 2 --\n\nВторая страница.\n2\n\n-- 2 of 2 --");
  assert.deepEqual(spansOf(r).map((s) => [s.page, s.t]), [
    [1, "Первая страница.\n1\n\n-- 1 of 2 --\n\n"],
    [2, "Вторая страница.\n2\n\n-- 2 of 2 --"],
  ]);
});

const rowsOf = (n: number, from = 1) => Array.from({ length: n }, (_, i) => [String(from + i), `Услуга номер ${from + i} по организации мероприятия`, String((from + i) * 2)]);
const pageOf = (title: string, rows: string[][]) => `${title}\n${rows.map((r) => r.join("\n")).join("\n")}`;

test("таблица идёт с одной страницы на другую с теми же столбцами — это одна таблица: номер тот же, строки считаются дальше", () => {
  const first = rowsOf(3);
  const second = rowsOf(2, 4);
  const r = assemblePdf(
    [
      { num: 1, text: pageOf("Приложение 3", first), tables: [first] },
      { num: 2, text: pageOf("Приложение 3 (продолжение)", second), tables: [second] },
    ],
    2
  );
  const cells = spansOf(r).filter((s) => s.table !== undefined);
  assert.deepEqual([...new Set(cells.map((s) => s.table))], [1]);
  assert.deepEqual(cells.filter((s) => s.col === 2).map((s) => [s.page, s.row]), [
    [1, 1],
    [1, 2],
    [1, 3],
    [2, 4],
    [2, 5],
  ]);
});

test("не продолжение: другое число столбцов, много текста между, страницы не подряд, на странице нет таблицы", () => {
  const rows3 = rowsOf(2);
  const rows2 = rowsOf(2, 3).map((r) => [r[0], r[1]]);
  const tableNos = (pages: Parameters<typeof assemblePdf>[0]) => [...new Set(spansOf(assemblePdf(pages, 9)).filter((s) => s.table !== undefined).map((s) => s.table))];

  assert.deepEqual(tableNos([{ num: 1, text: pageOf("А", rows3), tables: [rows3] }, { num: 2, text: pageOf("Б", rows2), tables: [rows2] }]), [1, 2], "столбцов три и два");
  const long = "Длинный абзац между таблицами. ".repeat(12);
  assert.deepEqual(tableNos([{ num: 1, text: pageOf("А", rows3), tables: [rows3] }, { num: 2, text: `${long}\n${pageOf("Б", rows3)}`, tables: [rows3] }]), [1, 2], "много текста перед таблицей");
  assert.deepEqual(tableNos([{ num: 1, text: `${pageOf("А", rows3)}\n${long}`, tables: [rows3] }, { num: 2, text: pageOf("Б", rows3), tables: [rows3] }]), [1, 2], "много текста после таблицы");
  assert.deepEqual(tableNos([{ num: 1, text: pageOf("А", rows3), tables: [rows3] }, { num: 3, text: pageOf("Б", rows3), tables: [rows3] }]), [1, 2], "страницы не подряд");
  assert.deepEqual(
    tableNos([{ num: 1, text: pageOf("А", rows3), tables: [rows3] }, { num: 2, text: "Страница без таблицы" }, { num: 3, text: pageOf("Б", rows3), tables: [rows3] }]),
    [1, 2],
    "между ними страница без таблицы"
  );
});

test("страница со сканом: пометка «скан» у каждого куска; таблица на ней размечается по «|»; номер страницы и метка — как у остальных", () => {
  const r = assemblePdf(
    [
      { num: 1, text: "Обычная страница." },
      { num: 2, text: "Справка\n\n№ | Заказчик\n1 | ООО «Ромашка»\n\nПодпись", ocr: true },
    ],
    2
  );
  const spans = spansOf(r);
  assert.ok(spans.filter((s) => s.page === 2).every((s) => s.ocr === true));
  assert.ok(spans.filter((s) => s.page === 1).every((s) => s.ocr === undefined));
  const cell = spans.find((s) => s.t === "ООО «Ромашка»");
  assert.deepEqual({ page: cell?.page, table: cell?.table, row: cell?.row, col: cell?.col }, { page: 2, table: 1, row: 2, col: 2 });
  assert.match(r.text, /№ \| Заказчик\n1 \| ООО «Ромашка»/);
  assert.match(r.text, /-- 2 of 2 --$/);
});

test("строки таблицы считаются по тексту: пустые строки разметки не в счёт; шапка, повторённая на следующей странице, — не новая строка", () => {
  const head = ["№", "Наименование услуги", "Количество"];
  const first = [head, ["1", "Услуга номер 1 по организации", "2"], ["2", "Услуга номер 2 по организации", "4"]];
  // Разметка второй страницы начинается с пустой строки — это край страницы; потом повторённая шапка.
  const second = [["", "", ""], head, ["3", "Услуга номер 3 по организации", "6"], ["4", "Услуга номер 4 по организации", "8"]];
  const textOf = (rows: string[][]) => rows.filter((r) => r.some(Boolean)).map((r) => r.join("\n")).join("\n");
  const r = assemblePdf(
    [
      { num: 1, text: textOf(first), tables: [first] },
      { num: 2, text: textOf(second), tables: [second] },
    ],
    2
  );
  assert.deepEqual(
    spansOf(r).filter((s) => s.col === 2).map((s) => [s.page, s.row, s.t]),
    [
      [1, 1, "Наименование услуги"],
      [1, 2, "Услуга номер 1 по организации"],
      [1, 3, "Услуга номер 2 по организации"],
      [2, 1, "Наименование услуги"],
      [2, 4, "Услуга номер 3 по организации"],
      [2, 5, "Услуга номер 4 по организации"],
    ]
  );
  assert.deepEqual([...new Set(spansOf(r).map((s) => s.table).filter(Boolean))], [1]);
});

test("страница без шапки на продолжении: строки идут дальше, а не с единицы", () => {
  const first = rowsOf(3);
  const second = rowsOf(2, 4);
  const r = assemblePdf(
    [
      { num: 1, text: pageOf("Заголовок", first), tables: [first] },
      { num: 2, text: pageOf("Заголовок", second), tables: [second] },
    ],
    2
  );
  assert.deepEqual(spansOf(r).filter((s) => s.col === 1 && s.table).map((s) => s.row), [1, 2, 3, 4, 5]);
});
