// Таблица обоснования цены заказчика и «Сколько стоит исполнение»: строки с нулями у поставщиков, сверка арифметикой, сценарии и вывод — npm test.
// Образец — Приложение № 5 «Братского дома-интерната» (мебель, 223-ФЗ, НМЦД 1 781 487,02 ₽), как его переписывает распознавание снимка: ячейки через « | ».
import assert from "node:assert/strict";
import { test } from "node:test";
import { findCustomerPriceTable, parsePriceRow, toPriceBasis } from "./customer-price-table.ts";
import { BRATSK, row, Z } from "./customer-price-table.fixture.ts";
import { executionCost, pluralOf, roundReserve } from "./execution-cost.ts";

const NMCK = 1_781_487.02;

test("строка с нулями у поставщиков: нули пропускаются, средняя и итог сверены арифметикой; ОКПД и единица — не числа", () => {
  const r = parsePriceRow(row(13, "Комод", "31.09.12.129", "15,00", ["7 667,70", Z, Z, Z, "9 825,00", "7 469,00"], "1 306,66", "15,70", "8 320,57", "124 808,55"))!;
  assert.equal(r.checked, true);
  assert.deepEqual(r.offers, [7667.7, 9825, 7469]);
  assert.equal(r.qty, 15);
  assert.equal(r.mean, 8320.57);
  assert.equal(r.total, 124808.55);
  assert.equal(r.name, "Комод");
  assert.equal(r.unit, "шт");
  assert.equal(r.no, "13");
});

test("цены поставщиков не сошлись со средней (не прочиталось со снимка) — строка остаётся только со средней и итогом", () => {
  const r = parsePriceRow(row(3, "Стол квадратный на 8 рабочих мест", "31.01.12.190", "1,00", ["1 476,10", "17 000,00", "19 328,00", Z, Z, Z], "1 427,17", "7,99", "17 868,03", "17 868,03"))!;
  assert.equal(r.checked, false);
  assert.deepEqual(r.offers, []);
  assert.equal(r.mean, 17868.03);
  assert.equal(r.total, 17868.03);
});

test("не строка обоснования: спецификация без цен поставщиков, заголовок, текст — не берутся", () => {
  assert.equal(parsePriceRow("1 | Стол | шт | 2 | 15 000,00 | 30 000,00"), null, "цена и сумма без цен поставщиков — не обоснование");
  assert.equal(parsePriceRow("№ | Наименование | Кол-во | Поставщик 1"), null);
  assert.equal(parsePriceRow("Поставка мебели в течение 15 дней"), null);
});

test("Братский дом-интернат: 20 позиций, сумма до копейки равна НМЦД и «Итого» под таблицей; таблица со снимка", () => {
  const t = findCustomerPriceTable([{ name: "Извещение .docx", text: `Извещение о закупке\n\n${BRATSK}` }])!;
  assert.equal(t.rows.length, 20);
  assert.equal(t.rows.filter((r) => r.checked).length, 20);
  assert.equal(t.total, NMCK);
  assert.equal(t.printedTotal, NMCK);
  assert.equal(t.fromPicture, true);
  assert.equal(findCustomerPriceTable([{ name: "x", text: "1 | Стол | шт | 2 | 15 000,00 | 30 000,00" }]), null);
});

test("сколько стоит исполнение: минимум 1 523 476 ₽ и средняя = НМЦД (как у образца), максимум — по самой высокой цене каждой позиции", () => {
  const t = findCustomerPriceTable([{ name: "Извещение .docx", text: BRATSK }])!;
  const c = executionCost(t, NMCK);
  assert.equal(Math.round(c.min), 1_523_476);
  assert.equal(c.mean, NMCK);
  assert.equal(c.max, 2_004_853);
  assert.equal(c.matchesNmck, true);
  assert.equal(c.unchecked, 0);
});

test("самые дорогие позиции — как у образца: тумбы с ящиком, кровати, все диваны, комоды; разные тумбы и разные столы не смешиваются", () => {
  const c = executionCost(findCustomerPriceTable([{ name: "x", text: BRATSK }])!, NMCK);
  assert.deepEqual(
    c.top.map((g) => [g.label, g.qty, Math.round(g.min), Math.round(g.mean), Math.round(g.max)]),
    [
      ["Тумба с выдвижным ящиком и дверцей", 50, 372_710, 444_237, 485_000],
      ["Кровать односпальная с металлическим основанием", 20, 392_840, 440_213, 487_800],
      ["Все диваны", 5, 314_272, 367_091, 402_000],
      ["Комод", 15, 112_035, 124_809, 147_375],
    ],
  );
  assert.equal(Math.round(c.topShare * 100), 77, "на четыре группы — 77 % заказа");
});

