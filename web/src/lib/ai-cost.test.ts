// Стоимость запросов к ИИ, бюджет заявки и склейка одинаковых запросов — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AI_LIMITS, costUsd, recheckState, regenerationNeedsConfirm, rubOf, usdText } from "./ai-cost.ts";
import { createBudget, createDedup, requestKey } from "./ai-meter.ts";

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test("стоимость ответа Opus 5.5: вход, выход, чтение и запись кеша по сроку", () => {
  // 100 тыс. входа × $4 + 10 тыс. выхода × $20 + 50 тыс. из кеша × $0,20 + 20 тыс. в часовой кеш × $8 + 4 тыс. в 5-минутный × $5.
  const { usd, known } = costUsd("claude-opus-5-5", {
    input_tokens: 100_000,
    output_tokens: 10_000,
    cache_read_input_tokens: 50_000,
    cache_creation_input_tokens: 24_000,
    cache_creation: { ephemeral_1h_input_tokens: 20_000, ephemeral_5m_input_tokens: 4_000 },
  });
  assert.equal(known, true);
  near(usd, 0.4 + 0.2 + 0.01 + 0.16 + 0.02);
});

test("запись в кеш без разбивки по сроку считается по цене часового — не недосчитываем", () => {
  const { usd } = costUsd("claude-opus-5-5", { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 });
  near(usd, 8);
});

test("незнакомая модель — по самой дорогой из известных", () => {
  const unknown = costUsd("claude-new-model", { input_tokens: 1_000_000, output_tokens: 0 });
  assert.equal(unknown.known, false);
  near(unknown.usd, 10);
});

test("рубли — по курсу из настроек, до копеек; доллары — коротко", () => {
  assert.equal(rubOf(2, 91.5), 183);
  assert.equal(rubOf(0.1, 90), 9);
  assert.equal(usdText(1.5), "$1.50");
  assert.equal(usdText(0.0042), "$0.0042");
});

test("пересчёт проверки — 3 раза на заявку, новая версия документов после третьей — с подтверждением", () => {
  assert.equal(AI_LIMITS.rechecks, 3);
  assert.deepEqual(recheckState(0), { left: 3, allowed: true, total: 3 });
  assert.deepEqual(recheckState(3), { left: 0, allowed: false, total: 3 });
  assert.deepEqual(recheckState(7), { left: 0, allowed: false, total: 3 });
  assert.equal(regenerationNeedsConfirm(2), false);
  assert.equal(regenerationNeedsConfirm(3), true);
});

test("пересчёты кончились — пакет «ещё 3 за 99 ₽» добавляет три", () => {
  assert.deepEqual(recheckState(3, 1), { left: 3, allowed: true, total: 6 });
  assert.deepEqual(recheckState(5, 1), { left: 1, allowed: true, total: 6 });
  assert.deepEqual(recheckState(6, 1), { left: 0, allowed: false, total: 6 });
  assert.deepEqual(recheckState(6, 2), { left: 3, allowed: true, total: 9 });
});

test("бюджет заявки: списывается по заявке, кончился — ноль, давнюю заявку счётчик забывает", () => {
  let t = 0;
  const day = 24 * 60 * 60 * 1000;
  const budget = createBudget(2, 30 * day, () => t);
  budget.charge("a", 1.5);
  assert.equal(budget.left("a"), 0.5);
  assert.equal(budget.left("b"), 2);
  budget.charge("a", 1);
  assert.equal(budget.left("a"), 0);
  assert.equal(budget.spent("a"), 2.5);
  // Отрицательная стоимость не возвращает бюджет.
  budget.charge("a", -5);
  assert.equal(budget.spent("a"), 2.5);
  t += 31 * day;
  assert.equal(budget.left("a"), 2);
});

test("одинаковые одновременные запросы ждут один ответ, после ответа ключ забывается", async () => {
  const dedup = createDedup();
  let calls = 0;
  let release: (v: string) => void = () => {};
  const work = () => {
    calls++;
    return new Promise<string>((resolve) => (release = resolve));
  };
  const first = dedup.run("k", work);
  const second = dedup.run("k", work);
  assert.equal(first.shared, false);
  assert.equal(second.shared, true);
  release("ответ");
  assert.equal(await first.promise, "ответ");
  assert.equal(await second.promise, "ответ");
  assert.equal(calls, 1);
  assert.equal(dedup.size(), 0);
  const third = dedup.run("k", async () => "новый");
  assert.equal(third.shared, false);
  assert.equal(await third.promise, "новый");
});

test("ошибка первого запроса достаётся и склеенному, ключ освобождается", async () => {
  const dedup = createDedup();
  const first = dedup.run("k", async () => {
    throw new Error("сбой");
  });
  const second = dedup.run("k", async () => "не должен вызваться");
  await assert.rejects(first.promise, /сбой/);
  await assert.rejects(second.promise, /сбой/);
  assert.equal(dedup.size(), 0);
});

test("отпечаток запроса: одинаковое — одинаково, любое отличие — другое", () => {
  const a = requestKey({ docs: ["ТЗ"], task: "требования" });
  assert.equal(a, requestKey({ docs: ["ТЗ"], task: "требования" }));
  assert.notEqual(a, requestKey({ docs: ["ТЗ "], task: "требования" }));
  assert.notEqual(a, requestKey({ docs: ["ТЗ"], task: "ТП" }));
});
