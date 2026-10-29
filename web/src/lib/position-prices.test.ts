import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS, type RicData } from "./indicative-price.ts";
import { makeObservation, type Observation } from "./market-observations.ts";
import { missingSpecNote, positionPrices, priceLines, purchaseCost, unitForCost } from "./position-prices.ts";
import type { SavedPrices } from "./price-cache.ts";

const obs = (price: number, host: string, name = "Уголь каменный ДПК", tail = `; https://${host}/price`, unit = "т"): Observation => {
  const built = makeObservation({ name, unit, price, vat: "without", vatRate: 22, date: "2026-10-20", source: `${host}: каталог — страница, проверено 20.10.2026${tail}`, sourceKind: "supplier_offer" });
  if (!built.ok) throw new Error(built.reason);
  return built.value;
};

const data = (over: Partial<RicData["positions"][number]> = {}): RicData => ({
  positions: [{ id: "p1", name: "Уголь каменный ДПК", unit: "т", qty: "1 500", analogs: [], customerUnit: 6100, ...over }],
  settings: { ...DEFAULT_SETTINGS, nmckVat: "without" },
});
const saved = (observations: Observation[]): SavedPrices => ({ at: "2026-10-22T10:00:00.000Z", signature: "s", results: [{ key: "p1", observations, pagesRead: observations.length, rejected: 0 }], spentRub: 2 });
const FIVE = [5000, 5050, 5100, 5150, 5200].map((p, i) => obs(p, `shop${i + 1}.ru`));

test("цен хватает (от пяти): медиана, диапазон, число цен, закупочная стоимость позиции и отличие начальной цены заказчика", () => {
  const r = positionPrices(data(), saved(FIVE), ["p1"], "done", "2026-10-22");
  const row = r.rows[0];
  assert.equal(row.state, "found");
  assert.equal(row.median, 5100);
  assert.equal(row.n, 5);
  assert.deepEqual(row.range, { from: 5000, to: 5200 });
  assert.equal(row.cost, 7_650_000, "5 100 ₽ × 1 500 т");
  assert.ok(Math.abs(row.gapPct! - 19.6) < 0.1, `заказчик заложил на 19,6 % больше закупки, получилось ${row.gapPct}`);
  assert.equal(r.priced, 1);
  assert.equal(r.cost, 7_650_000);
  assert.equal(r.costPositions, 1);
  assert.equal(r.asOf, "2026-10-20");
});

test("основа НДС заказчика: начальная цена с НДС сравнивается с закупочной медианой, пересчитанной на НДС", () => {
  const withVat: RicData = { ...data(), settings: { ...DEFAULT_SETTINGS, nmckVat: "with", vatRate: 20 } };
  const row = positionPrices(withVat, saved(FIVE), ["p1"], "done", "2026-10-22").rows[0];
  assert.ok(Math.abs(row.gapPct! - ((6100 - 6120) / 6120) * 100) < 0.01, "5 100 × 1,2 = 6 120");
});

test("цен мало (меньше пяти): показаны найденные, медианы и стоимости нет — вывод не делается", () => {
  const row = positionPrices(data(), saved(FIVE.slice(0, 3)), ["p1"], "done", "2026-10-22").rows[0];
  assert.equal(row.state, "few");
  assert.equal(row.median, null);
  assert.equal(row.cost, null);
  assert.equal(row.gapPct, null);
  assert.equal(row.n, 3);
  assert.deepEqual(row.range, { from: 5000, to: 5100 });
  assert.equal(row.sources.length, 3);
});

test("не искали, ищем, выключен, не удалось, ничего не нашли: у позиции состояние без цен и без выдуманных чисел", () => {
  const states = (searched: string[], state: Parameters<typeof positionPrices>[3], s: SavedPrices | null) => positionPrices(data(), s, searched, state, "2026-10-22").rows[0];
  assert.equal(states([], "done", saved(FIVE)).state, "not-searched", "позиция не вошла в три главные");
  assert.equal(states(["p1"], "searching", null).state, "searching");
  assert.equal(states(["p1"], "off", null).state, "off");
  assert.equal(states(["p1"], "failed", null).state, "failed");
  const none = states(["p1"], "done", saved([]));
  assert.equal(none.state, "none");
  assert.equal(none.median, null);
  assert.equal(none.sources.length, 0);
  assert.equal(positionPrices(data(), saved([]), ["p1"], "done", "2026-10-22").priced, 0);
  assert.equal(positionPrices(data(), saved([]), ["p1"], "done", "2026-10-22").cost, null);
});

