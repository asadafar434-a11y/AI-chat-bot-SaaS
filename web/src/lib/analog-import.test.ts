// Загрузка цен-аналогов из таблицы: чтение вставленного текста и файла, определение столбцов, цены, даты, источники, повторы — npm test (без сети).
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRows, decodeText, eisSearchUrl, guessRoles, MAX_IMPORT, parseDateCell, parseMoney, parseTable, toAnalogs } from "./analog-import.ts";
import { computeRic, DEFAULT_SETTINGS, type RicData } from "./indicative-price.ts";
import { CONTRACT_PRICE_REASON } from "./price-basis.ts";

const NOW = new Date("2026-10-22T12:00:00Z");

// Таблица в духе выгрузки реестра контрактов: заголовки, реестровые номера, цены за единицу, даты.
const EIS = [
  "Реестровый номер контракта\tПредмет контракта\tДата заключения\tЦена за единицу, руб.\tКоличество\tЦена контракта",
  "1660100000126000012\tУголь каменный ДПК\t15.09.2026\t9 850,00\t120\t1 182 000,00",
  "1660100000126000034\tУголь каменный ДПК\t02.10.2026\t10 120,50\t80\t809 640,00",
  "1660100000126000051\tУголь каменный ДПК\t2026-10-05\t9 700\t200\t1 940 000,00",
].join("\n");

test("таблица: табуляция (из ЕИС и Excel), «;» (CSV из Excel), «|» (из текста документа) — читаются; пустые строки пропускаются", () => {
  assert.deepEqual(parseTable("а\tб\tв\n\n1\t2\t3\n"), [["а", "б", "в"], ["1", "2", "3"]]);
  assert.deepEqual(parseTable("а;б;в\n1;2;3"), [["а", "б", "в"], ["1", "2", "3"]]);
  assert.deepEqual(parseTable("| а | б |\n| 1 | 2 |"), [["а", "б"], ["1", "2"]]);
  assert.deepEqual(parseTable(""), []);
  assert.deepEqual(parseTable("﻿цена;дата\n5;6"), [["цена", "дата"], ["5", "6"]]);
});

test("таблица: поля в кавычках с разделителем внутри и удвоенной кавычкой; запятая — только если в первой строке заголовки", () => {
  assert.deepEqual(parseTable('товар;цена\n"Уголь; ДПК ""Мария""";9850'), [["товар", "цена"], ['Уголь; ДПК "Мария"', "9850"]]);
  assert.deepEqual(parseTable("наименование,цена,дата\nУголь,9850,15.09.2026"), [["наименование", "цена", "дата"], ["Уголь", "9850", "15.09.2026"]]);
  // Без заголовков запятая — это десятичная запятая в числе, а не разделитель.
  assert.deepEqual(parseTable("9 850,50"), [["9 850,50"]]);
});

test("файл: UTF-8 и windows-1251 (так Excel сохраняет CSV по-русски) читаются без «кракозябр»", () => {
  const utf8 = new TextEncoder().encode("цена;дата\n9850;15.09.2026");
  assert.equal(decodeText(utf8.buffer.slice(utf8.byteOffset, utf8.byteOffset + utf8.byteLength) as ArrayBuffer), "цена;дата\n9850;15.09.2026");
  // «цена» в windows-1251: ц=0xF6 е=0xE5 н=0xED а=0xE0
  const cp = new Uint8Array([0xf6, 0xe5, 0xed, 0xe0, 0x3b, 0x31]);
  assert.equal(decodeText(cp.buffer), "цена;1");
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, 0xd1, 0x86]);
  assert.equal(decodeText(bom.buffer), "ц");
});

test("цена: пробелы и запятая, знак рубля, «руб.»; нуль, минус и не число — null", () => {
  assert.equal(parseMoney("9 850,00"), 9850);
  assert.equal(parseMoney("1250.5"), 1250.5);
  assert.equal(parseMoney("1 250,50 ₽"), 1250.5);
  assert.equal(parseMoney("700 руб."), 700);
  assert.equal(parseMoney("0"), null);
  assert.equal(parseMoney("-5"), null);
  assert.equal(parseMoney("договорная"), null);
  assert.equal(parseMoney(""), null);
});

