// Чтение Word напрямую из файла: абзацы, таблицы, нумерация пунктов, страницы, надписи, сноски — npm test.
// Файлы .docx собираются тут же из XML: настоящих документов в репозитории для тестов не нужно.
import assert from "node:assert/strict";
import { test } from "node:test";
import { strToU8, zipSync } from "fflate";
import mammoth from "mammoth";
import type { DocMap } from "./doc-source.ts";
import { DocxError, readDocx } from "./docx-reader.ts";
import { abstract, c, cell, docx, HEAD, lvl, NS, num, numbering, numInstance, p, para, run, style, styles, tbl, tr, type Parts } from "./docx-fixtures.ts";

const read = (parts: Parts) => readDocx(docx(parts));
const pieces = (r: { text: string; map?: DocMap }) => (r.map?.spans ?? []).map((s) => [r.text.slice(s.from, s.to), s]);

test("абзацы: пустые пропускаются, текст через «\\n\\n»; спецзнаки, вставки и удаления, ссылки, поля", () => {
  const r = read({
    body:
      p("Первый абзац.") +
      p("") +
      para(run("Второй & «абзац» <тут>")) +
      para(`<w:r><w:t>а</w:t><w:tab/><w:t>б</w:t><w:br/><w:t>в</w:t></w:r>`) +
      para(`<w:ins w:id="1"><w:r><w:t>вставлено</w:t></w:r></w:ins><w:del w:id="2"><w:r><w:delText>удалено</w:delText></w:r></w:del><w:r><w:t xml:space="preserve"> и </w:t></w:r><w:hyperlink><w:r><w:t>ссылка</w:t></w:r></w:hyperlink>`) +
      para(`<w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:t>после поля</w:t></w:r><w:r><w:noBreakHyphen/><w:t>х</w:t></w:r>`),
  });
  assert.equal(r.text, "Первый абзац.\n\nВторой & «абзац» <тут>\n\nа\tб\nв\n\nвставлено и ссылка\n\nпосле поля-х");
  assert.equal(r.map, undefined, "ни страниц, ни таблиц, ни заголовков — карта не нужна");
  assert.equal(r.stats.pages, 0);
});

test("нумерация пунктов: многоуровневая, счётчики идут сквозь обычные абзацы; маркеры без номера", () => {
  const r = read({
    numbering: numbering(
      abstract(0, lvl(0, "decimal", "%1."), lvl(1, "decimal", "%1.%2."), lvl(2, "decimal", "%1.%2.%3.")),
      abstract(1, lvl(0, "bullet", "•")),
      numInstance(1, 0),
      numInstance(2, 1)
    ),
    body:
      p("Общие положения", num(1, 0)) +
      p("Предмет", num(1, 1)) +
      p("Цена", num(1, 1)) +
      p("Детали цены", num(1, 2)) +
      p("Без номера") +
      p("Сроки", num(1, 0)) +
      p("Начало", num(1, 1)) +
      p("Маркер", num(2, 0)),
  });
  assert.equal(r.text, "1. Общие положения\n\n1.1. Предмет\n\n1.2. Цена\n\n1.2.1. Детали цены\n\nБез номера\n\n2. Сроки\n\n2.1. Начало\n\nМаркер");
});

