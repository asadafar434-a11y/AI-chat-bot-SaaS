// Поиск в интернете для проверки гипотез: запрос к сервису, память на час, ограничение частоты, отказы, вход и защита запроса — npm test. Сеть заменена заготовкой.
import assert from "node:assert/strict";
import { test } from "node:test";
import { handleWebSearch, type WebSearchDeps } from "./handler.ts";
import { createSearcher, SearchError } from "./search.ts";

const page = (urls: string[]) =>
  `<div id="links" class="results">${urls
    .map(
      (u, i) => `<div class="result results_links web-result ">
        <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(u)}&amp;rut=1">Страница ${i}</a></h2>
        <a class="result__snippet" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(u)}">Текст ${i}</a></div>`,
    )
    .join("")}</div>`;

type Call = { url: string; headers: Record<string, string> };
function fakeFetch(respond: (n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetcher = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
    return respond(calls.length);
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}
const html = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/html" } });

test("поиск: запрос уходит ключевыми словами на русскоязычную выдачу, ответ разобран, указано, чем искали", async () => {
  const { fetcher, calls } = fakeFetch(() => html(page(["https://a.ru/x", "https://b.ru/y"])));
  const search = createSearcher({ fetcher, now: () => Date.parse("2026-10-21T10:00:00Z") });
  const out = await search("тарифы на доставку грузов Севастополь 2026");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://html.duckduckgo.com/html/?q=%D1%82%D0%B0%D1%80%D0%B8%D1%84%D1%8B%20%D0%BD%D0%B0%20%D0%B4%D0%BE%D1%81%D1%82%D0%B0%D0%B2%D0%BA%D1%83%20%D0%B3%D1%80%D1%83%D0%B7%D0%BE%D0%B2%20%D0%A1%D0%B5%D0%B2%D0%B0%D1%81%D1%82%D0%BE%D0%BF%D0%BE%D0%BB%D1%8C%202026&kl=ru-ru");
  assert.equal(out.hits.length, 2);
  assert.equal(out.hits[0].url, "https://a.ru/x");
  assert.equal(out.provider, "duckduckgo");
  assert.match(out.providerName, /пробный бесплатный/);
  assert.equal(out.at, "2026-10-21T10:00:00.000Z");
  assert.equal(out.cached, false);
  // Ни кук, ни данных пользователя в запросе нет.
  assert.deepEqual(Object.keys(calls[0].headers).map((h) => h.toLowerCase()).sort(), ["accept", "accept-language", "user-agent"]);
});

test("поиск: одинаковый запрос в течение часа берётся из памяти, через час — снова из сети", async () => {
  let time = 0;
  const { fetcher, calls } = fakeFetch(() => html(page(["https://a.ru/x"])));
  const search = createSearcher({ fetcher, now: () => time });
  await search("рост цен 2026");
  time += 30 * 60_000;
  const again = await search("Рост цен 2026");
  assert.equal(again.cached, true);
  assert.equal(calls.length, 1);
  time += 40 * 60_000;
  assert.equal((await search("рост цен 2026")).cached, false);
  assert.equal(calls.length, 2);
});

test("поиск: больше двадцати запросов в минуту — отказ с понятным текстом, через минуту снова можно", async () => {
  let time = 0;
  const { fetcher } = fakeFetch((n) => html(page([`https://s${n}.ru/`])));
  const search = createSearcher({ fetcher, now: () => time, perMinute: 3 });
  for (const q of ["один запрос", "два запроса", "три запроса"]) await search(q);
  await assert.rejects(search("четыре запроса"), (e: unknown) => e instanceof SearchError && e.status === 429 && /подождите минуту/.test(e.message));
  time += 61_000;
  assert.equal((await search("четыре запроса")).hits.length, 1);
});