test("сценарии как у образца: резерв на доставку и сборку 100 / 150 / 220 тыс. ₽, остаток +158 011 и −150 000 ₽, при −5 % — около 69 тыс.; вывод «интересно, но рискованно»", () => {
  const c = executionCost(findCustomerPriceTable([{ name: "x", text: BRATSK }])!, NMCK);
  const [low, base, high] = c.scenarios;
  assert.deepEqual([low.logistics, base.logistics, high.logistics], [100_000, 150_000, 220_000]);
  assert.equal(Math.round(low.total), 1_623_476);
  assert.equal(Math.round(base.total), 1_931_487);
  assert.equal(Math.round(low.atNmck!), 158_011);
  assert.equal(Math.round(base.atNmck!), -150_000);
  assert.ok(high.atNmck! < base.atNmck!);
  assert.equal(c.bid, Math.round(NMCK * 0.95 * 100) / 100);
  assert.equal(Math.round(low.atBid!), 68_936);
  assert.equal(c.verdict.tone, "warn");
  assert.equal(c.verdict.title, "Интересно, но рискованно");
  assert.match(c.verdict.text, /Даже предложение на 5 % ниже — 1 692 413 ₽ — оставит в экономном сценарии \+68 936 ₽ до прочих расходов/);
});

test("резерв круглой суммой и множественное число вида товара", () => {
  assert.deepEqual([roundReserve(99_026), roundReserve(151_426), roundReserve(7_340), roundReserve(812)], [100_000, 150_000, 7_000, 800]);
  assert.deepEqual(["Диван", "Стул", "Кровать", "Тумба", "Полка", "Кресло", "Холодильник"].map(pluralOf), ["диваны", "стулья", "кровати", "тумбы", "полки", "кресла", "холодильники"]);
});

test("вывод: по средним ценам есть прибыль — «можно»; даже по низким убыток — «убыточно»; без начальной цены — сравнить со своей", () => {
  const t = findCustomerPriceTable([{ name: "x", text: BRATSK }])!;
  assert.equal(executionCost(t, 2_200_000).verdict.tone, "good");
  assert.equal(executionCost(t, 1_500_000).verdict.tone, "danger");
  const none = executionCost(t, null);
  assert.equal(none.scenarios[0].atNmck, null);
  assert.equal(none.verdict.title, "Начальной цены нет");
});

test("другие виды таблиц: «принятая к расчёту» цена после средней (ГАУ ЦТО) и количество после цен (ВТЕ, соль с коэффициентом)", () => {
  const gau = parsePriceRow("2 | Цена за единицу товара (работы, услуги) с учетом налога на добавленную стоимость | Работы по изготовлению информационного стенда (Тормозной стенд) | в соответствии с Техническим заданием | штука | 3 | 1800000 | 1791000 | 1845000 | 1812000 | 1791000 | 5373000")!;
  assert.equal(gau.checked, true);
  assert.equal(gau.name, "Работы по изготовлению информационного стенда (Тормозной стенд)", "подписи «Цена за единицу…» и «в соответствии с ТЗ» — не наименование");
  assert.equal(gau.unit, "штука");
  assert.deepEqual([gau.qty, gau.mean, gau.total], [3, 1791000, 5373000], "в итог идёт принятая к расчёту цена");
  assert.deepEqual(gau.offers, [1800000, 1791000, 1845000]);
  assert.equal(parsePriceRow(" | Цена за единицу товара (работы, услуги) без учета налога на добавленную стоимость |  |  |  |  | 1475409,84 | 1468032,79 | 1512295,08 | 1485245,9 | 1468032,79 | 4404098,360000001"), null, "строка «без НДС» без количества — не позиция");

  const salt = parsePriceRow("1 | Соль для промышленных целей | 9,81 | 10,5 | 10,32 | 10,21 | 9,09 | 12950000 | 117715500")!;
  assert.deepEqual([salt.qty, salt.mean, salt.total], [12950000, 9.09, 117715500]);
  assert.deepEqual(salt.offers, [9.81, 10.5, 10.32]);
  const t = findCustomerPriceTable([{ name: "Расчет НМЦД.xlsx", text: "1 | Соль для промышленных целей | 9,81 | 10,5 | 10,32 | 10,21 | 9,09 | 12950000 | 117715500\nИтого: |  |  |  |  |  |  | 12950000 | 117715500" }])!;
  assert.equal(t.rows.length, 1, "одна позиция — таблица, потому что её сумма равна «Итого»");
  assert.equal(t.printedTotal, 117715500);
  assert.equal(findCustomerPriceTable([{ name: "x", text: "1 | Соль для промышленных целей | 9,81 | 10,5 | 10,32 | 10,21 | 9,09 | 12950000 | 117715500" }]), null, "одна строка без «Итого» — не берём");
  const c = executionCost(t, 117715500);
  assert.equal(c.min, 117715500, "минимум не выше принятой цены: заказчик снизил её коэффициентом");
  assert.equal(c.max, Math.round(10.5 * 12950000 * 100) / 100);
});