test("нумерация: другой экземпляр того же списка продолжает счёт, «начать с» — начинает заново; буквы, римские, русские", () => {
  const r = read({
    numbering: numbering(
      abstract(0, lvl(0, "decimal", "%1."), lvl(1, "decimal", "%1.%2.")),
      abstract(1, lvl(0, "lowerLetter", "%1)")),
      abstract(2, lvl(0, "upperRoman", "%1.")),
      abstract(3, lvl(0, "russianLower", "%1)")),
      numInstance(1, 0),
      numInstance(2, 0),
      numInstance(3, 1),
      numInstance(4, 2),
      numInstance(5, 3),
      numInstance(6, 0, `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride>`)
    ),
    body:
      p("Один", num(1)) +
      p("Два", num(1)) +
      p("Три в другом экземпляре", num(2)) +
      p("а", num(3)) +
      p("б", num(3)) +
      p("римская", num(4)) +
      p("римская", num(4)) +
      p("в", num(5)) +
      p("г", num(5)) +
      p("Заново", num(6)) +
      p("Его подпункт", num(6, 1)),
  });
  assert.deepEqual(r.text.split("\n\n"), [
    "1. Один",
    "2. Два",
    "3. Три в другом экземпляре",
    "a) а",
    "b) б",
    "I. римская",
    "II. римская",
    "а) в",
    "б) г",
    "1. Заново",
    "1.1. Его подпункт",
  ]);
});

test("нумерация: юридическая (isLgl) пишет все уровни числами; «не сбрасывать» (lvlRestart 0) оставляет счёт", () => {
  const legal = read({
    numbering: numbering(abstract(0, lvl(0, "upperRoman", "%1."), lvl(1, "decimal", "%1.%2", "<w:isLgl/>")), numInstance(1, 0)),
    body: p("Раздел", num(1)) + p("Раздел", num(1)) + p("Пункт", num(1, 1)),
  });
  assert.deepEqual(legal.text.split("\n\n"), ["I. Раздел", "II. Раздел", "2.1 Пункт"]);

  const keep = read({
    numbering: numbering(abstract(0, lvl(0, "decimal", "%1."), lvl(1, "decimal", "%2.", `<w:lvlRestart w:val="0"/>`)), numInstance(1, 0)),
    body: p("А", num(1)) + p("а1", num(1, 1)) + p("а2", num(1, 1)) + p("Б", num(1)) + p("б3", num(1, 1)),
  });
  assert.deepEqual(keep.text.split("\n\n"), ["1. А", "1. а1", "2. а2", "2. Б", "3. б3"]);
});

test("нумерация в стиле: заголовки получают номера, уровень берётся из привязки стиля к списку; заголовки отмечены в карте", () => {
  const r = read({
    styles: styles(
      style("1", "heading 1", `<w:numPr><w:numId w:val="1"/></w:numPr><w:outlineLvl w:val="0"/>`),
      style("2", "heading 2", "", "1"),
      style("3", "Заголовок 3", "")
    ),
    numbering: numbering(abstract(0, lvl(0, "decimal", "%1.", `<w:pStyle w:val="1"/>`), lvl(1, "decimal", "%1.%2.", `<w:pStyle w:val="2"/>`)), numInstance(1, 0)),
    body:
      p("Требования", `<w:pStyle w:val="1"/>`) +
      p("Обычный абзац под заголовком.") +
      p("К товару", `<w:pStyle w:val="2"/>`) +
      p("Ещё одно требование", `<w:pStyle w:val="1"/>`) +
      p("Без номера, но заголовок", `<w:pStyle w:val="3"/>`),
  });
  assert.equal(r.text, "1. Требования\n\nОбычный абзац под заголовком.\n\n1.1. К товару\n\n2. Ещё одно требование\n\nБез номера, но заголовок");
  assert.deepEqual(
    pieces(r).filter(([, s]) => (s as { head?: true }).head).map(([t]) => t),
    ["1. Требования", "1.1. К товару", "2. Ещё одно требование", "Без номера, но заголовок"]
  );
});

test("заголовок по уровню структуры и по полужирному набору; жирное слово, двоеточие, восклицание — не заголовок", () => {
  const r = read({
    styles: styles(style("Plain", "Обычный", "")),
    body:
      p("Уровень структуры", `<w:outlineLvl w:val="1"/>`) +
      p("Полужирная строка заголовка", "", true) +
      p("Внимание!", "", true) +
      p("Заказчик:", "", true) +
      p("Слово", "", true) +
      para(run("Часть жирная, ", true) + run("часть нет")) +
      p("Обычный абзац.", `<w:pStyle w:val="Plain"/>`),
  });
  assert.deepEqual(
    pieces(r).filter(([, s]) => (s as { head?: true }).head).map(([t]) => t),
    ["Уровень структуры", "Полужирная строка заголовка"]
  );
});

