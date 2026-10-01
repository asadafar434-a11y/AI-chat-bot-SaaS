// Сверка цитат и поиск их места в документе — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fragmentsOf, matchQuote, normalize, quoteChecker, quoteFound } from "./quotes.ts";

// Прежняя нормализация, как была до поиска мест: цепочка замен. Новое в ней одно — «|» между ячейками таблицы читается как пробел.
const reference = (s: string) =>
  s
    .replace(/\|/g, " ")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»“”„"]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[­​]/g, "")
    .replace(/\s+/g, " ")
    .trim();

test("нормализация с позициями даёт тот же текст, что цепочка замен — на случайных строках", () => {
  const alphabet = ["а", "Б", "ё", "Ё", "z", "Q", "7", " ", " ", "\n", "\t", " ", "|", "«", "»", "“", '"', "-", "—", "–", "−", "­", "​", ".", ",", "…"];
  let seed = 12345;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let n = 0; n < 2000; n++) {
    const s = Array.from({ length: Math.floor(next() * 40) }, () => alphabet[Math.floor(next() * alphabet.length)]).join("");
    assert.equal(normalize(s).text, reference(s), JSON.stringify(s));
    assert.equal(normalize(s, false).text, reference(s), JSON.stringify(s));
    assert.equal(normalize(s, false).at, null);
  }
});

test("позиция каждого знака ведёт обратно к тому же знаку исходного текста", () => {
  const s = "  Зал  вместимостью\nне менее 150 мест — «с гардеробом»  ";
  const n = normalize(s);
  assert.equal(n.at?.length, n.text.length);
  for (let i = 0; i < n.text.length; i++) {
    const original: string = s[n.at![i]];
    if (n.text[i] === " ") assert.match(original, /\s/);
    else assert.equal(normalize(original, false).text, n.text[i]);
  }
});

test("цитата находится: другой регистр, «ё», кавычки, тире, переносы строк, строка таблицы без «|»", () => {
  const doc = "Зал  вместимостью\nне менее 150 мест — «с гардеробом».\n1 | Бумага А4 | 100 | пачек";
  assert.equal(quoteFound("зал вместимостью не менее 150 мест", [doc]), true);
  assert.equal(quoteFound("«С ГАРДЕРОБОМ»", [doc]), true, "регистр и кавычки не важны");
  assert.equal(quoteFound("Бумага А4 | 100 | пачек", [doc]), true);
  assert.equal(quoteFound("Бумага А4 100 пачек", [doc]), true, "ИИ часто переписывает строку таблицы без разделителей");
  assert.equal(quoteFound("Бумага А4 — 100 пачек", [doc]), false, "слова другие — не цитата");
});

test("цитата с многоточием: каждый кусок должен быть в тексте; короткие куски не в счёт; выдумка — нет", () => {
  const doc = "Исполнитель обязан обеспечить площадку проведения: зал вместимостью не менее 150 мест, с гардеробом.";
  assert.equal(quoteFound("Исполнитель обязан обеспечить площадку ... не менее 150 мест", [doc]), true);
  assert.equal(quoteFound("Исполнитель обязан обеспечить площадку … не менее 200 мест", [doc]), false);
  assert.equal(quoteFound("…", [doc]), false);
  assert.equal(quoteFound("зал", [doc]), false, "кусок короче восьми знаков не доказывает ничего");
  assert.deepEqual(fragmentsOf("Первый кусок цитаты ... и второй кусок цитаты ... да"), ["первый кусок цитаты", "и второй кусок цитаты"]);
});

test("кусок цитаты может быть в одном документе, а другой — в другом", () => {
  assert.equal(quoteFound("зал вместимостью не менее 150 мест ... срок оказания услуг 5 дней", ["Зал вместимостью не менее 150 мест", "Срок оказания услуг 5 дней"]), true);
});

test("проверка по многим цитатам даёт те же ответы, что поодиночке", () => {
  const docs = ["Срок подачи заявок — до 10 октября, 10:00 МСК.", "Обеспечение исполнения контракта — 5 % от цены."];
  const quotes = ["Срок подачи заявок до 10 октября", "обеспечение исполнения контракта — 5 %", "выдуманная цитата про срок", ""];
  const check = quoteChecker(docs);
  for (const q of quotes) assert.equal(check(q), quoteFound(q, docs), q);
});

test("место цитаты: позиции исходного текста; несколько вхождений; нет цитаты — null", () => {
  const doc = "Вступление.\n\nЗал не менее 150 мест — обязательно.\n\nИтого: зал  не менее 150 мест (см. выше).";
  const found = matchQuote("зал не менее 150 мест", normalize(doc));
  assert.ok(found);
  assert.equal(found.length, 2);
  assert.equal(doc.slice(found[0].from, found[0].to), "Зал не менее 150 мест");
  assert.equal(doc.slice(found[1].from, found[1].to), "зал  не менее 150 мест", "лишние пробелы внутри остаются в границах места");
  assert.equal(matchQuote("зал не менее 500 мест", normalize(doc)), null);
  assert.equal(matchQuote("зал", normalize(doc)), null);
});

test("место цитаты не сдвигается от «|», «ё», тире, мягких переносов и кавычек в тексте", () => {
  const doc = "Таблица:\n№ | Наимено­вание | Всё\n2 | «Ёлка» — искусственная | 5 шт.";
  const n = normalize(doc);
  const a = matchQuote("Наименование Все", n);
  assert.ok(a);
  assert.equal(doc.slice(a[0].from, a[0].to), "Наимено­вание | Всё");
  const b = matchQuote('"ёлка" - искусственная', n);
  assert.ok(b);
  assert.equal(doc.slice(b[0].from, b[0].to), "«Ёлка» — искусственная");
});

test("места не ищутся в тексте, нормализованном без позиций", () => {
  assert.throws(() => matchQuote("любая достаточно длинная цитата", normalize("текст", false)), /без позиций/);
});

test("большой документ нормализуется быстро (по нему проверяют десятки цитат)", () => {
  const big = "Исполнитель обязан обеспечить площадку.\n".repeat(20000); // ≈ 780 тыс. знаков
  const started = performance.now();
  const check = quoteChecker([big]);
  for (let i = 0; i < 50; i++) check(`Исполнитель обязан обеспечить площадку ${i}`);
  assert.ok(performance.now() - started < 3000, `заняло ${Math.round(performance.now() - started)} мс`);
});
