// Пилот поиска цен агентом на Mastra: инструменты, проверка каждой цены кодом, лимиты и потолок в рублях — npm test.
// Модель поддельная (AI SDK, «ai/test»): по сценарию вызывает инструменты; сети и денег нет.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { runPriceAgent, type PriceAgentDeps } from "./price-agent.ts";

const PAGE = `<html><head><title>Уголь ДПК — прайс</title></head><body><h1>Уголь марки Д</h1><p>* - оптовая цена</p><p>Каменный уголь ДПК навалом, 1 тн — 5 000 руб. Цена без НДС, самовывоз.</p><p>Звоните нам по телефону для уточнения условий поставки и наличия на складе.</p></body></html>`;
const QUOTE = "Каменный уголь ДПК навалом, 1 тн — 5 000 руб. Цена без НДС, самовывоз.";
const OFFER = { product: "Каменный уголь ДПК", price: 5000, unit: "т", vat: "without", priceType: "wholesale", region: null, conditions: "самовывоз", quote: QUOTE, vatQuote: null };

type Part = Record<string, unknown>;
const usage = { inputTokens: { total: 2000, noCache: 2000, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 200, text: 200, reasoning: 0 } };
const call = (id: string, toolName: string, input: unknown): Part => ({ type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(input) });
const say = (text: string): Part[] => [{ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: text }, { type: "text-end", id: "t" }];

/** Модель по сценарию: на каждый шаг — свои части ответа; сценарий кончился — «готово». */
function scripted(turns: Part[][]) {
  let i = 0;
  const seenPrompts: unknown[] = [];
  const next = (prompt: unknown) => {
    seenPrompts.push(prompt);
    const parts = turns[i] ?? say("готово");
    i++;
    return { parts, finishReason: { unified: parts.some((p) => p.type === "tool-call") ? "tool-calls" : "stop", raw: undefined } };
  };
  // Mastra вызывает то обычный ответ, то поток — поддельная модель умеет оба.
  const model = new MockLanguageModelV4({
    doGenerate: async (opts: { prompt: unknown }) => {
      const { parts, finishReason } = next(opts.prompt);
      const content = parts.flatMap((p) => (p.type === "tool-call" ? [p] : p.type === "text-delta" ? [{ type: "text", text: p.delta }] : []));
      return { content, finishReason, usage, warnings: [] };
    },
    doStream: async (opts: { prompt: unknown }) => {
      const { parts, finishReason } = next(opts.prompt);
      return { stream: simulateReadableStream({ chunks: [{ type: "stream-start", warnings: [] }, ...parts, { type: "finish", usage, finishReason }] }) };
    },
  } as never);
  return { model, steps: () => i, seenPrompts };
}

function deps(model: unknown, over: Partial<PriceAgentDeps> = {}): { d: PriceAgentDeps; searched: string[]; fetched: string[] } {
  const searched: string[] = [];
  const fetched: string[] = [];
  const d: PriceAgentDeps = {
    model: model as PriceAgentDeps["model"],
    search: async (q) => {
      searched.push(q);
      return [
        { title: "Уголь ДПК — прайс", url: "https://a.ru/coal", domain: "a.ru", snippet: "" },
        { title: "Видео про уголь", url: "https://youtube.com/watch?v=1", domain: "youtube.com", snippet: "" },
      ];
    },
    fetchPage: async (url) => {
      fetched.push(url);
      return { ok: true, html: PAGE, finalUrl: url };
    },
    stepRub: ({ input, output }) => (input * 2 + output * 10) / 1_000_000 * 90,
    today: () => "2026-10-29",
    ...over,
  };
  return { d, searched, fetched };
}

const WANTED = { name: "Уголь каменный ДПК", unit: "т", region: null };

