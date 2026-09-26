// Проверка шкалы цены: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Floor } from "./price-floor.ts";
import { scaleModel } from "./price-scale.ts";

const floorAt = (price: number, aboveNmck = false): Floor => ({ ok: true, price, kind: "plain", aboveNmck });
const near = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test("шкала — от начальной цены до нижней с запасом, шагами по 10 %", () => {
  // Пример из закупки: нижняя цена на 34,4 % ниже начальной, антидемпинг — с 25 %.
  const m = scaleModel(685_000, floorAt(449_289.74), 513_750);
  assert.equal(m.hi, 685_000);
  assert.equal(m.lo, 411_000);
  assert.equal(m.step, 1_000);
  assert.equal(m.loss, "part");
  near(m.floorX, ((449_289.74 - 411_000) / 274_000) * 100);
  near(m.raisedX, 37.5);
  assert.deepEqual(
    m.ticks.map((t) => t.label),
    ["−40\u00a0%", "−30\u00a0%", "−20\u00a0%", "−10\u00a0%", "начальная"]
  );
  assert.equal(m.ticks[0].x, 0);
  assert.equal(m.ticks[4].x, 100);
});

test("шкала — не короче 30 % и не длиннее 90 %", () => {
  assert.equal(scaleModel(685_000, floorAt(650_000), null).lo, 479_000);
  // Граница антидемпинга всегда на шкале: 25 % и запас — до −30 %.
  assert.equal(scaleModel(685_000, floorAt(650_000), 513_750).lo, 479_000);
  const deep = scaleModel(685_000, floorAt(150_000), null);
  assert.equal(deep.lo, 68_000);
  assert.deepEqual(
    deep.ticks.map((t) => t.label),
    ["−80\u00a0%", "−60\u00a0%", "−40\u00a0%", "−20\u00a0%", "начальная"]
  );
});

test("ползунок — по шагу и в пределах шкалы", () => {
  const m = scaleModel(685_000, floorAt(449_289.74), 513_750);
  assert.equal(m.priceAt(0), 411_000);
  assert.equal(m.priceAt(100), 685_000);
  assert.equal(m.priceAt(50), 548_000);
  assert.equal(m.priceAt(50.1), 548_000);
  assert.equal(m.x(1_000_000), 100);
  assert.equal(m.x(1), 0);
});

test("убыток по любой цене, нигде, не посчитан", () => {
  const all = scaleModel(685_000, floorAt(700_000, true), null);
  assert.equal(all.loss, "all");
  assert.equal(all.floorX, null);
  assert.equal(scaleModel(685_000, floorAt(100_000), null).loss, "part");
  // Нижняя цена левее края шкалы — на шкале убытка нет.
  assert.equal(scaleModel(685_000, floorAt(10_000), null).loss, "none");
  const unknown = scaleModel(685_000, { ok: false, reason: "input" }, null);
  assert.equal(unknown.loss, "unknown");
  assert.equal(unknown.raisedX, null);
});
