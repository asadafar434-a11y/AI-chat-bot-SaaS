import assert from "node:assert/strict";
import { test } from "node:test";
import { crewCost } from "./crew-cost.ts";
import { mergeRates, normalizeRates, pendingItems, rateItems, ratesSignature, type RateResult, type SavedRates } from "./rate-cache.ts";
import type { RateObservation } from "./rate-extract.ts";
import type { ResourceNeed } from "./resource-need.ts";

const NEED: ResourceNeed = {
  doc: "Проектно-техническая документация.docx",
  staff: [
    { role: "Кладовщик", count: 6, requirement: "Не менее 3 лет" },
    { role: "Водитель штабелера", count: 20, requirement: null },
    { role: "Руководитель", count: 1, requirement: null },
  ],
  equipment: [
    { name: "Ричтрак", count: 10 },
    { name: "Погрузчик", count: 7 },
  ],
  months: 24,
};
const REGION = "Тверская область";
const obs = (kind: "salary" | "rent", monthly: number, over: Partial<RateObservation> = {}): RateObservation => ({ kind, subject: "x", monthly, min: null, max: null, region: REGION, regionMatch: "same", host: "a.ru", url: "https://a.ru/1", date: "2026-10-27", quote: "цитата с ценой", notes: [], ...over });
const result = (key: string, observations: RateObservation[], over: Partial<RateResult> = {}): RateResult => ({ key, kind: key.startsWith("s:") ? "salary" : "rent", observations, pagesRead: observations.length, pagesSeen: 4, pagesWithNumbers: observations.length, onRequest: 0, rejected: 0, reasons: [], ...over });
const saved = (results: RateResult[], at = "2026-10-27T09:00:00.000Z"): SavedRates => ({ at, signature: ratesSignature(rateItems(NEED, REGION)), results, spentRub: 3.2 });

test("позиции для поиска: каждая должность и каждая техника, регион один, ключи стабильны", () => {
  const items = rateItems(NEED, REGION);
  assert.deepEqual(items.map((i) => [i.key, i.kind]), [["s:Кладовщик", "salary"], ["s:Водитель штабелера", "salary"], ["s:Руководитель", "salary"], ["e:Ричтрак", "rent"], ["e:Погрузчик", "rent"]]);
  assert.ok(items.every((i) => i.region === REGION));
});

test("себестоимость по найденному: медиана по региону, взносы 30,2 %, аренда техники; итог за месяц, за срок и за тонну", () => {
  const s = saved([
    result("s:Кладовщик", [obs("salary", 60000), obs("salary", 70000), obs("salary", 65000)]),
    result("s:Водитель штабелера", [obs("salary", 80000)]),
    result("s:Руководитель", [obs("salary", 150000)]),
    result("e:Ричтрак", [obs("rent", 100000)]),
    result("e:Погрузчик", [obs("rent", 50000), obs("rent", 70000)]),
  ]);
  const c = crewCost({ need: NEED, saved: s, volumeTotal: 351121 });
  assert.deepEqual(c.staff.map((l) => [l.name, l.monthly, l.total]), [["Кладовщик", 65000, 390000], ["Водитель штабелера", 80000, 1600000], ["Руководитель", 150000, 150000]]);
  assert.equal(c.staffMonth, 2140000);
  assert.equal(c.contributionsMonth, Math.round(2140000 * 0.302), "взносы 30,2 % с зарплаты");
  assert.equal(c.equipmentMonth, 10 * 100000 + 7 * 60000, "медиана двух цен погрузчика — 60 000");
  assert.equal(c.monthTotal, 2140000 + 646280 + 1420000);
  assert.equal(c.termTotal, c.monthTotal * 24);
  assert.equal(c.perUnit, (c.monthTotal * 24) / 351121);
  assert.deepEqual([c.covered.staff, c.covered.equipment, c.complete], [[3, 3], [2, 2], true]);
});

test("не нашли ставку — этой строки в сумме нет, она названа, итог неполный; нет срока — только месяц; нет объёма — без цены за единицу", () => {
  const s = saved([result("s:Кладовщик", [obs("salary", 65000)]), result("s:Водитель штабелера", [], { pagesSeen: 5 })]);
  const c = crewCost({ need: { ...NEED, months: null }, saved: s });
  assert.deepEqual(c.covered.staff, [1, 3]);
  assert.deepEqual(c.covered.equipment, [0, 2]);
  assert.equal(c.complete, false);
  assert.equal(c.staff[1].basis, "none");
  assert.equal(c.staff[1].total, null);
  assert.equal(c.staffMonth, 6 * 65000, "только найденное");
  assert.equal(c.termTotal, null, "срока нет");
  assert.equal(c.perUnit, null);
  assert.equal(crewCost({ need: NEED, saved: null }).monthTotal, 0, "поиска ещё не было — суммы нет");
});

