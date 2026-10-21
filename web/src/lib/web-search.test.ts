// Проверка гипотез обычным поиском: что уходит в поиск, как читается ответ, что сохраняется — npm test (без сети).
import assert from "node:assert/strict";
import { test } from "node:test";
import { SEARCHABLE, queryFor } from "./search-queries.ts";
import { cleanQuery, domainOf, normalizeSearches, parseDuckDuckGoHtml, realUrl, MAX_HITS } from "./web-search.ts";

// Ответ в том виде, как отдаёт html.duckduckgo.com: переадресация uddg, реклама, сущности в тексте.
const result = (url: string, title: string, snippet: string, cls = "result results_links results_links_deep web-result ") => `
  <div class="${cls}">
    <div class="links_main links_deep result__body">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(url)}&amp;rut=ab78">${title}</a>
      </h2>
      <div class="result__extras"><a class="result__url" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(url)}&amp;rut=ab78">${url}</a></div>
      <a class="result__snippet" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(url)}&amp;rut=ab78">${snippet}</a>
    </div>
  </div>`;

const PAGE = `<html><body><div id="links" class="results">
${result("https://kuban-kargo.ru/izmenenie-stoimosti/", "Изменение стоимости грузоперевозок в г. Симферополь и г. Севастополь ...", "С 09 июня 2026 года стоимость перевозки грузов <b>рассчитывается</b> индивидуально!")}
${result("https://www.example-ads.ru/buy", "Реклама", "Купите сейчас", "result results_links result--ad ")}
${result("https://vozovoz.ru/news/a_b/?x=1&y=2", "Возовоз &laquo;Тарифы&raquo; &amp; сроки", "Новости &nbsp;транспортной компании")}
${result("https://kuban-kargo.ru/izmenenie-stoimosti/", "Повтор той же страницы", "Тот же адрес")}
${result("javascript:alert(1)", "Опасная ссылка", "не должна попасть")}
</div></body></html>`;

test("ответ поиска: настоящие адреса вместо переадресации, текст без разметки и сущностей, реклама и повторы отброшены", () => {
  const hits = parseDuckDuckGoHtml(PAGE);
  assert.equal(hits.length, 2);
  assert.deepEqual(hits[0], {
    title: "Изменение стоимости грузоперевозок в г. Симферополь и г. Севастополь ...",
    url: "https://kuban-kargo.ru/izmenenie-stoimosti/",
    domain: "kuban-kargo.ru",
    snippet: "С 09 июня 2026 года стоимость перевозки грузов рассчитывается индивидуально!",
  });
  assert.equal(hits[1].title, "Возовоз «Тарифы» & сроки");
  assert.equal(hits[1].url, "https://vozovoz.ru/news/a_b/?x=1&y=2");
  assert.equal(hits[1].snippet, "Новости транспортной компании");
  assert.ok(!hits.some((h) => /ads|javascript/.test(h.url)));
});

test("ответ поиска: не больше шести результатов; пустая страница и страница с проверкой «вы не робот» дают пустой список", () => {
  const many = Array.from({ length: 12 }, (_, i) => result(`https://site${i}.ru/p`, `Страница ${i}`, "текст")).join("");
  assert.equal(parseDuckDuckGoHtml(`<div id="links">${many}</div>`).length, MAX_HITS);
  assert.deepEqual(parseDuckDuckGoHtml(""), []);
  assert.deepEqual(parseDuckDuckGoHtml("<html><body><form>Подтвердите, что вы не робот</form></body></html>"), []);
});

test("адрес: переадресация раскрывается, только http и https, без адреса — null", () => {
  assert.equal(realUrl("//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.ru%2Fx%3Fy%3D1&amp;rut=1"), "https://a.ru/x?y=1");
  assert.equal(realUrl("https://b.ru/page"), "https://b.ru/page");
  assert.equal(realUrl("//duckduckgo.com/l/?uddg=javascript%3Aalert(1)"), null);
  assert.equal(realUrl("javascript:alert(1)"), null);
  assert.equal(realUrl("//duckduckgo.com/l/?rut=1"), null);
  assert.equal(realUrl(""), null);
  assert.equal(domainOf("https://www.vozovoz.ru/news"), "vozovoz.ru");
});

