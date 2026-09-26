// Проверка расчёта «До какой цены снижаться»: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { antiDumpingApplies, defaultsFor, priceFloor, readRequirements, type PriceCalc } from "./price-floor.ts";

const calc = (patch: Partial<PriceCalc>): PriceCalc => ({
  nmck: 1_000_000,
  costs: 500_000,
  extra: null,
  taxPct: null,
  securityPct: null,
  smeOnly: false,
  exempt: false,
  method: "guarantee",
  guaranteeRatePct: null,
  moneyRatePct: null,
  days: null,
  antiDumping: false,
  goodFaith: false,
  price: null,
  ...patch,
});

function floorOf(c: PriceCalc) {
  const { floor, at } = priceFloor(c);
  assert.ok(floor.ok, "нижняя цена должна считаться");
  return { ...floor, at: (price: number) => at(price)! };
}

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.005, `${actual} ≠ ${expected}`);

test("обычный расчёт: расходы, налог с выручки, гарантия от начальной цены", () => {
  // Гарантия на 5 % начальной цены под 3 % годовых на год стоит 1 500 ₽.
  const floor = floorOf(calc({ costs: 700_000, taxPct: 6, securityPct: 5, guaranteeRatePct: 3, days: 365 }));
  assert.equal(floor.kind, "plain");
  assert.equal(floor.price, 746_276.6);
  const at = floor.at(floor.price);
  near(at.securityCost, 1_500);
  near(at.tax, 44_776.6);
  assert.ok(at.profit >= 0 && at.profit < 0.01);
  assert.ok(floor.at(floor.price - 0.01).profit < 0);
});

test("закупка у малого бизнеса: обеспечение от цены контракта", () => {
  // 10 % от цены своими деньгами под 20 % годовых на 73 дня — 0,4 % цены.
  const floor = floorOf(calc({ costs: 700_000, securityPct: 10, smeOnly: true, method: "money", moneyRatePct: 20, days: 73 }));
  assert.equal(floor.price, 702_811.25);
  near(floor.at(floor.price).security, 70_281.125);
});

test("снижение на 25 % и больше: обеспечение в полтора раза больше", () => {
  const floor = floorOf(calc({ securityPct: 10, guaranteeRatePct: 10, days: 365, antiDumping: true }));
  assert.equal(floor.kind, "antiDumping");
  assert.equal(floor.price, 515_000);
  const at = floor.at(floor.price);
  assert.equal(at.raised, true);
  near(at.security, 150_000);
  near(at.securityPct, 15);
  near(at.profit, 0);
});

test("повышенное обеспечение — не меньше 10 % (ч. 1 ст. 37)", () => {
  const floor = floorOf(calc({ securityPct: 2, guaranteeRatePct: 10, days: 365, antiDumping: true }));
  assert.equal(floor.kind, "antiDumping");
  assert.equal(floor.price, 510_000);
  near(floor.at(floor.price).securityPct, 10);
  // Без снижения на 25 % — обычные 2 %.
  near(floor.at(800_000).securityPct, 2);
});

test("повышенное обеспечение уводит в убыток — нижняя цена на копейку выше трёх четвертей начальной", () => {
  const c = calc({ costs: 600_000, securityPct: 30, method: "money", moneyRatePct: 50, days: 365, antiDumping: true });
  const floor = floorOf(c);
  assert.equal(floor.kind, "threshold");
  assert.equal(floor.price, 750_000.01);
  assert.equal(floor.at(750_000.01).raised, false);
  assert.ok(floor.at(750_000.01).profit >= 0);
  assert.equal(floor.at(750_000).raised, true);
  assert.ok(floor.at(750_000).profit < 0);
});

test("граница 25 % — в копейках, и для начальной цены с копейками", () => {
  const { at, raisedBelow } = priceFloor(calc({ nmck: 685_000.01, securityPct: 5, antiDumping: true }));
  assert.equal(at(513_750)!.raised, true);
  assert.equal(at(513_750.01)!.raised, false);
  assert.equal(raisedBelow, 513_750);
});

test("добросовестность заменяет повышенное обеспечение только до 15 млн (ч. 1–3 ст. 37)", () => {
  const small = calc({ costs: 600_000, securityPct: 30, method: "money", moneyRatePct: 50, days: 365, antiDumping: true, goodFaith: true });
  const floor = floorOf(small);
  assert.equal(floor.kind, "plain");
  assert.equal(floor.price, 750_000);
  assert.equal(floor.at(floor.price).raised, false);
  assert.equal(priceFloor(small).raisedBelow, null);

  const big = calc({ ...small, nmck: 20_000_000, costs: 12_000_000 });
  const bigFloor = floorOf(big);
  assert.equal(bigFloor.kind, "threshold");
  assert.equal(bigFloor.price, 15_000_000.01);
});

