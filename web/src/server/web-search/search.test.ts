// Поиск в интернете для проверки гипотез: запрос к сервису, память на час, ограничение частоты, отказы, вход и защита запроса — npm test. Сеть заменена заготовкой.
import assert from "node:assert/strict";
import { test } from "node:test";
import { handleWebSearch, type WebSearchDeps } from "./handler.ts";
import { createSearcher, SearchError } from "./search.ts";
import { parseBraveHtml } from "@/lib/web-search.ts";

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
  const search = createSearcher({ provider: "duckduckgo", fetcher, now: () => Date.parse("2026-10-21T10:00:00Z") });
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
  const search = createSearcher({ provider: "duckduckgo", fetcher, now: () => time });
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
    await assert.rejects(createSearcher({ provider: "duckduckgo", fetcher })("рост цен 2026"), (e: unknown) => e instanceof SearchError && e.status === expected, String(status));
  }
  const down = fakeFetch(() => Promise.reject(new TypeError("fetch failed")));
  await assert.rejects(createSearcher({ provider: "duckduckgo", fetcher: down.fetcher })("рост цен 2026"), (e: unknown) => e instanceof SearchError && e.status === 504 && /не ответил вовремя/.test(e.message));
  let n = 0;
  const flaky = fakeFetch(() => html(++n === 1 ? "<html>Подтвердите, что вы не робот</html>" : page(["https://a.ru/"])));
  const search = createSearcher({ provider: "duckduckgo", fetcher: flaky.fetcher });
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

// Страница Brave Search (search.brave.com): настоящая разметка блоков результатов, сокращена до нужных полей (проверено на живой странице 22.10.2026).
const braveBlock = (url: string, title: string, description: string, type = "web") =>
  `<div class="snippet svelte-jmfu5f" data-pos="0" data-type="${type}" data-keynav="true"><div class="result-body"><div class="result-wrapper"><div class="result-content"><a href="${url}" target="_self" class="svelte-14r20fy l1"><div class="site-name-wrapper"><img class="favicon" src="https://imgs.search.brave.com/x" alt=""/><cite class="snippet-url">${new URL(url).hostname}</cite></div><div class="title search-snippet-title line-clamp-1 svelte-14r20fy" title="${title}">${title}</div></a><div class="generic-snippet svelte-1cwdgg3"><div class="content desktop-default-regular t-primary line-clamp-dynamic svelte-1cwdgg3"><!--[-1--><!--]--> ${description}</div></div></div></div></div></div>`;
const bravePage = (...blocks: string[]) => `<html><body><main>${blocks.join("")}</main></body></html>`;

test("Brave: заголовок, ссылка, сайт и описание из блоков обычных результатов; новости и свои ссылки Brave — не результаты; повторы и пустые заголовки отброшены", () => {
  const hits = parseBraveHtml(
    bravePage(
      braveBlock("https://tass.ru/ekonomika/26111567", "Эксперты допустили рост цен на стройматериалы в России в 2026 году", "/ТАСС/. Цены на строительные материалы в РФ могут вырасти до 15% в 2026 году, рассказали ТАСС эксперты. &quot;В 2026 году ожидаем умеренный рост цен ...&quot;"),
      braveBlock("https://101-app.com/blog/rynok-stroymaterialov-2026", "Рынок стройматериалов в 2026", "30 марта 2026 г. - По данным Росстата, в январе 2026 цены на строительные материалы выросли на 0,37% к декабрю 2025."),
      braveBlock("https://tass.ru/ekonomika/26111567", "Повтор той же ссылки", "ещё раз"),
      braveBlock("https://news.example.ru/x", "Новость", "из блока новостей", "news"),
      braveBlock("https://search.brave.com/images?q=x", "Картинки Brave", "своя ссылка"),
      braveBlock("https://empty.ru/", "", "без заголовка"),
    ),
  );
  assert.deepEqual(hits.map((h) => h.url), ["https://tass.ru/ekonomika/26111567", "https://101-app.com/blog/rynok-stroymaterialov-2026"]);
  assert.equal(hits[0].domain, "tass.ru");
  assert.match(hits[0].snippet, /могут вырасти до 15% в 2026 году/);
  assert.match(hits[0].snippet, /"В 2026 году ожидаем умеренный рост цен \.\.\."/, "разметка в описании снята, кавычки разобраны");
  assert.match(hits[1].snippet, /выросли на 0,37% к декабрю 2025/);
  assert.deepEqual(parseBraveHtml("<html>Подтвердите, что вы не робот</html>"), []);
  assert.equal(parseBraveHtml(bravePage(...Array.from({ length: 9 }, (_, i) => braveBlock(`https://s${i}.ru/`, `Заголовок ${i}`, "текст")))).length, 6);
});