test("региону закупки верим больше: есть цифры по региону — другие регионы не смешиваются; нет — берутся остальные с пометкой в основе", () => {
  const mixed = crewCost({ need: NEED, saved: saved([result("s:Кладовщик", [obs("salary", 60000), obs("salary", 120000, { regionMatch: "other", region: "Москва" })])]) });
  assert.equal(mixed.staff[0].monthly, 60000);
  assert.equal(mixed.staff[0].basis, "region");
  const elsewhere = crewCost({ need: NEED, saved: saved([result("s:Кладовщик", [obs("salary", 120000, { regionMatch: "other", region: "Москва" }), obs("salary", 100000, { regionMatch: "unknown", region: null })])]) });
  assert.equal(elsewhere.staff[0].monthly, 110000);
  assert.equal(elsewhere.staff[0].basis, "other");
});

test("порции поиска: что уже найдено не ищется заново; неудачный поиск (страниц не было) повторяется через десять минут один раз; изменился состав или срок вышел — искать всё", () => {
  const items = rateItems(NEED, REGION);
  const at = new Date("2026-10-27T09:05:00.000Z");
  assert.equal(pendingItems(items, null, at).length, 5);
  const s = saved([result("s:Кладовщик", [obs("salary", 65000)]), result("s:Руководитель", [], { pagesSeen: 0, tries: 1 }), result("s:Водитель штабелера", [], { pagesSeen: 6, tries: 1 })]);
  assert.deepEqual(pendingItems(items, s, at).map((i) => i.key), ["e:Ричтрак", "e:Погрузчик"], "через пять минут молчавший поиск ещё не повторяем");
  const later = new Date("2026-10-27T09:11:00.000Z");
  assert.deepEqual(pendingItems(items, s, later).map((i) => i.key), ["s:Руководитель", "e:Ричтрак", "e:Погрузчик"], "через десять минут — молчавший повторяется, а «страницы читали, цифр не нашли» — нет");
  assert.equal(pendingItems(items, { ...s, signature: "другой" }, later).length, 5);
  assert.equal(pendingItems(items, s, new Date("2026-12-01T00:00:00Z")).length, 5, "две недели прошли");
  const twice = saved([result("s:Руководитель", [], { pagesSeen: 0, tries: 2 })]);
  assert.ok(!pendingItems(items, twice, later).some((i) => i.key === "s:Руководитель"), "две попытки — хватит");
});

test("слияние порций: найденное не затирается пустым повтором, число попыток растёт, расход складывается; сохранённое читается и мусор отбрасывается", () => {
  const sig = ratesSignature(rateItems(NEED, REGION));
  const first = mergeRates(null, [result("s:Кладовщик", [obs("salary", 65000)])], sig, 1.5, "2026-10-27T09:00:00.000Z");
  const second = mergeRates(first, [result("s:Кладовщик", []), result("s:Руководитель", [obs("salary", 150000)])], sig, 2, "2026-10-27T09:12:00.000Z");
  assert.equal(second.results.find((r) => r.key === "s:Кладовщик")?.observations.length, 1, "пустой повтор не затёр найденное");
  assert.equal(second.results.find((r) => r.key === "s:Кладовщик")?.tries, 2);
  assert.equal(second.spentRub, 3.5);
  assert.equal(second.at, "2026-10-27T09:00:00.000Z", "срок годности считается с первого поиска");
  assert.equal(normalizeRates(JSON.parse(JSON.stringify(second)))?.results.length, 2);
  assert.equal(normalizeRates({ at: "x" }), undefined);
  const cleaned = normalizeRates({ at: "2026-10-27T09:00:00Z", signature: "s", results: [{ key: "s:A", kind: "salary", observations: [{ nonsense: 1 }, obs("salary", 5)], pagesRead: "7" }, { key: 5 }] });
  assert.equal(cleaned?.results.length, 1);
  assert.equal(cleaned?.results[0].observations.length, 1);
  assert.equal(cleaned?.results[0].pagesRead, 0);
});