test("запрос: ключевые слова проходят, лишние пробелы убираются", () => {
  assert.deepEqual(cleanQuery("  тарифы   на доставку грузов Севастополь 2026 "), { ok: true, query: "тарифы на доставку грузов Севастополь 2026" });
  assert.deepEqual(cleanQuery("рост цен 2025 2026 2027"), { ok: true, query: "рост цен 2025 2026 2027" });
});

test("запрос: почта, адрес сайта, телефон, ИНН и номер извещения в поиск не уходят; слишком короткий и длинный — отказ", () => {
  for (const bad of ["цены ivan@firma.ru", "тариф https://site.ru/a", "тариф www.site.ru", "доставка firma.ru", "позвоните +7 (912) 000-00-00", "звонить 8 912 000 00 00", "ИНН 6612345676 тарифы", "извещение 0373200123426000123 цена"]) {
    const r = cleanQuery(bad);
    assert.equal(r.ok, false, bad);
  }
  assert.equal(cleanQuery("ab").ok, false);
  assert.equal(cleanQuery("").ok, false);
  assert.equal(cleanQuery(42).ok, false);
  assert.equal(cleanQuery("а".repeat(161)).ok, false);
  const r = cleanQuery("ИНН 6612345676");
  assert.ok(!r.ok && /длинное число/.test(r.reason));
});

test("запросы под гипотезы: ключевые слова, год и регион из документов; без региона — по России; для остальных гипотез запроса нет", () => {
  assert.equal(queryFor("logistics", { year: 2026, place: "Севастополь" }), "тарифы на доставку грузов Севастополь 2026");
  assert.equal(queryFor("logistics", { year: 2026, place: null }), "тарифы на грузоперевозки по России 2026");
  assert.equal(queryFor("trips", { year: 2026, place: "Камчатский край" }), "цена дизельного топлива бензина Камчатский край 2026");
  assert.equal(queryFor("cashgap", { year: 2026, place: null }), null);
  assert.equal(queryFor("penalties", { year: 2026, place: null }), null);
  for (const id of SEARCHABLE) {
    for (const place of [null, "Севастополь", "Ямало-Ненецкий автономный округ"]) {
      const q = queryFor(id, { year: 2026, place })!;
      const check = cleanQuery(q);
      assert.ok(check.ok, `${id}/${place}: ${q}`);
    }
  }
});

test("сохранённые поиски: берём понятное, ссылки только http и https, не больше шести результатов, повреждённое отбрасываем", () => {
  const raw = {
    logistics: {
      query: "тарифы на доставку грузов Севастополь 2026",
      at: "2026-10-21T10:00:00.000Z",
      provider: "DuckDuckGo",
      hits: [
        { title: "Ок", url: "https://a.ru/x", domain: "подделка", snippet: "текст" },
        { title: "Опасная", url: "javascript:alert(1)", snippet: "x" },
        42,
        null,
        ...Array.from({ length: 10 }, (_, i) => ({ title: `t${i}`, url: `https://s${i}.ru`, snippet: "" })),
      ],
    },
    broken: "строка",
    empty: { query: "", hits: [] },
    list: [1, 2],
  };
  const out = normalizeSearches(raw);
  assert.deepEqual(Object.keys(out), ["logistics"]);
  assert.equal(out.logistics.hits.length, 6);
  assert.deepEqual(out.logistics.hits[0], { title: "Ок", url: "https://a.ru/x", domain: "a.ru", snippet: "текст" });
  assert.ok(out.logistics.hits.every((h) => /^https?:\/\//.test(h.url)));
  assert.deepEqual(normalizeSearches(null), {});
  assert.deepEqual(normalizeSearches([1]), {});
});
