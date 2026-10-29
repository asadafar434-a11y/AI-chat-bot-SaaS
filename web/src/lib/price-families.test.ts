// Поиск цен по виду товара: главное слово названия, план поиска (вид из нескольких позиций — один запрос, модель — отдельно), раздача результата позициям — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { RicPosition } from "./indicative-price.ts";
import { headNoun, makeObservation, sameKind, type Observation } from "./market-observations.ts";
import { expandSaved, familyName, planSearch } from "./price-families.ts";
import type { SavedPrices } from "./price-cache.ts";

const pos = (id: string, name: string, qty = "1", customerUnit?: number, unit = "шт"): RicPosition => ({ id, name, unit, qty, analogs: [], ...(customerUnit !== undefined ? { customerUnit } : {}) });
const obs = (name: string, price: number, unit = "шт"): Observation => {
  const built = makeObservation({ name, unit, price, vat: "without", vatRate: 22, date: "2026-10-29", source: "dobro.io: каталог — страница, проверено 29.10.2026; https://dobro.io/p", sourceKind: "price_list" });
  if (!built.ok) throw new Error(built.reason);
  return built.value;
};

test("главное слово — вид товара: прилагательное в начале пропускается, числа и короткие слова — нет", () => {
  assert.equal(headNoun("Стол прямоугольный на 8 рабочих мест"), "стол");
  assert.equal(headNoun("Офисное кресло Chairman 696 LT Россия TW-01"), "кресл");
  assert.equal(headNoun("Рабочий стол с выкатной тумбой"), "стол");
  assert.equal(headNoun("Шкаф-купе двухдверный"), "шкаф");
  assert.equal(headNoun("12 345"), null);
  assert.equal(headNoun(""), null);
});

test("тот же вид товара: единица совпала и в названии есть главное слово заказчика; другой вид и другая единица — нет", () => {
  const target = { name: "Стол прямоугольный на 8 рабочих мест", unit: "шт", quantity: 2 };
  assert.equal(sameKind(target, obs("Стол письменный Ikea 140х70", 9000)), true);
  assert.equal(sameKind(target, obs("Офисное кресло Chairman 696 LT", 5000)), false);
  assert.equal(sameKind(target, obs("Стол письменный (упаковка)", 900, "упак")), false);
});

test("название вида: главное слово и самое частое свойство среди позиций; общего свойства нет — одно главное слово", () => {
  assert.equal(familyName("стол", ["Стол прямоугольный на 8 рабочих мест", "Стол квадратный на 8 рабочих мест", "Стол прямоугольный, раскладной"]), "Стол прямоугольный");
  assert.equal(familyName("стол", ["Стол рабочий", "Стол письменный"]), "Стол");
});

test("план поиска: столы одним запросом, кресло с моделью — отдельно; позиции вида получают общий ключ", () => {
  const positions = [
    pos("a", "Стол прямоугольный на 8 рабочих мест", "2", 80_000),
    pos("b", "Стол квадратный на 8 рабочих мест", "2", 70_000),
    pos("c", "Стол прямоугольный, раскладной", "5", 12_000),
    pos("d", "Офисное кресло Chairman 696 LT Россия TW-01", "7", 6_000),
  ];
  const plan = planSearch(positions, 6);
  assert.equal(plan.picks.length, 2, "вид «стол» и кресло: два запроса вместо четырёх");
  const family = plan.picks.find((p) => p.id.startsWith("fam:"))!;
  assert.equal(family.name, "Стол прямоугольный");
  assert.equal(family.qty, "", "количество у вида не называется: объём не сравнивается");
  assert.deepEqual(plan.members.get(family.id), ["a", "b", "c"]);
  assert.ok(plan.picks.some((p) => p.id === "d"), "кресло с моделью ищется само");
  assert.deepEqual([...plan.searchedIds].sort(), ["a", "b", "c", "d"]);
});

test("план поиска: больше max видов — берутся самые крупные по сумме, остальные не ищутся", () => {
  const positions = [pos("a", "Стол рабочий", "1", 1_000), pos("b", "Шкаф для документов", "1", 50_000), pos("c", "Тумба прикроватная", "1", 20_000)];
  const plan = planSearch(positions, 2);
  assert.deepEqual(plan.picks.map((p) => p.id), ["b", "c"]);
  assert.deepEqual(plan.searchedIds, ["b", "c"]);
});

test("план поиска: вид из одной позиции ищется под её названием; позиция без понятного названия — сама", () => {
  const plan = planSearch([pos("a", "Шкаф для документов закрытый", "3", 10_000), pos("b", "12 345")], 6);
  assert.equal(plan.members.size, 0);
  assert.deepEqual(plan.picks.map((p) => p.name), ["Шкаф для документов закрытый", "12 345"]);
});

test("результат поиска по виду достаётся каждой позиции вида; у остальных — как был", () => {
  const plan = planSearch([pos("a", "Стол прямоугольный на 8 рабочих мест"), pos("b", "Стол прямоугольный, раскладной"), pos("d", "Офисное кресло Chairman 696 LT")], 6);
  const familyId = plan.picks.find((p) => p.id.startsWith("fam:"))!.id;
  const saved: SavedPrices = {
    at: "2026-10-29T10:00:00.000Z",
    signature: "s",
    spentRub: 9,
    results: [
      { key: familyId, observations: [obs("Стол прямоугольный PROSTO 120х60", 13_300)], pagesRead: 3, rejected: 0, pagesSeen: 5 },
      { key: "d", observations: [], pagesRead: 0, rejected: 0 },
    ],
  };
  const out = expandSaved(saved, plan)!;
  assert.deepEqual(out.results.map((r) => r.key), ["a", "b", "d"]);
  assert.equal(out.results[0].observations.length, 1);
  assert.equal(out.results[1].observations[0].priceNoVat, 13_300);
  assert.equal(out.spentRub, 9, "траты не удваиваются");
  assert.equal(expandSaved(null, plan), null);
  assert.equal(expandSaved(saved, planSearch([pos("d", "Офисное кресло Chairman 696 LT")], 6)), saved, "видов нет — сохранённое без изменений");
});
