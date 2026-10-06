// Токены и локальные векторы базы знаний — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cosine, EMBED_DIMS, embedText, LOCAL_EMBEDDER_ID, localEmbedder, stemOf, tokensOf } from "./kb-embed.ts";

test("служебные слова не попадают в признаки, числа остаются целыми", () => {
  assert.deepEqual(tokensOf("и в на 44 ФЗ"), ["44", "фз"]);
});

test("разные окончания одного слова дают одну основу", () => {
  assert.equal(stemOf("гарантия"), stemOf("гарантии"));
  assert.equal(tokensOf("гарантия")[0], tokensOf("гарантии")[0]);
});

test("ё и е считаются одной буквой", () => {
  assert.deepEqual(tokensOf("Ёлка"), tokensOf("елка"));
});

test("вектор имеет фиксированную длину, нормирован и детерминирован", () => {
  const v = embedText("Обеспечение заявки на участие в закупке");
  assert.equal(v.length, EMBED_DIMS);
  assert.ok(Math.abs(Math.sqrt(v.reduce((s, x) => s + x * x, 0)) - 1) < 1e-9);
  assert.deepEqual(embedText("Обеспечение заявки на участие в закупке"), v);
});

test("текст без смысловых слов даёт нулевой вектор, с ним не совпадает ничего", () => {
  const zero = embedText("и в на");
  assert.ok(zero.every((x) => x === 0));
  assert.equal(cosine(zero, embedText("обеспечение заявки")), 0);
});

test("другое окончание того же слова ближе, чем другое слово", () => {
  const base = embedText("гарантия качества");
  assert.ok(cosine(base, embedText("гарантии качества")) > cosine(base, embedText("погода на завтра")));
});

test("локальный эмбеддер называет себя и отдаёт векторы пакетом", async () => {
  const [a, b] = await localEmbedder.embed(["срок подачи заявок", "срок подачи заявок"]);
  assert.equal(localEmbedder.id, LOCAL_EMBEDDER_ID);
  assert.deepEqual(a, b);
});