test("несопоставимые цены не показываются: другой товар и другая единица в расчёт не идут", () => {
  const other = obs(900, "other.ru", "Щебень гранитный фракция 5-20");
  const row = positionPrices(data(), saved([...FIVE, other]), ["p1"], "done", "2026-10-22").rows[0];
  assert.equal(row.n, 5);
  assert.ok(row.sources.every((s) => !/Щебень/.test(s.product)));
});

test("источники: до трёх цен, ближайших к медиане, с поставщиком, датой и ссылкой; ссылка не http(s) отбрасывается", () => {
  const withBad = [...FIVE.slice(0, 4), obs(5200, "bad.ru", "Уголь каменный ДПК", "; javascript:alert(1)")];
  const row = positionPrices(data(), saved(withBad), ["p1"], "done", "2026-10-22").rows[0];
  assert.equal(row.sources.length, 3);
  assert.deepEqual(row.sources[0], { host: "shop3.ru", product: "Уголь каменный ДПК", price: 5100, date: "2026-10-20", url: "https://shop3.ru/price" });
  const bad = positionPrices(data(), saved([obs(5200, "bad.ru", "Уголь каменный ДПК", "; javascript:alert(1)")]), ["p1"], "done", "2026-10-22").rows[0];
  assert.equal(bad.sources[0].url, null);
});

test("количества нет — стоимость позиции не считается; несколько позиций — стоимость только по тем, где есть цена и количество", () => {
  assert.equal(positionPrices(data({ qty: "" }), saved(FIVE), ["p1"], "done", "2026-10-22").rows[0].cost, null);
  const two: RicData = { ...data(), positions: [...data().positions, { id: "p2", name: "Кокс", unit: "т", qty: "10", analogs: [] }] };
  const r = positionPrices(two, saved(FIVE), ["p1", "p2"], "done", "2026-10-22");
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[1].state, "none");
  assert.equal(r.costPositions, 1);
  assert.equal(r.cost, 7_650_000);
});

test("нет файла технических требований: заказчик пишет «в отдельном файле», а файла в закупке нет — сказано, что добавить; файл есть или заказчик молчит — тишина", () => {
  const main = { name: "ДоЗ_Аукцион МСП_Поставка агрегатов сварочных.docx", text: "6. Приложение № 1 – Технические требования\n6.1 Пояснения к Техническим требованиям\n6.1.1 Технические требования к закупаемой продукции приведены в отдельном файле (предоставляются отдельным документом в составе Документации о закупке)." };
  const others = [{ name: "Приложение №2 к ДоЗ - ПРОЕКТ ДОГОВОРА.docx", text: "Договор" }, { name: "Приложение №10 к ДоЗ - ФОРМА ЗАЯВКИ.xlsx", text: "Заявка" }];
  assert.match(missingSpecNote([main, ...others]) ?? "", /проверила все файлы \(3\): списка товаров с количеством нет, только название лота[\s\S]*Приложение № 1/);
  assert.equal(missingSpecNote([main, ...others, { name: "Приложение №1 к ДоЗ - Технические требования.docx", text: "Сварочный агрегат — 3 шт." }]), null, "файл приложен");
  assert.equal(missingSpecNote([main, { name: "ТЗ.docx", text: "x" }]), null, "файл назван «ТЗ»");
  assert.equal(missingSpecNote([main, { name: "Спецификация.xlsx", text: "x" }]), null);
  assert.ok(missingSpecNote([main, { name: "Приложение №10.xlsx", text: "x" }]) !== null, "«Приложение №10» — не «№1»");
  assert.equal(missingSpecNote([{ name: "Извещение.docx", text: "Закупка угля. Позиции — в таблице ниже." }, ...others]), null, "заказчик об отдельном файле не пишет");
  assert.equal(missingSpecNote([]), null);
});