test("поиск по умолчанию: сначала Brave — одного запроса хватает, ответ помечен Brave", async () => {
  const { fetcher, calls } = fakeFetch(() => html(bravePage(braveBlock("https://tass.ru/x", "Рост цен", "выросли на 12 %"))));
  const out = await createSearcher({ fetcher, now: () => Date.parse("2026-10-22T10:00:00Z") })("рост цен на строительные материалы 2026");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/search\.brave\.com\/search\?q=.*&source=web$/);
  assert.equal(out.provider, "brave");
  assert.match(out.providerName, /Brave Search/);
  assert.equal(out.hits.length, 1);
});

test("поиск по умолчанию: Brave просит подтвердить, что вы человек, или не дал результатов — берётся DuckDuckGo; в память кладётся то, что нашлось", async () => {
  for (const brave of [() => html("", 429), () => html("", 202), () => html("<html>пусто</html>"), () => Promise.reject(new TypeError("fetch failed"))]) {
    const { fetcher, calls } = fakeFetch((n) => (n === 1 ? brave() : html(page(["https://a.ru/x"]))));
    const search = createSearcher({ fetcher });
    const out = await search("рост цен 2026");
    assert.equal(out.provider, "duckduckgo");
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /search\.brave\.com/);
    assert.match(calls[1].url, /html\.duckduckgo\.com/);
    assert.equal((await search("рост цен 2026")).cached, true);
    assert.equal(calls.length, 2, "повтор — из памяти, в сеть не ходит");
  }
});

test("поиск по умолчанию: оба поисковика просят подтвердить, что вы человек, — отказ с понятным текстом и ссылкой на Яндекс; оба недоступны — 502; оба молчат — 504; пустой ответ отдаётся без памяти", async () => {
  const blocked = fakeFetch(() => html("", 429));
  await assert.rejects(createSearcher({ fetcher: blocked.fetcher })("рост цен 2026"), (e: unknown) => e instanceof SearchError && e.status === 503 && /тот же запрос в Яндексе/.test(e.message));
  assert.equal(blocked.calls.length, 2);
  const broken = fakeFetch(() => html("", 500));
  await assert.rejects(createSearcher({ fetcher: broken.fetcher })("рост цен 2026"), (e: unknown) => e instanceof SearchError && e.status === 502);
  const down = fakeFetch(() => Promise.reject(new TypeError("fetch failed")));
  await assert.rejects(createSearcher({ fetcher: down.fetcher })("рост цен 2026"), (e: unknown) => e instanceof SearchError && e.status === 504);
  const empty = fakeFetch(() => html("<html>нет результатов</html>"));
  const search = createSearcher({ fetcher: empty.fetcher });
  assert.deepEqual((await search("рост цен 2026")).hits, []);
  assert.equal(empty.calls.length, 2);
  await search("рост цен 2026");
  assert.equal(empty.calls.length, 4, "пустой ответ в память не попал");
});

test("поиск: provider=brave или duckduckgo — ходит только к нему, без запасного", async () => {
  const onlyBrave = fakeFetch(() => html("", 429));
  await assert.rejects(createSearcher({ fetcher: onlyBrave.fetcher, provider: "brave" })("рост цен 2026"), (e: unknown) => e instanceof SearchError && e.status === 503);
  assert.equal(onlyBrave.calls.length, 1);
  assert.match(onlyBrave.calls[0].url, /search\.brave\.com/);
  const onlyDdg = fakeFetch(() => html(page(["https://a.ru/x"])));
  assert.equal((await createSearcher({ fetcher: onlyDdg.fetcher, provider: "duckduckgo" })("рост цен 2026")).provider, "duckduckgo");
  assert.equal(onlyDdg.calls.length, 1);
});
