// Поиск зарплат и аренды: страницы из поиска, чтение моделью с потолком расходов, проверка кодом, порции по позициям — npm test (поиск, сеть и модель подставлены, денег нет).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CollectDeps, SearchHit } from "../market/collect.ts";
import { collectRates } from "./collect-rates.ts";
import { handleRates, type RatesDeps } from "./rates-handler.ts";

const hit = (domain: string, n = 1): SearchHit => ({ title: `Зарплата ${domain}`, url: `https://${domain}/p${n}`, domain, snippet: "" });
const page = (salary: string) => `<html><head><title>Зарплата кладовщика — вакансии</title></head><body><h1>Кладовщик в Торжке</h1><p>Кладовщик — зарплата ${salary} на руки. График 2/2, склад в Торжке, официальное оформление.</p><p>Звоните нам, чтобы узнать подробности и условия работы на складе.</p></body></html>`;
const WANTED = { kind: "salary" as const, subject: "Кладовщик", region: "Торжок" };
const answerFor = (amount: number, over: Record<string, unknown> = {}) =>
  JSON.stringify({ rates: [{ subject: "Кладовщик", min: null, max: null, average: amount, period: "month", tax: "net", region: "Торжок", quote: `Кладовщик — зарплата ${amount.toLocaleString("ru-RU")} ₽ на руки.`, ...over }] });

function deps(pages: Record<string, string>, over: Partial<CollectDeps> = {}): { d: CollectDeps; asked: string[] } {
  const asked: string[] = [];
  const d: CollectDeps = {
    search: async () => [hit("a.ru"), hit("b.ru"), hit("youtube.com"), hit("a.ru", 2)],
    fetchPage: async (url) => (pages[url] ? { ok: true, html: pages[url], finalUrl: url } : { ok: false, error: "ответ 404" }),
    ask: async (_s, user) => {
      asked.push(user);
      const amount = Number(/зарплата ([\d\s ]+) ₽/.exec(user)?.[1].replace(/\s/g, "") ?? "0");
      return { text: answerFor(amount), usd: 0.005 };
    },
    worstCaseRub: () => 1,
    usdRub: 90,
    today: () => "2026-10-27",
    ...over,
  };
  return { d, asked };
}
const PAGES = { "https://a.ru/p1": page("60 000 ₽"), "https://b.ru/p1": page("72 000 ₽") };

test("страницы с зарплатами читаются по одной с сайта, видео пропускается; запись проходит проверку и приводится к «до налогов»; расход считается в рублях", async () => {
  const { d, asked } = deps(PAGES);
  const r = await collectRates(d, { wanted: WANTED, queries: ["q"], maxPages: 3, capRub: 10 });
  assert.deepEqual(r.pages.map((p) => p.domain), ["a.ru", "b.ru"]);
  assert.equal(asked.length, 2);
  assert.deepEqual(r.accepted.map((o) => o.monthly).sort((a, b) => a - b), [Math.round(60000 / 0.87), Math.round(72000 / 0.87)]);
  assert.equal(r.accepted[0].regionMatch, "same");
  assert.equal(r.spentRub, 0.9, "два вызова по 0,005 $ × 90");
  assert.equal(r.stoppedByCap, false);
});

test("потолок: следующий вызов в худшем случае выходит за потолок — сбор останавливается до вызова", async () => {
  const { d, asked } = deps(PAGES, { worstCaseRub: () => 3.5 });
  // Первый вызов: 0 + 3,5 ≤ 3,6 — можно; второй: 0,45 + 3,5 > 3,6 — нельзя.
  const r = await collectRates(d, { wanted: WANTED, queries: ["q"], maxPages: 3, capRub: 3.6 });
  assert.equal(asked.length, 1);
  assert.equal(r.stoppedByCap, true);
  assert.match(r.pages.at(-1)!.skipReason!, /остановлено/);
});

test("модель выписала чужое: цитата не со страницы, не та должность — отклонено с причиной и в расчёт не идёт; страница без цифр модели не уходит; «цена по запросу» названа", async () => {
  const bad = deps(PAGES, { ask: async () => ({ text: answerFor(60000, { quote: "Кладовщик — зарплата 61 000 ₽ на руки." }), usd: 0.005 }) });
  const r1 = await collectRates(bad.d, { wanted: WANTED, queries: ["q"], maxPages: 3, capRub: 10 });
  assert.equal(r1.accepted.length, 0);
  assert.deepEqual([...new Set(r1.rejected.map((x) => x.reason))], ["цитаты нет на странице"]);
  const empty = deps({ "https://a.ru/p1": "<html><head><title>Вакансии</title></head><body><h1>Кладовщик</h1><p>Стоимость и зарплата — по запросу, звоните нам в любое время суток, мы всё расскажем и покажем.</p></body></html>", "https://b.ru/p1": "<html><body><p>Описание склада без каких-либо цифр: просто длинный текст про склад и график работы персонала на объекте.</p></body></html>" });
  const r2 = await collectRates(empty.d, { wanted: WANTED, queries: ["q"], maxPages: 3, capRub: 10 });
  assert.equal(empty.asked.length, 0, "платная модель страницы без цифр не читает");
  assert.deepEqual(r2.pages.map((p) => p.skipReason), ["цена по запросу", "на странице нет цифр"]);
});