test("освобождение от обеспечения в закупке у малого бизнеса (ч. 8.1 ст. 96)", () => {
  const exempt = floorOf(calc({ costs: 470_000, taxPct: 6, securityPct: 30, smeOnly: true, exempt: true, guaranteeRatePct: 50, days: 365, antiDumping: true }));
  assert.equal(exempt.kind, "plain");
  assert.equal(exempt.price, 500_000);
  assert.equal(exempt.at(exempt.price).security, 0);
  // Вне закупки у малого бизнеса освобождения нет.
  const common = floorOf(calc({ costs: 470_000, taxPct: 6, securityPct: 30, exempt: true, guaranteeRatePct: 50, days: 365 }));
  assert.ok(common.price > 500_000);
});

test("без обеспечения антидемпинговые меры на цену не влияют", () => {
  const floor = floorOf(calc({ costs: 300_000, antiDumping: true }));
  assert.equal(floor.kind, "plain");
  assert.equal(floor.price, 300_000);
  assert.equal(priceFloor(calc({ costs: 300_000, antiDumping: true })).raisedBelow, null);
});

test("убыток даже по начальной цене, нет цены без убытка, не хватает данных", () => {
  assert.equal(floorOf(calc({ costs: 1_200_000 })).aboveNmck, true);
  assert.deepEqual(priceFloor(calc({ taxPct: 100 })).floor, { ok: false, reason: "impossible" });
  assert.deepEqual(priceFloor(calc({ costs: null })).floor, { ok: false, reason: "input" });
  assert.deepEqual(priceFloor(calc({ nmck: null })).floor, { ok: false, reason: "input" });
  assert.equal(priceFloor(calc({ costs: null })).at(100), null);
});

const item = (text: string, quote = "") => ({ text, quote });

test("процент обеспечения и закупка у малого бизнеса — из требований", () => {
  const sample = readRequirements({
    kind: "44-ФЗ · электронный конкурс",
    requirements: {
      who: [
        item(
          "Только для малого бизнеса и социально ориентированных НКО",
          "Закупка осуществляется у субъектов малого предпринимательства, социально ориентированных некоммерческих организаций."
        ),
      ],
      terms: [
        item("Обеспечение заявки — 6 850 ₽ (1% начальной цены)", "Размер обеспечения заявки: 1% от начальной (максимальной) цены контракта — 6 850,00 руб."),
        item(
          "Обеспечение исполнения контракта — 5% от цены контракта (от начальной цены это 34 250 ₽)",
          "Размер обеспечения исполнения контракта: 5% от цены контракта."
        ),
      ],
    },
  });
  assert.deepEqual(sample, {
    securityPct: 5,
    securityLine: "Обеспечение исполнения контракта — 5% от цены контракта (от начальной цены это 34 250 ₽)",
    smeOnly: true,
  });

  const read = (text: string) => readRequirements({ kind: "", requirements: { terms: [item(text)] } });
  assert.deepEqual(read("Обеспечение исполнения — 10% от начальной (максимальной) цены контракта"), {
    securityPct: 10,
    securityLine: "Обеспечение исполнения — 10% от начальной (максимальной) цены контракта",
    smeOnly: false,
  });
  assert.equal(read("Размер обеспечения исполнения контракта 0,5 %").securityPct, 0.5);
  assert.equal(read("Обеспечение исполнения контракта (п. 11 извещения): 34 250 руб. (5%)").securityPct, 5);
  assert.equal(read("Обеспечение исполнения контракта от цены контракта — 5 %").smeOnly, true);
  assert.equal(read("Обеспечение исполнения контракта не требуется, обеспечение заявки — 1%").securityPct, null);
  assert.equal(read("Обеспечение исполнения — по проекту контракта. Аванс 30%").securityPct, null);
  assert.equal(read("Обеспечение гарантийных обязательств — 1%").securityPct, null);
});

test("антидемпинг — на конкурсе и аукционе по 44-ФЗ", () => {
  assert.equal(antiDumpingApplies("44-ФЗ · электронный конкурс"), true);
  assert.equal(antiDumpingApplies("44-ФЗ · электронный аукцион"), true);
  assert.equal(antiDumpingApplies("44-ФЗ · запрос котировок в электронной форме"), false);
  assert.equal(antiDumpingApplies("223-ФЗ · запрос предложений"), false);
  assert.equal(antiDumpingApplies(""), true);
});

test("что подставляется из закупки", () => {
  const defaults = defaultsFor(
    { kind: "44-ФЗ · электронный аукцион", tpPrice: 600_000, requirements: { terms: [item("Обеспечение исполнения контракта — 5%")] } },
    685_000
  );
  assert.equal(defaults.nmck, 685_000);
  assert.equal(defaults.securityPct, 5);
  assert.equal(defaults.smeOnly, false);
  assert.equal(defaults.antiDumping, true);
  assert.equal(defaults.price, 600_000);
  assert.equal(defaults.costs, null);
});
