// Живой поиск закупочных цен: доступ, ИИ выключен, бюджет, потолок расходов, результат по позициям — npm test (поиск, сеть и модель подставлены, денег нет).
import assert from "node:assert/strict";
import { test } from "node:test";
import { handlePrices, type PricesDeps } from "./prices-handler.ts";

const NOW = new Date("2026-10-22T16:00:00Z");
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/prices", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

const page = (price: string) =>
  `<html><head><title>Уголь ДПК — прайс</title></head><body><h1>Уголь марки Д</h1><p>* - оптовая цена</p><p>Каменный уголь ДПК навалом, 1 тн — ${price} руб. Цена без НДС, самовывоз.</p><p>Звоните нам по телефону для уточнения условий поставки и наличия на складе.</p></body></html>`;
const answer = (price: string) =>
  JSON.stringify({ offers: [{ product: "Каменный уголь ДПК", price: Number(price.replace(/\s/g, "")), unit: "т", vat: "without", priceType: "wholesale", region: null, conditions: "самовывоз", quote: `Каменный уголь ДПК навалом, 1 тн — ${price} руб. Цена без НДС, самовывоз.`, vatQuote: null }] });

function deps(over: Partial<PricesDeps> = {}): { d: PricesDeps; asked: { appId: string | null; user: string }[]; searched: string[] } {
  const asked: { appId: string | null; user: string }[] = [];
  const searched: string[] = [];
  const pages: Record<string, string> = { "https://a.ru/p": page("5 000"), "https://b.ru/p": page("5 100"), "https://c.ru/p": page("5 200") };
  const d: PricesDeps = {
    authorize: async () => null,
    aiAvailable: () => true,
    budgetOver: async () => false,
    appIdOf: (r) => r.headers.get("x-application-id"),
    search: async (q) => {
      searched.push(q);
      return ["a.ru", "b.ru", "c.ru"].map((domain) => ({ title: domain, url: `https://${domain}/p`, domain, snippet: "" }));
    },
    fetchPage: async (url) => (pages[url] ? { ok: true, html: pages[url], finalUrl: url } : { ok: false, error: "ответ 404" }),
    ask: async (_s, user, appId) => {
      asked.push({ appId, user });
      return { text: answer(/— ([\d ]+) руб/.exec(user)?.[1] ?? "1"), usd: 0.01 };
    },
    worstCaseRub: () => 2,
    usdRub: 80,
    capRub: 30,
    budgetText: "Бюджет ИИ на эту закупку исчерпан.",
    now: () => NOW,
    ...over,
  };
  return { d, asked, searched };
}
const COAL = { positions: [{ key: "p1", name: "Уголь каменный ДПК", unit: "т", quantity: 1500, region: "Севастополь" }] };

test("находит закупочные цены по позиции: поиск по её названию и единице, страницы читаются, принятые цены возвращаются с источником и датой; расход и номер закупки передаются дальше", async () => {
  const { d, asked, searched } = deps();
  const res = await handlePrices(post(COAL, { "x-application-id": "app-1" }), d);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.asOf, "2026-10-22");
  assert.equal(json.results.length, 1);
  const r = json.results[0];
  assert.equal(r.key, "p1");
  assert.equal(r.observations.length, 3);
  assert.equal(r.pagesRead, 3);
  assert.deepEqual(r.observations.map((o: { priceNoVat: number }) => o.priceNoVat).sort(), [5000, 5100, 5200]);
  assert.match(r.observations[0].source, /проверено 22\.10\.2026/);
  assert.equal(json.spentRub, 2.4, "3 вызова × 0,01 $ × 80 ₽");
  assert.ok(asked.every((a) => a.appId === "app-1"), "расход идёт в бюджет этой закупки");
  assert.ok(searched.some((q) => /Уголь каменный ДПК цена за т оптом/.test(q)) && searched.some((q) => /купить Уголь каменный ДПК оптом Севастополь/.test(q)));
});

test("без входа — отказ, ничего не ищется; ИИ на сервере выключен — 503 без поиска; кривой запрос — 400; нет курса — 503", async () => {
  const a = deps({ authorize: async () => new Response("Требуется вход", { status: 401 }) });
  assert.equal((await handlePrices(post(COAL), a.d)).status, 401);
  assert.equal(a.searched.length, 0);
  const off = deps({ aiAvailable: () => false });
  const r = await handlePrices(post(COAL), off.d);
  assert.equal(r.status, 503);
  assert.match(await r.text(), /ИИ на сервере выключен/);
  assert.equal(off.searched.length + off.asked.length, 0);
  assert.equal((await handlePrices(post({ positions: [] }), deps().d)).status, 400);
  assert.equal((await handlePrices(post("{не json"), deps().d)).status, 400);
  const noRate = await handlePrices(post(COAL), deps({ usdRub: 0 }).d);
  assert.equal(noRate.status, 503);
  assert.match(await noRate.text(), /Курс доллара не задан/);
});

test("бюджет ИИ на закупку исчерпан — 402 с понятным текстом и без обращений к поиску и модели", async () => {
  const { d, asked, searched } = deps({ budgetOver: async (id) => id === "app-1" });
  const res = await handlePrices(post(COAL, { "x-application-id": "app-1" }), d);
  assert.equal(res.status, 402);
  assert.match(await res.text(), /Бюджет ИИ на эту закупку исчерпан/);
  assert.equal(asked.length + searched.length, 0);
});

test("потолок на запрос: когда следующий вызов в худшем случае выходит за потолок, поиск останавливается; потрачено не больше потолка", async () => {
  const { d, asked } = deps({ capRub: 3, worstCaseRub: () => 2 });
  const res = await handlePrices(post(COAL), d);
  const json = await res.json();
  assert.equal(json.stoppedByCap, true);
  assert.ok(json.spentRub <= 3, `потрачено ${json.spentRub} ₽`);
  assert.equal(asked.length, 2, "первые два вызова влезают (0 + 2, 0,8 + 2), третий (1,6 + 2 > 3) — нет");
});

test("несколько позиций делят потолок; поиск не ответил — сказано в searchErrors, результата нет, но ответ 200 (деньги не потрачены)", async () => {
  const two = { positions: [{ key: "a", name: "Уголь каменный ДПК", unit: "т" }, { key: "b", name: "Щебень гранитный 5-20", unit: "м3" }] };
  const blocked = deps({
    search: async () => {
      throw new Error("Бесплатный поиск временно не отвечает на запросы с сервера (просит подтвердить, что вы человек).");
    },
  });
  const res = await handlePrices(post(two), blocked.d);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json.searchErrors, ["поиск не ответил (просит подтвердить, что вы человек)"]);
  assert.equal(json.spentRub, 0);
  assert.deepEqual(json.results.map((r: { key: string; observations: unknown[] }) => [r.key, r.observations.length]), [["a", 0], ["b", 0]]);
  assert.equal(blocked.asked.length, 0);
});