// ——— Маршрут ———
const post = (body: unknown) => new Request("http://localhost/api/rates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const item = (n: number) => ({ key: `role-${n}`, kind: "salary", subject: "Кладовщик", region: "Торжок" });

function routeDeps(over: Partial<RatesDeps> = {}): { d: RatesDeps; asked: string[] } {
  const base = deps(PAGES);
  const d: RatesDeps = {
    authorize: async () => null,
    aiAvailable: () => true,
    budgetOver: async () => false,
    appIdOf: () => "purchase-1",
    search: base.d.search,
    fetchPage: base.d.fetchPage,
    ask: async (system, user) => base.d.ask(system, user),
    worstCaseRub: () => 1,
    usdRub: 90,
    capRub: 15,
    budgetText: "Бюджет закупки исчерпан",
    now: () => new Date("2026-10-27T09:00:00Z"),
    ...over,
  };
  return { d, asked: base.asked };
}

test("маршрут: порция из позиций → результаты по ключам с находками, расходом и днём; в поиск уходят только должность и регион", async () => {
  const searched: string[] = [];
  const { d } = routeDeps({ search: async (q) => (searched.push(q), [hit("a.ru"), hit("b.ru")]) });
  const res = await handleRates(post({ items: [item(1), { key: "tech-1", kind: "rent", subject: "Ричтрак", region: "Тверская область" }] }), d);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { asOf: string; spentRub: number; results: { key: string; kind: string; observations: unknown[]; pagesRead: number }[] };
  assert.equal(body.asOf, "2026-10-27");
  assert.deepEqual(body.results.map((r) => r.key), ["role-1", "tech-1"]);
  assert.equal(body.results[0].observations.length, 2);
  assert.equal(body.results[1].observations.length, 0, "на этих страницах про ричтрак ничего нет");
  assert.ok(searched.some((q) => /зарплата Кладовщик Торжок 2026/.test(q)));
  assert.ok(searched.some((q) => /аренда Ричтрак цена в месяц Тверская область/.test(q)));
  assert.ok(searched.every((q) => !/@|\d{7,}/.test(q)), "в запросах нет почты и длинных чисел");
});

test("маршрут: без входа — отказ; кривой запрос — 400; больше четырёх позиций — 400; ИИ выключен — 503; нет курса — 503; бюджет закупки исчерпан — 402 без поиска", async () => {
  assert.equal((await handleRates(post({ items: [item(1)] }), routeDeps({ authorize: async () => new Response("Требуется вход", { status: 401 }) }).d)).status, 401);
  assert.equal((await handleRates(post({ items: [] }), routeDeps().d)).status, 400);
  assert.equal((await handleRates(post({ items: [{ key: "x", kind: "bonus", subject: "Кладовщик" }] }), routeDeps().d)).status, 400);
  assert.equal((await handleRates(post({ items: [1, 2, 3, 4, 5].map(item) }), routeDeps().d)).status, 400);
  assert.equal((await handleRates(post({ items: [item(1)] }), routeDeps({ aiAvailable: () => false }).d)).status, 503);
  assert.equal((await handleRates(post({ items: [item(1)] }), routeDeps({ usdRub: 0 }).d)).status, 503);
  let searched = 0;
  const over = await handleRates(post({ items: [item(1)] }), routeDeps({ budgetOver: async () => true, search: async () => (searched++, []) }).d);
  assert.equal(over.status, 402);
  assert.equal(searched, 0);
});

test("маршрут: общий потолок на порцию — когда он выбран, остальные позиции без поиска, потрачено не больше потолка", async () => {
  const { d } = routeDeps({ capRub: 1.5, worstCaseRub: () => 1 });
  const res = await handleRates(post({ items: [item(1), item(2), item(3)] }), d);
  const body = (await res.json()) as { spentRub: number; stoppedByCap: boolean; results: { key: string; observations: unknown[] }[] };
  assert.ok(body.spentRub <= 1.5, `потрачено ${body.spentRub} ₽`);
  assert.equal(body.stoppedByCap, true);
  assert.deepEqual(body.results.map((r) => r.key), ["role-1", "role-2", "role-3"], "по каждой позиции есть запись, даже если поиск до неё не дошёл");
});

test("маршрут: зарплата из открытых данных — поиск и модель не нужны, платить нечем; аренда и должность без данных идут обычным поиском", async () => {
  let searched = 0;
  let asked = 0;
  const official = async (it: { subject: string }, day: string) =>
    it.subject === "Кладовщик"
      ? { kind: "salary" as const, subject: "Кладовщик", monthly: 61000, min: 52000, max: 70000, region: "Тверская область", regionMatch: "same" as const, host: "opendata.trudvsem.ru", url: "https://opendata.trudvsem.ru/x", date: day, quote: "q", notes: [] }
      : null;
  const { d } = routeDeps({ official, search: async () => (searched++, []), ask: async () => (asked++, { text: "{}", usd: 0 }) });
  const res = await handleRates(post({ items: [item(1), { key: "role-2", kind: "salary", subject: "Стропальщик", region: "Тверская область" }] }), d);
  const body = (await res.json()) as { spentRub: number; results: { key: string; observations: { monthly: number; host: string }[]; pagesRead: number }[] };
  assert.equal(body.results[0].observations[0].monthly, 61000);
  assert.equal(body.results[0].observations[0].host, "opendata.trudvsem.ru");
  assert.equal(body.results[0].pagesRead, 0);
  assert.ok(searched > 0, "для должности без вакансий — запасной поиск по сайтам");
  assert.equal(asked, 0, "страниц не нашлось — модель не вызывалась");
  assert.equal(body.spentRub, 0);
  const failing = routeDeps({ official: async () => { throw new Error("сеть"); }, search: async () => [] });
  assert.equal((await handleRates(post({ items: [item(1)] }), failing.d)).status, 200, "сбой источника не ломает запрос");
});