test("таблицы: строки с « | », объединения по горизонтали и вертикали, пустые ячейки и строки, адрес каждой ячейки", () => {
  const r = read({
    body:
      p("Перед таблицей") +
      tbl(
        tr(c("№"), c("Наименование"), c("Кол-во")),
        tr(c("1"), c("Бумага А4"), c("100")),
        tr(c("2"), cell(p("Ручки") + p("шариковые")), c("50")),
        tr(c("Итого", `<w:gridSpan w:val="2"/>`), c("150")),
        tr(c("Группа", `<w:vMerge w:val="restart"/>`), c("Папки"), c("10")),
        tr(c("", `<w:vMerge/>`), c("Скрепки"), c("20")),
        tr(c(""), c(""), c("")),
        tr(c("Последняя"), c(""), c("5")),
        tr(c("Только первая"), c(""), c(""))
      ) +
      p("После таблицы"),
  });
  assert.equal(
    r.text,
    "Перед таблицей\n\n№ | Наименование | Кол-во\n1 | Бумага А4 | 100\n2 | Ручки шариковые | 50\nИтого | 150\nГруппа | Папки | 10\n | Скрепки | 20\nПоследняя |  | 5\nТолько первая\n\nПосле таблицы"
  );
  const cellOf = (text: string) => {
    const s = pieces(r).find(([t]) => t === text)?.[1] as { table?: number; row?: number; col?: number } | undefined;
    return s && { table: s.table, row: s.row, col: s.col };
  };
  assert.deepEqual(cellOf("Наименование"), { table: 1, row: 1, col: 2 });
  assert.deepEqual(cellOf("Ручки шариковые"), { table: 1, row: 3, col: 2 });
  assert.deepEqual(cellOf("150"), { table: 1, row: 4, col: 3 }, "объединённая ячейка заняла два столбца");
  assert.deepEqual(cellOf("Скрепки"), { table: 1, row: 6, col: 2 });
  assert.deepEqual(cellOf("5"), { table: 1, row: 8, col: 3 }, "пустая строка 7 пропущена, но номера строк как в документе");
  assert.equal(r.stats.tables, 1);
});

test("несколько таблиц нумеруются по порядку; вложенная таблица и номер пункта читаются как текст ячейки", () => {
  const r = read({
    numbering: numbering(abstract(0, lvl(0, "decimal", "%1.")), numInstance(1, 0)),
    body:
      tbl(tr(c("Первая"), c("таблица"))) +
      p("Между таблицами") +
      tbl(tr(cell(p("Пункт в ячейке", num(1))), cell(p("Внешний") + tbl(tr(c("вложенная"), c("ячейка")))))),
  });
  assert.equal(r.text, "Первая | таблица\n\nМежду таблицами\n\n1. Пункт в ячейке | Внешний вложенная ячейка");
  const tables = new Set(pieces(r).map(([, s]) => (s as { table?: number }).table).filter(Boolean));
  assert.deepEqual([...tables], [1, 2]);
});

test("номер без текста сохраняется: номера строк таблицы Word ставит сам, а ячейка пуста", () => {
  const r = read({
    numbering: numbering(abstract(0, lvl(0, "decimal", "%1.")), numInstance(1, 0)),
    body:
      tbl(tr(c("№"), c("Наименование")), tr(cell(para("", num(1))), c("Бумага")), tr(cell(para("", num(1))), c("Ручки"))) +
      para("", num(1)) +
      p("Текст после."),
  });
  assert.equal(r.text, "№ | Наименование\n1. | Бумага\n2. | Ручки\n\n3.\n\nТекст после.");
});

