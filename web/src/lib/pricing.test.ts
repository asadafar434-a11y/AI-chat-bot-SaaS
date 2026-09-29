// Цены сервиса: заявка, пакеты заявок со скидкой за объём, специалист и пересчёты — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PLANS, PRICE_APP, PRICE_EXPERT, RECHECK_PACK } from "./pricing.ts";

test("заявка — 1000 ₽, специалист — 500 ₽, ещё 3 пересчёта — 99 ₽", () => {
  assert.equal(PRICE_APP, 1000);
  assert.equal(PRICE_EXPERT, 500);
  assert.deepEqual(RECHECK_PACK, { count: 3, price: 99 });
});

test("пакеты: 1 заявка по полной цене, 5 — минус 10 %, 10 — минус 20 %", () => {
  assert.deepEqual(
    PLANS.map(({ count, price, perApp, saving }) => [count, price, perApp, saving]),
    [
      [1, 1000, 1000, 0],
      [5, 4500, 900, 500],
      [10, 8000, 800, 2000],
    ]
  );
});