test("дата: ДД.ММ.ГГГГ, ДД.ММ.ГГ, ДД/ММ/ГГГГ, ГГГГ-ММ-ДД, с временем; несуществующая и не дата — null", () => {
  assert.equal(parseDateCell("15.09.2026"), "2026-09-15");
  assert.equal(parseDateCell("5.9.26"), "2026-09-05");
  assert.equal(parseDateCell("15/09/2026"), "2026-09-15");
  assert.equal(parseDateCell("2026-09-15"), "2026-09-15");
  assert.equal(parseDateCell("15.09.2026 10:30"), "2026-09-15");
  assert.equal(parseDateCell("2026-09-15T10:00:00"), "2026-09-15");
  assert.equal(parseDateCell("31.02.2026"), null);
  assert.equal(parseDateCell("осень"), null);
  assert.equal(parseDateCell(""), null);
});

test("столбцы: по заголовкам выгрузки — цена за единицу, а не цена контракта; номер контракта — источник, а не имя; предмет — наименование", () => {
  const rows = parseTable(EIS);
  const g = guessRoles(rows);
  assert.equal(g.hasHeader, true);
  assert.deepEqual(g.roles, ["source", "name", "date", "price", "qty", "total"]);
});

test("столбцы: «Наименование контракта» — имя, «Номер контракта» — источник; без цены за единицу сумма делится на количество", () => {
  const g = guessRoles(parseTable("Номер контракта;Наименование контракта;Дата подписания;Сумма;Количество\n1;Уголь;15.09.2026;1000;10"));
  assert.deepEqual(g.roles, ["source", "name", "date", "total", "qty"]);
});

test("столбцы: без заголовков — по содержимому: даты, цены, самый «текстовый» столбец — наименование", () => {
  const rows = parseTable("Уголь каменный ДПК\t15.09.2026\t9 850,00\nУголь каменный ДПК\t02.10.2026\t10 120,50\nУголь ДПК марки Д\t05.10.2026\t9 700");
  const g = guessRoles(rows);
  assert.equal(g.hasHeader, false);
  assert.deepEqual(g.roles, ["name", "date", "price"]);
});

test("строки: цена за единицу, дата ISO, реестровый номер контракта 19 цифр становится источником «ЕИС, контракт №»", () => {
  const rows = parseTable(EIS);
  const { roles, hasHeader } = guessRoles(rows);
  const built = buildRows(rows, roles, hasHeader, "таблица");
  assert.deepEqual(built.skipped, []);
  assert.deepEqual(built.rows.map((r) => [r.line, r.price, r.date, r.source]), [
    [2, "9850", "2026-09-15", "ЕИС, контракт № 1660100000126000012"],
    [3, "10120,5", "2026-10-02", "ЕИС, контракт № 1660100000126000034"],
    [4, "9700", "2026-10-05", "ЕИС, контракт № 1660100000126000051"],
  ]);
  assert.equal(built.rows[0].name, "Уголь каменный ДПК");
  assert.ok(built.rows.every((r) => r.problems.length === 0));
});

test("строки: сумма ÷ количество, когда цены за единицу нет; сумма без количества пропускается с причиной", () => {
  const rows = parseTable("Номер;Наименование;Дата;Сумма;Количество\nA-1;Уголь;15.09.2026;1 000;10\nA-2;Уголь;16.09.2026;500;\nA-3;Уголь;17.09.2026;999;3");
  const g = guessRoles(rows);
  const built = buildRows(rows, g.roles, g.hasHeader, "файл.csv");
  assert.deepEqual(built.rows.map((r) => r.price), ["100", "333"]);
  assert.deepEqual(built.skipped, [{ line: 3, reason: "есть сумма, но нет количества — цену за единицу не вывести" }]);
});

test("строки: нет цены, нет даты, дата не распознана, источника нет — без выдумывания: причина названа, источник — «таблица, строка N»", () => {
  const rows = parseTable("Наименование\tЦена\tДата\nУголь\t9850\t\nУголь\tдоговорная\t15.09.2026\nУголь\t9700\tосенью");
  const g = guessRoles(rows);
  const built = buildRows(rows, g.roles, g.hasHeader, "таблица");
  assert.deepEqual(built.skipped, [{ line: 3, reason: "цена не число" }]);
  assert.equal(built.rows.length, 2);
  assert.equal(built.rows[0].date, "");
  assert.deepEqual(built.rows[0].problems, ["нет даты — впишите её после добавления"]);
  assert.deepEqual(built.rows[1].problems, ["дата не распознана — впишите её после добавления"]);
  assert.equal(built.rows[0].source, "таблица, строка 2");
});

test("строки: не выбран столбец цены — все строки пропущены с понятной причиной; повторы одной и той же цены, источника и даты — один раз", () => {
  const none = buildRows([["а", "б"], ["1", "2"]], ["name", "ignore"], true, "т");
  assert.deepEqual(none.skipped, [{ line: 2, reason: "не выбран столбец с ценой" }]);
  const rows = parseTable("Цена\tДата\tИсточник\n100\t01.10.2026\tКП-1\n100\t01.10.2026\tКП-1\n100\t01.10.2026\tКП-2");
  const g = guessRoles(rows);
  const built = buildRows(rows, g.roles, g.hasHeader, "т");
  assert.equal(built.rows.length, 2);
  assert.match(built.skipped[0].reason, /повтор/);
});