test("страницы по разметке Word: каждая новая страница, в том числе посреди абзаца; пометка «примерно»", () => {
  const r = read({
    body:
      p("Страница один") +
      `<w:p><w:r><w:lastRenderedPageBreak/><w:t>Страница два</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t xml:space="preserve">Начало на второй, </w:t></w:r><w:r><w:lastRenderedPageBreak/><w:t>конец на третьей.</w:t></w:r></w:p>`,
  });
  assert.equal(r.text, "Страница один\n\nСтраница два\n\nНачало на второй, конец на третьей.");
  assert.deepEqual(pieces(r).map(([t, s]) => [t, (s as { page?: number }).page]), [
    ["Страница один", 1],
    ["Страница два\n\nНачало на второй, ", 2],
    ["конец на третьей.", 3],
  ]);
  assert.equal(r.map?.pagesApprox, true);
  assert.equal(r.stats.pages, 3);
});

test("страницы без разметки Word: явные разрывы страниц, «с новой страницы» и разделы; непрерывный раздел страницу не меняет", () => {
  const r = read({
    body:
      p("A") +
      `<w:p><w:r><w:br w:type="page"/><w:t>B</w:t></w:r></w:p>` +
      p("C", "<w:pageBreakBefore/>") +
      p("D", `<w:sectPr><w:type w:val="nextPage"/></w:sectPr>`) +
      p("E") +
      p("F", `<w:sectPr><w:type w:val="continuous"/></w:sectPr>`) +
      p("G") +
      "<w:sectPr/>",
  });
  assert.deepEqual(pieces(r).map(([t, s]) => [t, (s as { page?: number }).page]), [
    ["A", 1],
    ["B", 2],
    ["C\n\nD", 3],
    ["E\n\nF\n\nG", 4],
  ]);
});

test("разметка Word главнее явных разрывов: разрыв и отметка Word на одном месте — одна новая страница, а не две", () => {
  const r = read({
    body: p("A") + `<w:p><w:r><w:br w:type="page"/></w:r><w:r><w:lastRenderedPageBreak/><w:t>B</w:t></w:r></w:p>`,
  });
  assert.deepEqual(pieces(r).map(([t, s]) => [t, (s as { page?: number }).page]), [
    ["A", 1],
    ["B", 2],
  ]);
});

test("документ без разрывов страниц: страницы не выдумываются, а таблицы всё равно имеют адрес", () => {
  const r = read({ body: tbl(tr(c("а"), c("б"))) });
  assert.equal(r.stats.pages, 0);
  assert.ok(r.map);
  assert.equal(r.map.pagesApprox, undefined);
  assert.ok(r.map.spans.every((s) => s.page === undefined));
});

test("надписи: текст читается один раз (у Word он записан дважды), после абзаца с якорем; надпись только в старой разметке — тоже", () => {
  const box = (text: string) => `<w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:txbxContent>`;
  const r = read({
    body:
      para(
        `<w:r><w:t>Перед надписью</w:t></w:r><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor><a:graphic><a:graphicData><wps:wsp><wps:txbx>${box("Текст надписи")}</wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice>` +
          `<mc:Fallback><w:pict><v:shape><v:textbox>${box("Текст надписи")}</v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r>`
      ) + para(`<w:r><w:pict><v:shape><v:textbox>${box("Только старая разметка")}</v:textbox></v:shape></w:pict></w:r>`),
  });
  assert.equal(r.text, "Перед надписью\n\nТекст надписи\n\nТолько старая разметка");
});

