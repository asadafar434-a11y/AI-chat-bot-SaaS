// Лимиты частоты запросов — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { clientIp, createLimiter, waitText } from "./rate-limit.ts";

const clock = (start = 0) => {
  let t = start;
  return { now: () => t, pass: (ms: number) => (t += ms) };
};

test("в пределах окна — пропускает, сверх — называет, через сколько секунд", () => {
  const c = clock();
  const take = createLimiter([{ max: 3, ms: 60_000 }], c.now);
  assert.equal(take("a"), 0);
  c.pass(10_000);
  assert.equal(take("a"), 0);
  assert.equal(take("a"), 0);
  // Самый ранний запрос выйдет из окна через 50 секунд.
  assert.equal(take("a"), 50);
  // Отказ не занимает место.
  c.pass(50_000);
  assert.equal(take("a"), 0);
});

test("адреса считаются отдельно", () => {
  const take = createLimiter([{ max: 1, ms: 60_000 }], clock().now);
  assert.equal(take("a"), 0);
  assert.ok(take("a") > 0);
  assert.equal(take("b"), 0);
});

test("действует самое строгое окно: 2 за минуту и 3 за сутки", () => {
  const c = clock();
  const take = createLimiter([{ max: 2, ms: 60_000 }, { max: 3, ms: 86_400_000 }], c.now);
  assert.equal(take("a"), 0);
  assert.equal(take("a"), 0);
  assert.equal(take("a"), 60);
  c.pass(60_000);
  assert.equal(take("a"), 0);
  c.pass(60_000);
  // Суточный лимит исчерпан: первый запрос выйдет из суток через 24 ч минус 2 мин.
  assert.equal(take("a"), 86_400 - 120);
});

test("запрос с весом: страницы скана считаются поштучно", () => {
  const take = createLimiter([{ max: 10, ms: 60_000 }], clock().now);
  assert.equal(take("all", 6), 0);
  assert.ok(take("all", 5) > 0);
  assert.equal(take("all", 4), 0);
  // Больше, чем влезает в окно вообще, — ждать полное окно.
  assert.equal(createLimiter([{ max: 10, ms: 60_000 }], clock().now)("all", 11), 60);
});

test("адрес клиента — последний в X-Forwarded-For", () => {
  assert.equal(clientIp("1.1.1.1, 10.0.0.2"), "10.0.0.2");
  assert.equal(clientIp(" 5.5.5.5 "), "5.5.5.5");
  assert.equal(clientIp(null), "unknown");
  assert.equal(clientIp(""), "unknown");
});

test("сколько ждать — по-русски", () => {
  assert.equal(waitText(5), "через минуту");
  assert.equal(waitText(61), "через 2 мин");
  assert.equal(waitText(7200), "через 2 ч");
});
