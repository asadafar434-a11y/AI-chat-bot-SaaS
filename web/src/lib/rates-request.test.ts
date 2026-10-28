// Запрос «найти зарплаты и аренду» (/api/rates): разбор тела и поисковые слова — npm test (без сети).
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_RATE_ITEMS, parseRatesRequest, rateQueries } from "./rates-request.ts";

const item = (over: Record<string, unknown> = {}) => ({ key: "role-1", kind: "salary", subject: "Кладовщик", region: "Тверская область", ...over });

test("запрос: нормальные позиции читаются, лишние пробелы и пустой регион чистятся", () => {
  const r = parseRatesRequest({ items: [item({ subject: "  Водитель   погрузчика ", region: "  " }), item({ key: "tech-1", kind: "rent", subject: "Ричтрак" })] });
  assert.ok(r.ok);
  assert.deepEqual(r.value.items.map((i) => [i.key, i.kind, i.subject, i.region]), [
    ["role-1", "salary", "Водитель погрузчика", null],
    ["tech-1", "rent", "Ричтрак", "Тверская область"],
  ]);
});

test("запрос: пусто, больше предела, чужой вид, короткое название, нет ключа — отказ словами", () => {
  assert.match((parseRatesRequest({ items: [] }) as { error: string }).error, /Нет позиций/);
  assert.match((parseRatesRequest({}) as { error: string }).error, /Нет позиций/);
  assert.match((parseRatesRequest(null) as { error: string }).error, /Нет позиций/);
  const many = Array.from({ length: MAX_RATE_ITEMS + 1 }, (_, i) => item({ key: `k${i}` }));
  assert.match((parseRatesRequest({ items: many }) as { error: string }).error, /не больше 4/);
  for (const bad of [item({ kind: "bonus" }), item({ subject: "ab" }), item({ key: "" }), null]) {
    assert.match((parseRatesRequest({ items: [bad] }) as { error: string }).error, /Позиция описана неверно/);
  }
});

test("поисковые слова: зарплата и аренда строятся из должности, региона и года; в запросах нет почты и длинных чисел", () => {
  const salary = rateQueries({ kind: "salary", subject: "Кладовщик", region: "Торжок" }, 2026);
  assert.ok(salary.some((q) => /зарплата Кладовщик Торжок 2026/.test(q)));
  assert.ok(salary.some((q) => /Кладовщик вакансии Торжок зарплата/.test(q)));
  const rent = rateQueries({ kind: "rent", subject: "Ричтрак", region: null }, 2026);
  assert.ok(rent.some((q) => /аренда Ричтрак цена в месяц/.test(q)));
  assert.ok(rent.every((q) => !/Торжок|2026/.test(q)), "без региона регион не выдумывается");
  const dirty = rateQueries({ kind: "salary", subject: "ivan@mail.ru 89001234567", region: null }, 2026);
  assert.ok(dirty.every((q) => !/@|\d{7,}/.test(q)), "почта и длинные числа в поиск не уходят");
});
