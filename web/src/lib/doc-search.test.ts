// Поиск по словам в документах закупки — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fragmentsOf, piecesOf, searchDocuments, type SearchResult } from "./doc-search.ts";

const NOTICE =
  "Обеспечение заявки — 1 % НМЦК.\nБанковская гарантия принимается. Гарантией обеспечивается исполнение контракта. " +
  "Закупка по 44-ФЗ, ст. 30; пункт 440 не применяется.";
const DOCS = [
  { name: "Извещение", text: NOTICE },
  { name: "ТЗ", text: "Поставка ёлок и елок к празднику. Срок — 10 дней.", scan: true },
];

// Найденные места — словами из исходного текста, по документам.
const found = (r: SearchResult | null) =>
  Object.fromEntries(r!.docs.map((d) => [d.name, d.hits.map((h) => d.text.slice(h.start, h.end))]));

test("слово ищется по основе: окончание и регистр не важны", () => {
  const r = searchDocuments(DOCS, "гарантия");
  assert.equal(r?.mode, "phrase");
  assert.deepEqual(found(r), { Извещение: ["гарантия", "Гарантией"], ТЗ: [] });
});

test("фраза — целиком, через знаки препинания и перенос строки", () => {
  assert.deepEqual(found(searchDocuments(DOCS, "обеспечения заявок")), { Извещение: ["Обеспечение заявки"], ТЗ: [] });
  assert.deepEqual(found(searchDocuments(DOCS, "нмцк банковская")), { Извещение: ["НМЦК.\nБанковская"], ТЗ: [] });
});

test("нет фразы целиком — ищем значимые слова по отдельности, без предлогов", () => {
  const r = searchDocuments(DOCS, "обеспечение по исполнению");
  assert.equal(r?.mode, "words");
  assert.deepEqual(r?.words, ["обеспечение", "исполнению"]);
  assert.deepEqual(found(r), { Извещение: ["Обеспечение", "исполнение"], ТЗ: [] });
});

test("числа и слова из одной-двух букв — только целиком", () => {
  assert.deepEqual(found(searchDocuments(DOCS, "44")), { Извещение: ["44"], ТЗ: [] });
  assert.deepEqual(found(searchDocuments(DOCS, "10")), { Извещение: [], ТЗ: ["10"] });
  // «ст» находит «ст. 30», но не буквы внутри «Поставка»; «44» — «44-ФЗ», но не «440».
  assert.deepEqual(found(searchDocuments(DOCS, "ст")), { Извещение: ["ст"], ТЗ: [] });
});

test("«е» и «ё» — одна буква, а места совпадают с исходным текстом", () => {
  for (const query of ["ёлок", "елок", "ЕЛОК"]) {
    assert.deepEqual(found(searchDocuments(DOCS, query)).ТЗ, ["ёлок", "елок"], query);
  }
  assert.equal(searchDocuments(DOCS, "ёлок")!.docs[1].scan, true);
});

test("слишком короткий запрос — не ищем; знаки препинания в запросе — не образец", () => {
  for (const query of ["", "   ", "в", "?!", "С++"]) assert.equal(searchDocuments(DOCS, query), null, JSON.stringify(query));
  // Одни предлоги: фразы нет, а по отдельности они нашлись бы везде — не ищем их поодиночке.
  const r = searchDocuments(DOCS, "в на");
  assert.equal(r?.mode, "phrase");
  assert.ok(r?.docs.every((d) => d.total === 0));
  // Скобки, точки и звёздочки из запроса не ломают поиск.
  assert.deepEqual(found(searchDocuments(DOCS, "(гарантия.*)")).Извещение, ["гарантия", "Гарантией"]);
});

test("в запросе не больше 8 слов, в документе показываем не больше 200 мест, но считаем все", () => {
  const long = "один два три четыре пять шесть семь восемь девять десять";
  assert.equal(searchDocuments(DOCS, long)!.words.length, 8);

  const text = "гарантия ".repeat(250);
  const [doc] = searchDocuments([{ name: "Много", text }], "гарантия")!.docs;
  assert.equal(doc.hits.length, 200);
  assert.equal(doc.total, 250);
});

test("отрывки: близкие места — одним отрывком, края — по границе слов", () => {
  const { text, hits } = searchDocuments(DOCS, "гарантия")!.docs[0];
  const one = fragmentsOf(text, hits, 20);
  assert.equal(one.length, 1);
  assert.equal(one[0].marks.length, 2);
  // Далеко друг от друга при малом радиусе — два отрывка.
  assert.equal(fragmentsOf(text, hits, 5).length, 2);

  for (const radius of [5, 12, 20, 40]) {
    for (const { from, to, marks } of fragmentsOf(text, hits, radius)) {
      assert.ok(from === 0 || /\s/.test(text[from - 1]), `начало отрывка в середине слова, радиус ${radius}`);
      assert.ok(to === text.length || /\s/.test(text[to]), `конец отрывка в середине слова, радиус ${radius}`);
      assert.ok(from <= marks[0].start && marks.at(-1)!.end <= to);
    }
  }
});

test("кусочки отрывка: переносы строк — пробелом, найденное помечено", () => {
  const { text, hits } = searchDocuments(DOCS, "гарантия")!.docs[0];
  const [fragment] = fragmentsOf(text, hits, 20);
  const pieces = piecesOf(text, fragment);
  assert.deepEqual(
    pieces.filter((p) => p.mark).map((p) => p.text),
    ["гарантия", "Гарантией"]
  );
  const joined = pieces.map((p) => p.text).join("");
  assert.doesNotMatch(joined, /\n|\s{2}/);
  assert.equal(joined, joined.trim());
  assert.match(joined, /НМЦК\. Банковская гарантия принимается\. Гарантией/);
});
