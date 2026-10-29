// Встроенный поиск модели: страницы из блоков ответа, ошибка поиска, учёт расхода — npm test (без сети и денег).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createModelSearch, hitsFromContent, SEARCH_SYSTEM, WEB_SEARCH_FEE_USD } from "./model-search.ts";

const result = (...urls: string[]) => ({
  type: "web_search_tool_result",
  tool_use_id: "srvtoolu_1",
  content: urls.map((url) => ({ type: "web_search_result", url, title: `Страница ${url}`, page_age: null, encrypted_content: "x" })),
});

test("страницы берутся из web_search_tool_result: адрес, название, домен без www; повторы и чужие схемы отбрасываются", () => {
  const { hits, error } = hitsFromContent([
    { type: "text", text: "готово" },
    result("https://www.mebel.ru/stol-1", "https://mebel.ru/stol-1", "https://shop.ru/catalog?id=2", "javascript:alert(1)", "не адрес"),
  ]);
  assert.equal(error, null);
  assert.deepEqual(hits.map((h) => [h.url, h.domain]), [["https://www.mebel.ru/stol-1", "mebel.ru"], ["https://mebel.ru/stol-1", "mebel.ru"], ["https://shop.ru/catalog?id=2", "shop.ru"]]);
  assert.equal(hits[0].title, "Страница https://www.mebel.ru/stol-1");
});

test("ошибка поиска приходит блоком, а не исключением: без единой страницы это ошибка, со страницами — нет", () => {
  const failed = { type: "web_search_tool_result", tool_use_id: "s", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } };
  assert.deepEqual(hitsFromContent([failed]), { hits: [], error: "max_uses_exceeded" });
  assert.equal(hitsFromContent([failed, result("https://a.ru/p")]).error, null);
  assert.deepEqual(hitsFromContent([{ type: "text", text: "готово" }]), { hits: [], error: null });
});

test("createModelSearch: передаёт запрос и задание, сообщает расход каждого вызова; ошибка поиска — исключение", async () => {
  const seen: [string, string][] = [];
  const costs: number[] = [];
  const ok = createModelSearch(async (system, query) => {
    seen.push([system, query]);
    return { content: [result("https://a.ru/p")], usd: 0.02 };
  }, (usd) => costs.push(usd));
  const hits = await ok("стол офисный цена оптом");
  assert.equal(hits.length, 1);
  assert.deepEqual(seen, [[SEARCH_SYSTEM, "стол офисный цена оптом"]]);
  assert.deepEqual(costs, [0.02]);

  const bad = createModelSearch(async () => ({ content: [{ type: "web_search_tool_result", content: { error_code: "unavailable" } }], usd: 0.011 }), (usd) => costs.push(usd));
  await assert.rejects(() => bad("q"), /поиск моделью не удался: unavailable/);
  assert.deepEqual(costs, [0.02, 0.011], "деньги за неудавшийся поиск тоже посчитаны");
});

test("плата за поиск — $0,01 за запрос", () => {
  assert.equal(WEB_SEARCH_FEE_USD, 0.01);
});
