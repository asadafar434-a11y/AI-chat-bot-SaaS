import assert from "node:assert/strict";
import { test } from "node:test";
import { matchProduct, type OfferedSpec } from "./product-match.ts";
import type { ReqItem } from "./requirements.ts";

function req(text: string, overrides: Partial<ReqItem> = {}): ReqItem {
  return {
    text,
    type: "product",
    mandatory: "required",
    quote: text,
    verified: true,
    article: null,
    numbers: [],
    criteria: null,
    how: null,
    proof: null,
    deadline: null,
    conditions: [],
    ...overrides,
  } as unknown as ReqItem;
}

test("нет данных о товаре → unknown", () => {
  const result = matchProduct([], [req("Гарантия не менее 24 месяцев")]);
  assert.equal(result.matches[0]!.status, "unknown");
  assert.equal(result.unknownCount, 1);
});

test("числовое: предложено больше минимума → pass", () => {
  const offered: OfferedSpec[] = [{ name: "Гарантия", value: "36 месяцев" }];
  const r = req("Гарантия не менее 24 месяцев", {
    numbers: [{ what: "гарантия", op: "min", value: 24, parts: [] }],
  } as unknown as Partial<ReqItem>);
  const result = matchProduct(offered, [r]);
  assert.equal(result.matches[0]!.status, "pass");
});

test("числовое: предложено меньше минимума → fail", () => {
  const offered: OfferedSpec[] = [{ name: "Гарантия", value: "12 месяцев" }];
  const r = req("Гарантия не менее 24 месяцев", {
    numbers: [{ what: "гарантия", op: "min", value: 24, parts: [] }],
  } as unknown as Partial<ReqItem>);
  const result = matchProduct(offered, [r]);
  assert.equal(result.matches[0]!.status, "fail");
  assert.ok(result.matches[0]!.detail?.includes("НЕ СООТВЕТСТВУЕТ"));
});

test("текстовое: точное совпадение → pass", () => {
  const offered: OfferedSpec[] = [{ name: "Страна производства", value: "Россия" }];
  const r = req("Страна происхождения товара: Россия");
  const result = matchProduct(offered, [r]);
  assert.equal(result.matches[0]!.status, "pass");
});

test("нет требований к продукту → пустой результат, score 100", () => {
  const result = matchProduct([{ name: "IP", value: "IP54" }], [req("Опыт участника", { type: "participant" } as unknown as Partial<ReqItem>)]);
  assert.equal(result.matches.length, 0);
  assert.equal(result.score, 100);
});

test("overallStatus: есть fail → issues", () => {
  const offered: OfferedSpec[] = [{ name: "Гарантия", value: "6 месяцев" }];
  const r = req("Гарантия не менее 24 месяцев", {
    numbers: [{ what: "гарантия", op: "min", value: 24, parts: [] }],
  } as unknown as Partial<ReqItem>);
  const result = matchProduct(offered, [r]);
  assert.equal(result.overallStatus, "issues");
});

test("score: 1 pass из 2 → 50", () => {
  const offered: OfferedSpec[] = [
    { name: "Гарантия", value: "36 месяцев" },
  ];
  const reqs = [
    req("Гарантия не менее 24 месяцев", {
      numbers: [{ what: "гарантия", op: "min", value: 24, parts: [] }],
    } as unknown as Partial<ReqItem>),
    req("Сертификат ISO 9001"), // unknown — нет данных
  ];
  const result = matchProduct(offered, reqs);
  assert.ok(result.score >= 25 && result.score <= 75);
});