test("цены поставщиков без НДС, итог с НДС: предложения пересчитываются на ставку НДС — минимум, средняя и максимум в одной основе (ККБ № 2, «Изолят культуры бактерий»)", () => {
  const row = parsePriceRow("4 | Изолят культуры бактерий/профиль чувствительности к антимикробным препаратам ИВД, набор | Количество выполняемых тестов ≥ 20 шт | набор | 5 | 51250 | 54390 | 55600 | 53746,666666667 | 2245,224561894 | 4,17742104 | 53746,67 | 10 | 59121,34 | 295606,7")!;
  assert.equal(row.checked, true);
  assert.equal(row.qty, 5);
  assert.equal(row.mean, 59_121.34);
  assert.equal(row.total, 295_606.7);
  assert.deepEqual(row.offers, [56_375, 59_829, 61_160], "51 250 / 54 390 / 55 600 × 1,10");
  const c = executionCost({ doc: "x.xls", rows: [row], total: row.total, printedTotal: null, fromPicture: false }, null);
  assert.equal(Math.round(c.min), 281_875, "минимум 56 375 × 5 — с НДС, как и средняя");
  assert.equal(Math.round(c.max), 305_800);
  assert.ok(c.min < c.mean && c.mean < c.max, "минимум < средняя < максимум");
  // Принятая цена — минимальная из предложений (не НДС): предложения не пересчитываются.
  assert.deepEqual(toPriceBasis([100, 120, 110], 100), [100, 120, 110]);
});

test("строки под водяным знаком «Страница»: цены поставщиков «(неразборчиво)», но средняя и итог читаются — строка не теряется (Братск: строки 3, 18, 19)", () => {
  const r3 = parsePriceRow("3 | Стол квадратный на 8 рабочих мест | 31.01.12.190 | шт | 1,00 | (неразборчиво)476,10 | 17 (неразборчиво)00,00 | 19 (неразборчиво)8,00 | 0,(неразборчиво)0 | 0,00 | 0,00 | 1 427,17 | 7,99 | 17 868,03 | 17 868,03")!;
  assert.equal(r3.checked, false);
  assert.deepEqual([r3.qty, r3.mean, r3.total], [1, 17_868.03, 17_868.03]);
  assert.equal(r3.name, "Стол квадратный на 8 рабочих мест");
  const r19 = parsePriceRow("19 | Офисный диван 3-х местный (зеленый) | 31.09.13.190 | шт | 2,00 | (неразборчиво) 854,40 | 75 (неразборчиво)0,00 | 78 (неразборчиво)0,00 | (неразборчиво) | (неразборчиво) | 0,00 | 8 019,82 | 11,15 | 71 951,47 | 143 902,94")!;
  assert.deepEqual([r19.qty, r19.mean, r19.total], [2, 71_951.47, 143_902.94]);
  const r18 = parsePriceRow("18 | Диван | 31.09.13.190 | шт | 1,00 | 62 (неразборчиво) | 90 000,00 | 85 000,00 | 0,00 | 0,00 | 0,00 | 14 447,09 | 18,22 | 79 284,80 | 79 284,80")!;
  assert.deepEqual([r18.qty, r18.mean, r18.total], [1, 79_284.8, 79_284.8]);
  assert.equal(parsePriceRow("1 | Что-то | 5 | 7"), null, "нет средней и итога — не строка");
});
