// Разбиение на фрагменты базы знаний — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHUNK_MAX, chunkText } from "./kb-chunk.ts";

test("пустой текст не даёт фрагментов", () => {
  assert.deepEqual(chunkText("   \n\n  "), []);
});

test("заголовок статьи идёт отдельной меткой и относится к следующему абзацу", () => {
  const chunks = chunkText("Статья 12. Обеспечение заявки\n\nЗаказчик вправе установить обеспечение.\n\nСумма не выше одного процента.");
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].heading, "Статья 12. Обеспечение заявки");
  assert.match(chunks[0].text, /установить обеспечение/);
});

test("нумерованный пункт «2.4.1» тоже считается заголовком", () => {
  const [chunk] = chunkText("2.4.1 Требования к опыту\n\nУчастник подтверждает опыт договорами.");
  assert.equal(chunk.heading, "2.4.1 Требования к опыту");
});

test("абзацы складываются в фрагменты до лимита и не режутся посередине", () => {
  const para = "а".repeat(500);
  const chunks = chunkText([para, para, para].join("\n\n"));
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].text, `${para}\n\n${para}`);
  assert.equal(chunks[1].text, para);
});

test("длинный абзац делится по предложениям, каждый фрагмент не длиннее лимита", () => {
  const sentence = "Заказчик проверяет заявку по перечню документов. ";
  const chunks = chunkText(sentence.repeat(80));
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= CHUNK_MAX, `фрагмент ${chunk.text.length} знаков больше ${CHUNK_MAX}`);
    assert.ok(chunk.text.endsWith("."), "фрагмент должен заканчиваться на конце предложения");
  }
});

test("сверхдлинное слово без пробелов режется по знакам, а не теряется", () => {
  const word = "я".repeat(CHUNK_MAX * 2 + 10);
  const chunks = chunkText(word);
  assert.equal(chunks.map((c) => c.text).join(""), word);
  assert.ok(chunks.every((c) => c.text.length <= CHUNK_MAX));
});

test("заголовок переносится на все фрагменты после него, пока не встретится следующий", () => {
  const big = "б".repeat(CHUNK_MAX - 10);
  const chunks = chunkText(`Глава 1. Общие положения\n\n${big}\n\n${big}\n\nГлава 2. Порядок\n\nтекст`);
  assert.deepEqual(
    chunks.map((c) => c.heading),
    ["Глава 1. Общие положения", "Глава 1. Общие положения", "Глава 2. Порядок"],
  );
});
