// Сбор закупочных цен: страницы из поиска, по одной с сайта, чтение моделью с потолком расходов, проверка кодом — npm test (поиск, сеть и модель подставлены, денег нет).
import assert from "node:assert/strict";
import { test } from "node:test";
import { collectPrices, hasPriceLike, saysPriceOnRequest, type CollectDeps, type SearchHit } from "./collect.ts";

const WANTED = { name: "Уголь каменный ДПК", unit: "т", region: null };
const page = (price: string) => `<html><head><title>Уголь ДПК — прайс</title></head><body><h1>Уголь марки Д</h1><p>Оптовая цена на уголь</p><p>Каменный уголь ДПК навалом, 1 тн — ${price} руб. Цена с НДС, самовывоз.</p><p>Звоните нам по телефону для уточнения условий поставки и наличия на складе.</p></body></html>`;
const hit = (domain: string, n = 1): SearchHit => ({ title: `Уголь ${domain}`, url: `https://${domain}/p${n}`, domain, snippet: "" });

const answerFor = (price: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({ offers: [{ product: "Каменный уголь ДПК навалом", price: Number(price.replace(/\s/g, "")), unit: "т", vat: "with", priceType: "wholesale", region: "Москва", conditions: null, quote: `Каменный уголь ДПК навалом, 1 тн — ${price} руб. Цена с НДС, самовывоз.`, ...over }] });

function deps(over: Partial<CollectDeps> & { pages?: Record<string, string> } = {}): { d: CollectDeps; asked: string[] } {
  const asked: string[] = [];
  const pages = over.pages ?? {};
  const d: CollectDeps = {
    search: async (q) => (q === "q1" ? [hit("a.ru"), hit("b.ru"), hit("a.ru", 2), hit("youtube.com")] : [hit("c.ru"), hit("b.ru", 3)]),
    fetchPage: async (url) => (pages[url] ? { ok: true, html: pages[url], finalUrl: url } : { ok: false, error: "ответ 404" }),
    ask: async (_system, user) => {
      asked.push(user);
      const price = /— ([\d ]+) руб/.exec(user)?.[1] ?? "1";
      return { text: answerFor(price), usd: 0.02 };
    },
    worstCaseRub: () => 3,
    usdRub: 80,
    today: () => "2026-10-23",
    ...over,
  };
  return { d, asked };
}
const ALL = { "https://a.ru/p1": page("11 130"), "https://b.ru/p1": page("11 500"), "https://c.ru/p1": page("10 900") };

test("страницы берутся по очереди из запросов, по одной с сайта; видео и соцсети пропускаются; каждая прочитанная читается моделью один раз", async () => {
  const { d, asked } = deps({ pages: ALL });
  const r = await collectPrices(d, { wanted: WANTED, queries: ["q1", "q2"], maxPages: 6, capRub: 40 });
  assert.deepEqual(r.pages.map((p) => p.domain), ["a.ru", "c.ru", "b.ru"], "по очереди из запросов, a.ru и b.ru — по одному разу, youtube пропущен");
  assert.equal(r.calls, 3);
  assert.equal(asked.length, 3);
  assert.equal(r.accepted.length, 3);
  assert.deepEqual(r.accepted.map((o) => Math.round(o.priceNoVat)).sort((a, b) => a - b), [8934, 9123, 9426], "цены приведены к цене без НДС");
  assert.equal(r.stoppedByCap, false);
});

test("расходы: считаются по usage каждого ответа в рублях по курсу и суммируются; у страницы — своя стоимость", async () => {
  const { d } = deps({ pages: ALL });
  const r = await collectPrices(d, { wanted: WANTED, queries: ["q1", "q2"], maxPages: 6, capRub: 40 });
  assert.equal(r.pages.filter((p) => p.status === "read").every((p) => p.costRub === 1.6), true, "0,02 доллара × 80 = 1,6 ₽");
  assert.equal(r.spentRub, 4.8);
});

test("потолок: если следующий вызов в худшем случае выходит за потолок, сбор останавливается до вызова — деньги сверх потолка не тратятся", async () => {
  const { d, asked } = deps({ pages: ALL, worstCaseRub: () => 3 });
  const r = await collectPrices(d, { wanted: WANTED, queries: ["q1", "q2"], maxPages: 6, capRub: 5 });
  assert.equal(r.stoppedByCap, true);
  assert.equal(asked.length, 2, "первый вызов: 0 + 3 ≤ 5; второй: 1,6 + 3 = 4,6 ≤ 5 — разрешён; третий: 3,2 + 3 > 5 — нет");
  assert.ok(r.spentRub <= 5, `потрачено ${r.spentRub} ₽`);
  assert.match(r.pages.at(-1)!.skipReason!, /остановлено/);
});

test("страница не открылась, текста почти нет, модель не ответила, поиск упал — сбор идёт дальше, причины записаны", async () => {
  const calls: string[] = [];
  const { d } = deps({
    pages: { "https://c.ru/p1": page("10 900"), "https://a.ru/p1": "<html><body>пусто</body></html>" },
    search: async (q) => {
      if (q === "bad") throw new Error("поиск заблокирован");
      return [hit("a.ru"), hit("b.ru"), hit("c.ru")];
    },
    ask: async (_s, user) => {
      calls.push(user);
      throw new Error("лимит запросов");
    },
  });
  const r = await collectPrices(d, { wanted: WANTED, queries: ["bad", "q"], maxPages: 6, capRub: 40 });
  assert.match(r.searchErrors[0], /поиск заблокирован/);
  const reason = (domain: string) => r.pages.find((p) => p.domain === domain)!.skipReason;
  assert.match(reason("a.ru")!, /почти нет текста/);
  assert.equal(reason("b.ru"), "ответ 404");
  assert.match(reason("c.ru")!, /модель не ответила: лимит запросов/);
  assert.equal(r.calls, 0);
  assert.equal(r.spentRub, 0, "ответа не было — денег нет");
});

test("ответ модели проверяет код: выдуманная цитата, розница и другая единица — в отклонённые с причиной, в принятые не попадают; повтор одной цены не дублируется", async () => {
  const text = JSON.stringify({
    offers: [
      { product: "Каменный уголь ДПК навалом", price: 11130, unit: "т", vat: "with", priceType: "wholesale", quote: "Каменный уголь ДПК навалом, 1 тн — 11 130 руб. Цена с НДС, самовывоз." },
      { product: "Каменный уголь ДПК навалом", price: 11130, unit: "т", vat: "with", priceType: "wholesale", quote: "Каменный уголь ДПК навалом, 1 тн — 11 130 руб. Цена с НДС, самовывоз." },
      { product: "Выдумка", price: 9000, unit: "т", vat: "with", priceType: "wholesale", quote: "Уголь ДПК всего 9 000 руб. за тонну, спешите купить" },
      { product: "Мешок", price: 480, unit: "кг", vat: "with", priceType: "retail", quote: "Каменный уголь ДПК навалом, 1 тн — 11 130 руб. Цена с НДС" },
    ],
  });
  const { d } = deps({ pages: ALL, ask: async () => ({ text, usd: 0.01 }) });
  const r = await collectPrices(d, { wanted: WANTED, queries: ["q1"], maxPages: 1, capRub: 40 });
  assert.equal(r.accepted.length, 1);
  assert.deepEqual(r.rejected.map((x) => [x.product, x.reason]), [["Выдумка", "цитаты нет на странице"], ["Мешок", "цены нет в цитате"]]);
  assert.equal(r.pages[0].offers.length, 4, "все четыре предложения записаны у страницы, в принятые вошло одно");
});

test("без поисковых результатов — пустой итог без обращений к модели и без расходов", async () => {
  const { d, asked } = deps({ pages: {}, search: async () => [] });
  const r = await collectPrices(d, { wanted: WANTED, queries: ["q"], maxPages: 6, capRub: 40 });
  assert.equal(r.pages.length, 0);
  assert.equal(asked.length, 0);
  assert.equal(r.spentRub, 0);
});

test("страницы без цены не отправляются модели (платный вызов впустую): просматриваются дальше, пока не наберётся нужное число страниц с ценой", async () => {
  const noPrice = (n: string) => `<html><head><title>Каталог ${n}</title></head><body><h1>Сварочные агрегаты</h1><p>Подробные технические характеристики и описание оборудования, доставка по всей России, звоните нам для уточнения условий.</p></body></html>`;
  const pages: Record<string, string> = {
    "https://a.ru/p1": noPrice("a"),
    "https://b.ru/p1": noPrice("b"),
    "https://c.ru/p1": page("10 900"),
    "https://d.ru/p1": page("11 100"),
  };
  const { d, asked } = deps({ pages, search: async () => [hit("a.ru"), hit("b.ru"), hit("c.ru"), hit("d.ru")] });
  const r = await collectPrices(d, { wanted: WANTED, queries: ["q"], maxPages: 2, maxCandidates: 4, capRub: 40 });
  assert.equal(asked.length, 2, "модель читает только страницы с ценой");
  assert.deepEqual(r.pages.map((p) => `${p.domain}:${p.status}`), ["a.ru:skipped", "b.ru:skipped", "c.ru:read", "d.ru:read"]);
  assert.equal(r.pages[0].skipReason, "на странице нет цены");
  assert.equal(r.accepted.length, 2);
  assert.equal(r.spentRub, 3.2);
});

test("кандидатов больше, чем страниц для модели: после maxPages вызовов сбор останавливается и лишнего не читает", async () => {
  const pages: Record<string, string> = { "https://a.ru/p1": page("10 900"), "https://b.ru/p1": page("11 100"), "https://c.ru/p1": page("11 300") };
  const { d, asked } = deps({ pages, search: async () => [hit("a.ru"), hit("b.ru"), hit("c.ru")] });
  const r = await collectPrices(d, { wanted: WANTED, queries: ["q"], maxPages: 2, maxCandidates: 3, capRub: 40 });
  assert.equal(asked.length, 2);
  assert.equal(r.pages.length, 2);
});

test("что похоже на цену: число с «₽» или «руб», слово «цена» рядом с числом; просто текст и мелкие числа — нет", () => {
  assert.equal(hasPriceLike("Цена: 1162635 руб."), true);
  assert.equal(hasPriceLike("Стоимость 455 ₽ за штуку"), true);
  assert.equal(hasPriceLike("Агрегат 1 305 ₽"), true);
  assert.equal(hasPriceLike("Цена по запросу, звоните"), false);
  assert.equal(hasPriceLike("Мощность 300 А, масса 120 кг, 3 фазы"), false);
});

test("страница, где цена «по запросу», помечается так (а не «нет цены») и модели не отправляется", async () => {
  const onRequest = `<html><head><title>МАКС-300</title></head><body><h1>Сварочный агрегат МАКС-300</h1><p>Подробные технические характеристики и описание оборудования. Цена по запросу — оставьте заявку, и менеджер пришлёт коммерческое предложение.</p></body></html>`;
  const { d, asked } = deps({ pages: { "https://a.ru/p1": onRequest }, search: async () => [hit("a.ru")] });
  const r = await collectPrices(d, { wanted: WANTED, queries: ["q"], maxPages: 2, capRub: 40 });
  assert.equal(r.pages[0].skipReason, "цена по запросу");
  assert.equal(asked.length, 0, "платная модель страницу без цены не читает");
  assert.equal(saysPriceOnRequest("Доставка и документы по запросу"), false, "«по запросу» не про цену — не считается");
  assert.equal(saysPriceOnRequest("Стоимость уточняйте у менеджера"), true);
});

test("лекарства и другие товары, у которых в интернете только розница: оптовых и каталожных цен нет — розничные принимаются запасным проходом с пометкой; есть хоть одна не розничная — розничные не берутся", async () => {
  const pages = { "https://a.ru/p1": page("11 130"), "https://b.ru/p1": page("11 500") };
  const only = deps({ pages, search: async () => [hit("a.ru"), hit("b.ru")], ask: async (_s, user) => ({ text: answerFor(/— ([\d ]+) руб/.exec(user)?.[1] ?? "1", { priceType: "retail" }), usd: 0.01 }) });
  const r = await collectPrices(only.d, { wanted: WANTED, queries: ["q"], maxPages: 4, capRub: 40 });
  assert.equal(r.accepted.length, 2, "запасной проход принял обе розничные цены");
  assert.equal(r.rejected.length, 0, "принятые из списка отклонённых убраны");
  assert.ok(r.accepted.every((o) => /розничная цена магазина или аптеки — закупочная может быть ниже/.test(o.source)), "в источнике пометка про розницу");

  let n = 0;
  const mixed = deps({ pages, search: async () => [hit("a.ru"), hit("b.ru")], ask: async (_s, user) => ({ text: answerFor(/— ([\d ]+) руб/.exec(user)?.[1] ?? "1", { priceType: n++ === 0 ? "wholesale" : "retail" }), usd: 0.01 }) });
  const m = await collectPrices(mixed.d, { wanted: WANTED, queries: ["q"], maxPages: 4, capRub: 40 });
  assert.equal(m.accepted.length, 1, "есть оптовая — розничная не берётся");
  assert.equal(m.rejected.length, 1);
  assert.equal(m.rejected[0].reason, "розничная цена");
});
