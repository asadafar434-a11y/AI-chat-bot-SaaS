// Страница поставщика → текст для модели: разметка и скрипты убираются, цены и их соседние строки остаются, объём ограничен — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { htmlToLines, normalizeForQuote, priceExcerpt, textToHtml, titleOf } from "./page-text.ts";

const HTML = `<!doctype html><html><head><title>Уголь ДПК &mdash; купить оптом</title><script>var price = "99999 руб";</script><style>.a{color:red}</style></head>
<body><nav>Главная | Каталог</nav><h1>Уголь марки Д (ДПК)</h1><p>Фракция 50-200 мм.</p>
<table><tr><td>Уголь ДПК 50-200</td><td>Оптовая цена</td><td>11&nbsp;130 руб./т</td></tr></table>
<p>Доставка по Санкт-Петербургу.</p><!-- скрытое: цена 1 руб --><footer>Копирайт</footer></body></html>`;

test("название страницы и видимый текст: скрипты, стили и комментарии убираются, сущности читаются, ячейки таблицы остаются в одной строке", () => {
  assert.equal(titleOf(HTML), "Уголь ДПК — купить оптом");
  const lines = htmlToLines(HTML);
  const text = lines.join("\n");
  assert.equal(text.includes("99999"), false, "скрипт не попал в текст");
  assert.equal(text.includes("color:red"), false);
  assert.equal(text.includes("скрытое"), false, "комментарий не попал в текст");
  assert.ok(lines.some((l) => /Уголь ДПК 50-200 \| Оптовая цена \| 11 130 руб\.\/т/.test(l)), lines.join(" / "));
});

test("отрывок для модели: начало страницы и строки с ценой с соседями; повторы строк убираются; объём не больше предела", () => {
  const long = `<html><body>${"<p>Просто текст без цены и без чисел.</p>".repeat(400)}<p>Опт</p><p>Уголь ДПК — 11 130 руб. за тонну</p><p>Самовывоз</p></body></html>`;
  const ex = priceExcerpt(long, 4_000);
  assert.ok(ex.text.length <= 4_000);
  assert.match(ex.text, /Уголь ДПК — 11 130 руб\. за тонну/);
  assert.match(ex.text, /Опт\n/, "соседняя строка перед ценой сохранена");
  assert.match(ex.text, /Самовывоз/, "соседняя строка после цены сохранена");
  assert.equal(ex.text.split("Просто текст без цены и без чисел.").length - 1 <= 1, true, "одинаковые строки не повторяются");
  const small = priceExcerpt(HTML);
  assert.equal(small.title, "Уголь ДПК — купить оптом");
  assert.equal(small.truncated, false);
});

test("слишком длинный отрывок помечается обрезанным", () => {
  const many = `<html><body>${Array.from({ length: 300 }, (_, i) => `<p>Товар ${i} цена ${1000 + i} руб.</p>`).join("")}</body></html>`;
  const ex = priceExcerpt(many, 3_000);
  assert.equal(ex.truncated, true);
  assert.ok(ex.text.length <= 3_000);
});

test("текст, прочитанный в браузере, → страница того же вида: строки в абзацах, разметка в тексте экранирована, пустые строки отброшены; цена из такого текста попадает в отрывок", () => {
  const html = textToHtml("Каталог <угля>", "Уголь ДПК\n\n  Оптовая цена 11 130 руб. & самовывоз\n<script>alert(1)</script>");
  assert.equal(titleOf(html), "Каталог <угля>");
  assert.deepEqual(htmlToLines(html), ["Уголь ДПК", "Оптовая цена 11 130 руб. & самовывоз", "<script>alert(1)</script>"], "теги из текста остаются текстом, не разметкой");
  assert.match(priceExcerpt(html).text, /Оптовая цена 11 130 руб\./);
});

test("сверка цитат: регистр, «ё», пробелы и неразрывные пробелы не мешают", () => {
  assert.equal(normalizeForQuote("  Цена:  11 130 РУБ.  Ёлка "), "цена: 11 130 руб. елка");
  assert.ok(normalizeForQuote("Оптовая  цена\n11 130 руб").includes(normalizeForQuote("оптовая цена 11 130 руб")));
});