test("тот же товар по модельному обозначению: «МАКС-500» у заказчика и у поставщика — одна позиция, хотя остальные слова названы по-разному; другая модель — нет", () => {
  const data500: RicData = { positions: [{ id: "p2", name: "Многопостовой автономный комплекс сварки МАКС-500 или эквивалент", unit: "шт", qty: "2", analogs: [] }], settings: { ...DEFAULT_SETTINGS, nmckVat: "without" } };
  const kvant = obs(1507504, "gk-sk.ru", "Сварочный агрегат НПП КВАНТ МАКС-500, 2 поста, дизельный", "; https://gk-sk.ru/x", "шт");
  const row = positionPrices(data500, { ...saved([kvant]), results: [{ key: "p2", observations: [kvant], pagesRead: 1, rejected: 0 }] }, ["p2"], "done", "2026-10-22").rows[0];
  assert.equal(row.state, "few", "одна цена — показана, вывода по ней нет");
  assert.equal(row.n, 1);
  assert.deepEqual(row.range, { from: 1507504, to: 1507504 });
  assert.equal(row.sources[0].host, "gk-sk.ru");
  const other = obs(900000, "x.ru", "Сварочный агрегат КВАНТ МАКС-300", "; https://x.ru/y", "шт");
  const none = positionPrices(data500, { ...saved([other]), results: [{ key: "p2", observations: [other], pagesRead: 1, rejected: 0 }] }, ["p2"], "done", "2026-10-22").rows[0];
  assert.equal(none.state, "none", "МАКС-300 — другая модель");
});

test("строки про найденные цены: даже одна цена называется целиком — с поставщиком; от пяти — медиана и диапазон; нет цен — строк нет", () => {
  const rows = (observations: Observation[]) => positionPrices(data(), saved(observations), ["p1"], "done", "2026-10-22");
  assert.deepEqual(priceLines(rows([FIVE[2]])), ["«Уголь каменный ДПК»: 5 100 ₽ за т — shop3.ru, одна цена"]);
  assert.deepEqual(priceLines(rows(FIVE.slice(0, 2))), ["«Уголь каменный ДПК»: 5 000 ₽ – 5 050 ₽ за т, цен 2 (для вывода нужно не меньше пяти)"]);
  assert.deepEqual(priceLines(rows(FIVE)), ["«Уголь каменный ДПК»: 5 100 ₽ за т (диапазон 5 000 ₽ – 5 200 ₽, цен 5)"]);
  assert.deepEqual(priceLines(rows([])), []);
  const pair: RicData = { ...data(), positions: [{ ...data().positions[0], name: "Уголь каменный ДПК или эквивалент" }] };
  assert.deepEqual(priceLines(positionPrices(pair, saved([FIVE[2]]), ["p1"], "done", "2026-10-22")), ["«Уголь каменный ДПК»: 5 100 ₽ за т — shop3.ru, одна цена"], "«или эквивалент» в строке не пишется");
});

test("себестоимость закупки по найденным ценам: цена единицы × количество по каждой позиции, плюс НДС, если начальная цена с НДС; полная сумма — только когда цена и количество есть по всем позициям", () => {
  const many: RicData = { ...data(), positions: [{ id: "p1", name: "Уголь каменный ДПК", unit: "т", qty: "1 500", analogs: [] }, { id: "p2", name: "Уголь каменный ДПК", unit: "т", qty: "10", analogs: [] }], settings: { ...DEFAULT_SETTINGS, nmckVat: "with", vatRate: 20 } };
  const s: SavedPrices = { ...saved(FIVE), results: [{ key: "p1", observations: FIVE, pagesRead: 5, rejected: 0 }, { key: "p2", observations: [], pagesRead: 0, rejected: 0 }] };
  const prices = positionPrices(many, s, ["p1", "p2"], "done", "2026-10-22");
  const part = purchaseCost(prices, { withVat: true, vatRate: 20 });
  assert.equal(part.total, null, "по второй позиции цены нет — полной суммы нет");
  assert.equal(part.covered, 1);
  assert.equal(part.of, 2);
  assert.equal(part.partial, 9_180_000, "5 100 × 1,2 × 1 500");
  const both: SavedPrices = { ...s, results: [s.results[0], { key: "p2", observations: FIVE, pagesRead: 5, rejected: 0 }] };
  const all = purchaseCost(positionPrices(many, both, ["p1", "p2"], "done", "2026-10-22"), { withVat: true, vatRate: 20 });
  assert.equal(all.total, 9_180_000 + 61_200, "5 100 × 1,2 × 10 = 61 200");
  const net = purchaseCost(positionPrices(many, both, ["p1", "p2"], "done", "2026-10-22"), { withVat: false, vatRate: 20 });
  assert.equal(net.total, 7_650_000 + 51_000, "начальная цена без НДС — НДС не добавляется");
  assert.equal(purchaseCost({ rows: [], priced: 0, cost: null, costPositions: 0, asOf: null }, { withVat: true, vatRate: 20 }).total, null, "позиций нет — суммы нет");
});