test("агент ищет, читает страницу из результатов, сообщает цену — код принимает верную и отклоняет выдуманную цитату; видео-сайты отброшены", async () => {
  const { model, steps } = scripted([
    [call("1", "search_web", { query: "уголь ДПК цена оптом" })],
    [call("2", "read_page", { url: "https://a.ru/coal" })],
    [call("3", "report_price", { url: "https://a.ru/coal", ...OFFER }), call("4", "report_price", { url: "https://a.ru/coal", ...OFFER, price: 4200, quote: "Каменный уголь ДПК навалом — 4 200 руб. за тонну" })],
    say("готово"),
  ]);
  const { d, searched, fetched } = deps(model);
  const r = await runPriceAgent(d, { wanted: WANTED, capRub: 30 });
  assert.deepEqual(searched, ["уголь ДПК цена оптом"]);
  assert.deepEqual(fetched, ["https://a.ru/coal"]);
  assert.equal(r.accepted.length, 1, "верная цена принята");
  assert.equal(r.accepted[0].priceNoVat, 5000);
  assert.match(r.accepted[0].source, /a\.ru/);
  assert.equal(r.rejected.length, 1, "цитаты нет на странице — отклонено кодом");
  assert.equal(r.pages.length, 1);
  assert.equal(r.pages[0].status, "read");
  assert.equal(steps(), 4);
  assert.ok(r.spentRub > 0, "расход шагов посчитан");
  assert.equal(r.stoppedByCap, false);
});

test("читать можно только страницы из результатов поиска; сообщить цену — только с прочитанной страницы", async () => {
  const { model } = scripted([
    [call("1", "read_page", { url: "https://evil.example/page" })],
    [call("2", "report_price", { url: "https://a.ru/coal", ...OFFER })],
    say("готово"),
  ]);
  const { d, fetched } = deps(model);
  const r = await runPriceAgent(d, { wanted: WANTED, capRub: 30 });
  assert.deepEqual(fetched, [], "чужой адрес не скачивался");
  assert.equal(r.accepted.length, 0, "цена с непрочитанной страницы не принята");
});

test("лимит поисков: четвёртый поиск не выполняется", async () => {
  const { model } = scripted([1, 2, 3, 4].map((n) => [call(String(n), "search_web", { query: `запрос ${n}` })]));
  const { d, searched } = deps(model);
  await runPriceAgent(d, { wanted: WANTED, capRub: 30 });
  assert.deepEqual(searched, ["запрос 1", "запрос 2", "запрос 3"]);
});

test("потолок в рублях: шаги дороже потолка — агент останавливается, поиск при нехватке денег не запускается", async () => {
  const { model, steps } = scripted([1, 2, 3, 4, 5].map((n) => [call(String(n), "search_web", { query: `запрос ${n}` })]));
  const { d, searched } = deps(model, { stepRub: () => 2 });
  const r = await runPriceAgent(d, { wanted: WANTED, capRub: 5 });
  assert.equal(r.stoppedByCap, true);
  assert.ok(steps() <= 3, `шагов было ${steps()}`);
  assert.ok(r.spentRub <= 6, `потрачено ${r.spentRub} ₽`);
  assert.ok(searched.length <= 2);
});

test("набрано пять цен — агент заканчивает, не дожидаясь лимитов", async () => {
  const offers = [5000, 5000, 5000, 5000, 5000].map((p, i) => call(String(10 + i), "report_price", { url: "https://a.ru/coal", ...OFFER, product: `Каменный уголь ДПК ${i}` }));
  const { model, steps } = scripted([[call("1", "search_web", { query: "уголь" })], [call("2", "read_page", { url: "https://a.ru/coal" })], offers, [call("9", "search_web", { query: "ещё" })]]);
  const { d, searched } = deps(model);
  const r = await runPriceAgent(d, { wanted: WANTED, capRub: 30 });
  assert.ok(r.accepted.length >= 1);
  assert.equal(searched.length, 1, "после набранных цен новых поисков нет");
  assert.ok(steps() <= 4);
});
