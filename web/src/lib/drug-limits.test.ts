import assert from "node:assert/strict";
import { test } from "node:test";
import { drugQueryOf, observationsFromLimits, parseLimitRows, rowMatches, type LimitRow } from "./drug-limits.ts";

// Страница реестра предельных цен (ГРЛС) в том виде, в каком она пришла 23.10.2026: шапка из 15 столбцов, строки данных, «Найдено: N запис.».
const HEAD = ["guid", "№ п/п", "МНН", "Торговое наименование", "Лек. форма/ дозировка/ упаковка", "Владелец РУ/ производитель/ упаковщик/ Выпускающий контроль (инн/ватин)", "Код АТХ", "Кол-во в потреб. упаковке", "Предельная цена руб. без НДС", "Цена указана за перв.упак.", "Номер РУ", "Дата регистрации цены (№ решения)", "Штрих-код (EAN13)", "Дата вступления в силу", "История"];
const row = (cells: string[]) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
const data = (i: number, trade: string, form: string, qty: string, price: string, over: Partial<Record<number, string>> = {}) => {
  const cells = [`g${i}`, String(i), "Дабрафениб", trade, form, "Вл.Тест, Россия", "L01EC02", qty, price, "", "ЛП-000001", "01.10.2025 1496/20-25", "4630106835174", "01.10.2025", ""];
  for (const [k, v] of Object.entries(over)) cells[Number(k)] = v as string;
  return row(cells);
};
const PAGE = `<html><body><span>Найдено: 4 запис.</span><table><tr>${HEAD.map((c) => `<th>${c}</th>`).join("")}</tr>${[
  data(1, "Тафинлар&#174;", "капсулы, 75 мг, 120 шт. - флаконы (1) - пачки картонные", "120", "226039,65", { 11: "14.10.2026 25-7-4376479-изм", 13: "14.10.2026", 10: "ЛП-002274" }),
  data(2, "Дабрафениб-АМЕДАРТ", "капсулы, 75 мг, 120 шт. - банки (1) - пачки картонные", "120", "113019,82"),
  data(3, "Дабрафениб-АМЕДАРТ", "капсулы, 75 мг, 28 шт. - банки (1) - пачки картонные", "28", "26371,29"),
  data(4, "Дабрафениб-АМЕДАРТ", "капсулы, 50 мг, 120 шт. - банки (1) - пачки картонные", "120", "75346,55"),
].join("")}</table></body></html>`;

test("разбор страницы реестра: столбцы по названию в шапке, цена с запятой, дата решения и вступления в силу, «Найдено: N»", () => {
  const { rows, total } = parseLimitRows(PAGE);
  assert.equal(total, 4);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], {
    inn: "Дабрафениб",
    tradeName: "Тафинлар",
    form: "капсулы, 75 мг, 120 шт. - флаконы (1) - пачки картонные",
    owner: "Вл.Тест, Россия",
    atc: "L01EC02",
    packQty: 120,
    price: 226039.65,
    primaryPack: false,
    regNumber: "ЛП-002274",
    decision: "14.10.2026 25-7-4376479-изм",
    validFrom: "2026-10-14",
  });
  assert.equal(parseLimitRows("<html>пусто</html>").rows.length, 0, "без шапки — ничего");
  assert.equal(parseLimitRows(PAGE.replace("226039,65", "по запросу")).rows.length, 3, "строка без числа в цене пропускается");
});

test("название позиции → что искать: МНН, дозировка, число штук в упаковке, форма; не лекарство — null", () => {
  assert.deepEqual(drugQueryOf("Дабрафениб 75 мг № 120, капсулы"), { inn: "Дабрафениб", dosage: "75 мг", pack: 120, form: "капсул" });
  assert.deepEqual(drugQueryOf("Амоксициллин+Клавулановая кислота 500 мг+125 мг № 14, таблетки"), { inn: "Амоксициллин+Клавулановая кислота", dosage: "500 мг", pack: 14, form: "таблет" });
  assert.deepEqual(drugQueryOf("Ритуксимаб, концентрат для приготовления раствора для инфузий 100 мг/10 мл, 2 шт"), { inn: "Ритуксимаб", dosage: "100 мг", pack: 2, form: "раствор" });
  assert.equal(drugQueryOf("Сварочный агрегат МАКС-300"), null, "нет дозировки — не лекарство");
  assert.equal(drugQueryOf("Кабель ВВГ 3х2,5 мм"), null, "мм — не дозировка");
  assert.equal(drugQueryOf("75 мг капсулы"), null, "нет МНН");
});

test("строки реестра, подходящие позиции: тот же МНН, та же дозировка, то же число штук в упаковке и та же форма", () => {
  const rows = parseLimitRows(PAGE).rows;
  const q = drugQueryOf("Дабрафениб 75 мг № 120, капсулы")!;
  assert.deepEqual(rows.filter((r) => rowMatches(q, r)).map((r) => r.tradeName), ["Тафинлар", "Дабрафениб-АМЕДАРТ"]);
  const noPack = drugQueryOf("Дабрафениб 75 мг, капсулы")!;
  assert.equal(rows.filter((r) => rowMatches(noPack, r)).length, 3, "упаковка не названа — подходят все 75 мг");
  assert.equal(rows.filter((r) => rowMatches(drugQueryOf("Дабрафениб 100 мг № 120, капсулы")!, r)).length, 0, "другая дозировка — нет");
  assert.equal(rowMatches(q, { ...rows[0], primaryPack: true }), false, "цена за первичную упаковку не берётся");
  assert.equal(rowMatches(drugQueryOf("Дабрафениб 75 мг № 120, таблетки")!, rows[0]), false, "другая форма — нет");
});

test("цены из реестра: дешёвые первыми, без НДС, за упаковку, с датой решения и пометкой «потолок, а не рыночная»; адрес реестра в источнике", () => {
  const q = drugQueryOf("Дабрафениб 75 мг № 120, капсулы")!;
  const found = observationsFromLimits(q, "Дабрафениб 75 мг № 120, капсулы", parseLimitRows(PAGE).rows, "2026-10-23");
  assert.deepEqual(found.map((o) => [o.priceNoVat, o.unit, o.observedAt]), [[113019.82, "упак", "2025-10-01"], [226039.65, "упак", "2026-10-14"]]);
  assert.equal(found[0].name, "Дабрафениб 75 мг № 120, капсулы (Дабрафениб-АМЕДАРТ)");
  assert.match(found[1].source, /^grls\.rosminzdrav\.ru: Реестр предельных отпускных цен на ЖНВЛП \(ГРЛС\) — предельная цена производителя без НДС, потолок, а не рыночная; Тафинлар, капсулы, 75 мг, 120 шт\./);
  assert.match(found[1].source, /решение 14\.10\.2026 25-7-4376479-изм; проверено 23\.10\.2026; https:\/\/grls\.rosminzdrav\.ru\/PriceLims\.aspx$/);
});

test("несколько решений о цене одного препарата (разные даты, одна цена) — в ответе одно, самое свежее", () => {
  const rows = parseLimitRows(PAGE).rows;
  const older: LimitRow = { ...rows[0], validFrom: "2025-04-14", decision: "14.04.2025 ст.решение" };
  const q = drugQueryOf("Дабрафениб 75 мг № 120, капсулы")!;
  const found = observationsFromLimits(q, "Дабрафениб 75 мг № 120, капсулы", [older, ...rows], "2026-10-23");
  assert.equal(found.filter((o) => /Тафинлар/.test(o.name)).length, 1);
  assert.equal(found.find((o) => /Тафинлар/.test(o.name))?.observedAt, "2026-10-14", "самое свежее решение");
});