test("цена единицы для себестоимости: одна цена — она; две — большая (запас); три и больше — медиана; лекарство из реестра — НДС 10 %", () => {
  const u = (unitPrices: number[], median: number | null = null) => unitForCost({ unitPrices, median });
  assert.equal(u([100]), 100);
  assert.equal(u([100, 300]), 300);
  assert.equal(u([100, 200, 900]), 200);
  assert.equal(u([100, 200, 300, 400]), 250);
  assert.equal(u([]), null);
  const drug: RicData = { positions: [{ id: "d", name: "Дабрафениб 75 мг № 120, капсулы", unit: "упаковка", qty: "25", analogs: [] }], settings: { ...DEFAULT_SETTINGS, nmckVat: "with", vatRate: 22 } };
  const mk = (price: number, tradeName: string) => {
    const b = makeObservation({ name: `Дабрафениб 75 мг № 120, капсулы (${tradeName})`, unit: "упаковка", price, vat: "without", vatRate: 10, date: "2026-10-14", source: `grls.rosminzdrav.ru: Реестр предельных отпускных цен на ЖНВЛП (ГРЛС) — потолок; https://grls.rosminzdrav.ru/PriceLims.aspx`, sourceKind: "price_list" });
    if (!b.ok) throw new Error(b.reason);
    return b.value;
  };
  const s: SavedPrices = { at: "2026-10-23T08:00:00.000Z", signature: "s", spentRub: 0, results: [{ key: "d", observations: [mk(113019.82, "АМЕДАРТ"), mk(135623.79, "Промомед"), mk(226039.65, "Тафинлар")], pagesRead: 0, rejected: 0 }] };
  const cost = purchaseCost(positionPrices(drug, s, ["d"], "done", "2026-10-23"), { withVat: true, vatRate: 22 });
  assert.equal(cost.total, Math.round(135623.79 * 1.1 * 25 * 100) / 100, "медиана трёх цен 135 623,79 × 1,1 (лекарства — 10 %, а не 22 %) × 25 упаковок");
});

test("точной цены нет, но есть тот же вид товара с другими характеристиками: показываются как аналоги, в расчёт не входят; другой товар и другая единица — не аналоги", () => {
  const desk = data({ name: "Стол прямоугольный на 1 рабочее место, с настольной полкой", unit: "шт", qty: "40", customerUnit: 25_000 });
  const found = [
    obs(13_300, "dobro.io", "Стол прямоугольный PROSTO 120х60 RAL 9005, Муар чёрный", undefined, "шт"),
    obs(11_150, "mebel.ru", "Стол прямоугольный GIBKO с бортиком 120х60 RAL 9005", undefined, "шт"),
    obs(16_100, "shop.ru", "Стол прямоугольный PROSTO с бортиком 120х60 RAL 9016", undefined, "шт"),
    obs(5_223, "o-manager.ru", "Офисное кресло Chairman 696 LT черный", undefined, "шт"),
    obs(900, "paper.ru", "Стол прямоугольный PROSTO 120х60 (за упаковку)", undefined, "упак"),
  ];
  const r = positionPrices(desk, { ...saved([]), results: [{ key: "p1", observations: found, pagesRead: 5, rejected: 0 }] }, ["p1"], "done", "2026-10-22");
  const row = r.rows[0];
  assert.equal(row.state, "none", "точной цены нет");
  assert.equal(row.median, null);
  assert.equal(row.cost, null, "стоимость по аналогам не считается");
  assert.equal(row.n, 0);
  assert.equal(row.analogs?.n, 3, "кресло и позиция в другой единице аналогами не считаются");
  assert.deepEqual(row.analogs?.range, { from: 11_150, to: 16_100 });
  assert.equal(row.analogs?.sources.length, 3);
  assert.equal(r.priced, 0);
  assert.equal(r.cost, null, "в «закупку по найденным ценам» аналоги не входят");
  assert.equal(purchaseCost(r, { withVat: false, vatRate: 22 }).covered, 0);
  assert.deepEqual(priceLines(r), [], "в подпись внизу аналоги не идут");
});

test("аналогов нет, если найденное — другой товар (слова названия не совпали)", () => {
  const desk = data({ name: "Стол прямоугольный на 8 рабочих мест", unit: "шт", qty: "2" });
  const row = positionPrices(desk, { ...saved([]), results: [{ key: "p1", observations: [obs(5_223, "o-manager.ru", "Офисное кресло Chairman 696 LT черный", undefined, "шт")], pagesRead: 1, rejected: 0 }] }, ["p1"], "done", "2026-10-22").rows[0];
  assert.equal(row.state, "none");
  assert.equal(row.analogs, null);
});