test("сноски — в конце под заголовком «Сноски»; служебные сноски Word пропускаются", () => {
  const note = (id: number, text: string, type = "") => `<w:footnote ${type ? `w:type="${type}" ` : ""}w:id="${id}"><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:footnote>`;
  const r = read({
    body: p("Текст со сноской."),
    footnotes: `${HEAD}<w:footnotes ${NS}>${note(-1, "—", "separator")}${note(0, "—", "continuationSeparator")}${note(1, "Первая сноска.")}${note(2, "Вторая сноска.")}</w:footnotes>`,
  });
  assert.equal(r.text, "Текст со сноской.\n\nСноски\n\n1. Первая сноска.\n\n2. Вторая сноска.");
  assert.deepEqual(
    pieces(r).filter(([, s]) => (s as { head?: true }).head).map(([t]) => t),
    ["Сноски"]
  );
});

test("содержимое элементов управления (sdt) читается и в блоках, и внутри абзаца", () => {
  const r = read({
    body: `<w:sdt><w:sdtContent>${p("В блоке")}</w:sdtContent></w:sdt>` + para(`<w:sdt><w:sdtContent><w:r><w:t>внутри абзаца</w:t></w:r></w:sdtContent></w:sdt>`),
  });
  assert.equal(r.text, "В блоке\n\nвнутри абзаца");
});

test("слова те же, что у прежнего чтения: ничего из обычного текста, таблиц и списков не потеряно", async () => {
  const buffer = docx({
    numbering: numbering(abstract(0, lvl(0, "decimal", "%1.")), numInstance(1, 0)),
    body:
      p("Техническое задание на оказание услуг", "", true) +
      p("Исполнитель обязан обеспечить площадку вместимостью не менее 150 мест.", num(1)) +
      p("Ведущий — с опытом не менее 3 лет.", num(1)) +
      tbl(tr(c("Показатель"), c("Значение")), tr(c("Звук"), c("не менее 4 кВт")), tr(c("Экран"), c("3×2 м"))) +
      p("Срок оказания услуг — пять рабочих дней со дня заключения договора."),
  });
  const old = (await mammoth.extractRawText({ buffer: Buffer.from(buffer) })).value;
  const ours = readDocx(buffer).text;
  const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu));
  const have = words(ours);
  for (const w of words(old)) assert.ok(have.has(w), `потеряно слово «${w}»`);
});

test("не вся разметка прочитана — ошибка: файл тогда читается прежним способом", () => {
  const mystery = `<w:mystery>${run("Текст, который лежит в незнакомой обёртке и нашему чтению не виден, а его много. ".repeat(10))}</w:mystery>`;
  assert.throws(() => read({ body: p("Видимый абзац.") + mystery }), (e) => e instanceof DocxError && /не вся разметка/.test(e.message));
});

test("не Word, без документа, сломанный XML — понятная ошибка, а не падение", () => {
  assert.throws(() => readDocx(new Uint8Array([1, 2, 3, 4, 5])), (e) => e instanceof DocxError && /не архив/.test(e.message));
  assert.throws(() => readDocx(zipSync({ "word/other.xml": strToU8("<a/>") })), (e) => e instanceof DocxError && /нет word\/document\.xml/.test(e.message));
  assert.throws(() => readDocx(zipSync({ "word/document.xml": strToU8("<w:document><w:body><w:p></w:document>") })), (e) => e instanceof DocxError && /разбор документа не удался/.test(e.message));
  assert.throws(() => readDocx(zipSync({ "word/document.xml": strToU8(`<w:document ${NS}></w:document>`) })), (e) => e instanceof DocxError && /нет тела/.test(e.message));
});

test("большой документ читается быстро: тысячи абзацев и сотни строк таблицы", () => {
  const rows = Array.from({ length: 500 }, (_, i) => tr(c(String(i + 1)), c("Наименование товара"), c("100")));
  const body = Array.from({ length: 5000 }, (_, i) => p(`Абзац номер ${i + 1}: исполнитель обязан обеспечить площадку.`)).join("") + tbl(...rows);
  const started = performance.now();
  const r = read({ body });
  assert.ok(r.text.includes("Абзац номер 5000"));
  assert.equal(r.stats.tables, 1);
  assert.ok(performance.now() - started < 4000, `${Math.round(performance.now() - started)} мс`);
});