test("строки: НДС из ячейки («без НДС», «с НДС») главнее выбранного; не названо — выбранный участником", () => {
  const rows = parseTable("Цена;Дата;Источник;НДС\n100;01.10.2026;КП-1;без НДС\n200;01.10.2026;КП-2;с НДС\n300;01.10.2026;КП-3;");
  const g = guessRoles(rows);
  const built = buildRows(rows, g.roles, g.hasHeader, "т");
  assert.deepEqual(built.rows.map((r) => r.vat), ["without", "with", null]);
  const analogs = toAnalogs(built.rows, "without", (() => { let n = 0; return () => `a${++n}`; })());
  assert.deepEqual(analogs.map((a) => a.vat), ["without", "with", "without"]);
  assert.deepEqual(analogs[0], { id: "a1", price: "100", vat: "without", source: "КП-1", date: "2026-10-01" });
});

test("предел: больше шестидесяти цен за раз — берутся первые, остальное посчитано", () => {
  const body = Array.from({ length: 75 }, (_, i) => `${1000 + i}\t01.10.2026\tКП-${i}`).join("\n");
  const rows = parseTable(`Цена\tДата\tИсточник\n${body}`);
  const g = guessRoles(rows);
  const built = buildRows(rows, g.roles, g.hasHeader, "т");
  assert.equal(built.rows.length, MAX_IMPORT);
  assert.equal(built.truncated, 75 - MAX_IMPORT);
});

test("сквозной: выгрузка из ЕИС → аналоги позиции → цены контрактов в РИЦ не идут (в них маржа победителя); те же цены как закупочные (прайс) — РИЦ считается", () => {
  const rows = parseTable(EIS);
  const g = guessRoles(rows);
  const built = buildRows(rows, g.roles, g.hasHeader, "таблица");
  let n = 0;
  const analogs = toAnalogs(built.rows, "without", () => `i${++n}`);
  const data: RicData = { positions: [{ id: "1", name: "Уголь", unit: "т", qty: "100", analogs }], settings: { ...DEFAULT_SETTINGS, nmckVat: "without" } };
  const byContracts = computeRic(data, 1_100_000, NOW).positions[0];
  assert.equal(byContracts.checks.filter((c) => c.state === "used").length, 0);
  assert.ok(byContracts.checks.every((c) => c.state === "invalid" && c.reason === CONTRACT_PRICE_REASON && c.analog.source.startsWith("ЕИС, контракт №")));
  assert.equal(computeRic(data, 1_100_000, NOW).ric, null, "по ценам контрактов индикативной цены нет");
  // Закупочные цены: тот же столбец источника, но прайс поставщика — считается, с источником и датой каждой цены.
  const priced: RicData = { ...data, positions: [{ ...data.positions[0], analogs: analogs.map((x, i) => ({ ...x, source: `Прайс ООО Уголь-Опт № ${i + 1}` })) }] };
  const result = computeRic(priced, 1_100_000, NOW);
  const position = result.positions[0];
  assert.equal(position.checks.filter((c) => c.state === "used").length, 3);
  assert.ok(position.checks.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.analog.date)));
  assert.ok(result.ric !== null);
  assert.ok(Math.abs(result.ric - ((9850 + 10120.5 + 9700) / 3) * 100) < 0.01);
});

test("ссылка на поиск в ЕИС: ключевые слова, реестр контрактов 44-ФЗ и договоров 223-ФЗ; открывается в браузере участника", () => {
  const u44 = eisSearchUrl("  Уголь  каменный   ДПК ", "44");
  assert.match(u44, /^https:\/\/zakupki\.gov\.ru\/epz\/contract\/search\/results\.html\?searchString=%D0%A3%D0%B3%D0%BE%D0%BB%D1%8C%20%D0%BA%D0%B0%D0%BC%D0%B5%D0%BD%D0%BD%D1%8B%D0%B9%20%D0%94%D0%9F%D0%9A&/);
  assert.match(u44, /fz44=on/);
  assert.match(eisSearchUrl("уголь", "223"), /^https:\/\/zakupki\.gov\.ru\/epz\/contractfz223\/search\/results\.html\?searchString=/);
  assert.ok(decodeURIComponent(eisSearchUrl("а".repeat(300), "44").split("searchString=")[1].split("&")[0]).length <= 120);
});
