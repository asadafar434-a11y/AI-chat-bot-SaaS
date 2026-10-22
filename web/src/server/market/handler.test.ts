// Маршрут «рыночный ориентир»: доступ, проверка запроса, статистика по накопленным ценам, отказ без базы — npm test. База заменена памятью.
import assert from "node:assert/strict";
import { test } from "node:test";
import { makeObservation, type Observation } from "../../lib/market-observations.ts";
import { createMemoryMarketStore } from "../../lib/market-store.ts";
import { handleMarket, type MarketDeps } from "./handler.ts";

const NOW = new Date("2026-10-22T09:00:00Z");
const post = (body: unknown) => new Request("http://localhost/api/market", { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

const obs = (name: string, price: number, date: string, over: Record<string, unknown> = {}): Observation => {
  const built = makeObservation({ name, unit: "т", price, vat: "without", vatRate: 22, date, source: `прайс поставщика № ${Math.round(price)}${date}`, sourceKind: "price_list", ...over });
  assert.ok(built.ok);
  return built.value;
};

async function deps(items: Observation[], over: Partial<MarketDeps> = {}): Promise<MarketDeps> {
  const store = createMemoryMarketStore();
  await store.ingest(items, "test");
  return { authorize: async () => null, hasDatabase: () => true, getStore: () => store, now: () => NOW, ...over };
}

const COAL = [5000, 5100, 5200, 4900, 5050].map((p, i) => obs("Уголь каменный ДПК", p, `2026-0${i + 4}-15`));

test("считает рыночный ориентир по сопоставимым ценам: число цен, медиана, диапазон и аналоги для расчёта РИЦ; несопоставимое не попадает", async () => {
  const res = await handleMarket(post({ positions: [{ key: "coal", name: "Уголь каменный ДПК", unit: "тонна", quantity: 1500, region: "Севастополь" }] }), await deps([...COAL, obs("Сахар песок", 60, "2026-09-01")]));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.asOf, "2026-10-22");
  assert.equal(json.total, 6);
  const r = json.results[0];
  assert.equal(r.key, "coal");
  assert.equal(r.stats.status, "ok");
  assert.equal(r.stats.n, 5);
  assert.equal(r.stats.median, 5050);
  assert.deepEqual(r.stats.range, { from: 4900, to: 5200 });
  assert.equal(r.analogs.length, 5);
  assert.ok(r.analogs.every((a: { vat: string; source: string }) => a.vat === "without" && a.source.startsWith("База цен: прайс поставщика №")));
  assert.equal(new Set(r.analogs.map((a: { id: string }) => a.id)).size, 5, "у аналогов разные номера");
});

test("мало цен в базе — «недостаточно данных» с причиной, чисел нет и аналогов ровно столько, сколько нашлось", async () => {
  const res = await handleMarket(post({ positions: [{ key: "coal", name: "Уголь каменный ДПК", unit: "т" }] }), await deps(COAL.slice(0, 2)));
  const r = (await res.json()).results[0];
  assert.equal(r.stats.status, "insufficient");
  assert.equal(r.stats.median, null);
  assert.match(r.stats.missing[0], /нужно не меньше 5 сопоставимых цен за 365 дней, найдено 2/);
  assert.equal(r.analogs.length, 2);
});

test("пустая база и позиция, которой в базе нет: ответ 200 с «недостаточно данных», а не ошибка", async () => {
  const res = await handleMarket(post({ positions: [{ key: "x", name: "Бетон М300", unit: "м3" }] }), await deps([]));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.total, 0);
  assert.equal(json.results[0].stats.status, "insufficient");
});

test("дата расчёта из запроса: цены позже неё в расчёт не идут", async () => {
  const res = await handleMarket(post({ positions: [{ key: "coal", name: "Уголь каменный ДПК", unit: "т" }], onDate: "2026-06-01" }), await deps(COAL));
  const r = (await res.json()).results[0];
  assert.equal(r.stats.n, 2, "к 1 июня подходят только апрельская и майская цены — их меньше пяти");
  assert.equal(r.stats.status, "insufficient");
});

test("без входа — отказ, в базу не смотрим; кривой запрос — 400; без базы — 503 с понятным текстом", async () => {
  let asked = false;
  const store = createMemoryMarketStore();
  const original = store.candidates;
  store.candidates = async (q) => ((asked = true), original(q));
  const denied = await handleMarket(post({ positions: [{ name: "Уголь" }] }), await deps([], { authorize: async () => new Response("Требуется вход", { status: 401 }), getStore: () => store }));
  assert.equal(denied.status, 401);
  assert.equal(asked, false);
  assert.equal((await handleMarket(post({ positions: [] }), await deps([]))).status, 400);
  assert.equal((await handleMarket(post("{не json"), await deps([]))).status, 400);
  const noDb = await handleMarket(post({ positions: [{ name: "Уголь ДПК" }] }), await deps([], { hasDatabase: () => false }));
  assert.equal(noDb.status, 503);
  assert.match(await noDb.text(), /База цен не подключена/);
});

test("сбой базы — 503 без подробностей: ни строки подключения, ни текста запроса в ответе", async () => {
  const broken = { ingest: async () => ({ added: 0, skipped: 0 }), count: async () => 0, candidates: async () => Promise.reject(new Error("connect ECONNREFUSED postgresql://user:secret@host/db")) };
  const logs: unknown[][] = [];
  const log = console.error;
  console.error = (...args: unknown[]) => void logs.push(args);
  try {
    const res = await handleMarket(post({ positions: [{ name: "Уголь ДПК", unit: "т" }] }), await deps([], { getStore: () => broken }));
    assert.equal(res.status, 503);
    const body = await res.text();
    assert.match(body, /База цен сейчас недоступна/);
    assert.equal(/secret|postgresql/.test(body), false);
  } finally {
    console.error = log;
  }
});