test("поиск: просьба подтвердить, что вы человек (202), отказ, сбой сети и таймаут — понятные тексты; пустой ответ в память не попадает", async () => {
  for (const [status, expected] of [[202, 503], [403, 503], [429, 503], [500, 502]] as const) {
    const { fetcher } = fakeFetch(() => html("", status));
    await assert.rejects(createSearcher({ fetcher })("рост цен 2026"), (e: unknown) => e instanceof SearchError && e.status === expected, String(status));
  }
  const down = fakeFetch(() => Promise.reject(new TypeError("fetch failed")));
  await assert.rejects(createSearcher({ fetcher: down.fetcher })("рост цен 2026"), (e: unknown) => e instanceof SearchError && e.status === 504 && /не ответил вовремя/.test(e.message));
  let n = 0;
  const flaky = fakeFetch(() => html(++n === 1 ? "<html>Подтвердите, что вы не робот</html>" : page(["https://a.ru/"])));
  const search = createSearcher({ fetcher: flaky.fetcher });
  assert.deepEqual((await search("рост цен 2026")).hits, []);
  assert.equal((await search("рост цен 2026")).hits.length, 1, "пустой ответ не запомнился");
});

test("поиск: другой сервис в настройке, которого ещё нет, — честный отказ, а не молчаливая подмена", async () => {
  const { fetcher, calls } = fakeFetch(() => html(page(["https://a.ru/"])));
  await assert.rejects(createSearcher({ fetcher, provider: "yandex" })("рост цен 2026"), (e: unknown) => e instanceof SearchError && e.status === 503 && /«yandex»/.test(e.message) && /ещё не подключён/.test(e.message));
  assert.equal(calls.length, 0);
});

const post = (body: unknown) => new Request("http://localhost/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const deps = (over: Partial<WebSearchDeps> = {}): WebSearchDeps => ({
  authorize: async () => null,
  search: async () => ({ provider: "duckduckgo", providerName: "DuckDuckGo (пробный бесплатный поиск)", hits: [{ title: "Т", url: "https://a.ru/", domain: "a.ru", snippet: "с" }], cached: false, at: "2026-10-21T10:00:00.000Z" }),
  ...over,
});

test("маршрут: без входа отказ, поиск не вызывается", async () => {
  let called = 0;
  const res = await handleWebSearch(post({ query: "рост цен 2026" }), deps({ authorize: async () => new Response("Войдите", { status: 401 }), search: async () => (called++, deps().search("x")) }));
  assert.equal(res.status, 401);
  assert.equal(called, 0);
});

test("маршрут: ответ — запрос, чем искали, когда и результаты; почта, телефон и сайт в запросе — отказ до поиска", async () => {
  const ok = await handleWebSearch(post({ query: "  рост   цен 2026 " }), deps());
  assert.equal(ok.status, 200);
  const json = await ok.json();
  assert.equal(json.query, "рост цен 2026");
  assert.equal(json.hits.length, 1);
  assert.match(json.providerName, /пробный/);
  let called = 0;
  const spy = deps({ search: async () => (called++, deps().search("x")) });
  for (const query of ["тариф ivan@firma.ru", "звонить +7 912 000 00 00", "тариф https://site.ru", "ab", 5, null]) {
    const res = await handleWebSearch(post({ query }), spy);
    assert.equal(res.status, 400, String(query));
  }
  assert.equal(called, 0);
  assert.equal((await handleWebSearch(post("не json"), spy)).status, 400);
  assert.equal((await handleWebSearch(post([1]), spy)).status, 400);
});

test("маршрут: отказ поиска передаётся браузеру понятным текстом и кодом; неожиданный сбой — без подробностей и без запроса в журнале", async () => {
  const limited = await handleWebSearch(post({ query: "рост цен 2026" }), deps({ search: async () => Promise.reject(new SearchError("Слишком много поисковых запросов подряд", 429)) }));
  assert.equal(limited.status, 429);
  assert.match(await limited.text(), /Слишком много/);
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void logged.push(args.join(" "));
  try {
    const res = await handleWebSearch(post({ query: "рост цен 2026 секретное" }), deps({ search: async () => Promise.reject(new Error("socket hang up\nстек")) }));
    assert.equal(res.status, 502);
    assert.equal(await res.text(), "Поиск сейчас недоступен. Повторите позже.");
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);
  assert.ok(!logged[0].includes("секретное"));
  assert.match(logged[0], /socket hang up/);
});
