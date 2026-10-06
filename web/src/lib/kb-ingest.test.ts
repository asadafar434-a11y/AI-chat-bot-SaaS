// Приём документов в базу знаний — npm test. Эмбеддер подсчитан: видно, сколько векторов посчитано, а сколько взято.
import assert from "node:assert/strict";
import { test } from "node:test";
import { localEmbedder, type Embedder } from "./kb-embed.ts";
import { deleteDocument, ingestDocument, normalizeMeta, reindexAll, type IngestInput } from "./kb-ingest.ts";
import { createMemoryKbStore } from "./kb-store.ts";
import { KbError, type KbOwner } from "./kb-types.ts";

const GLOBAL: KbOwner = { kind: "global", approvedBy: "Владелец продукта" };
const ORG_A: KbOwner = { kind: "org", organizationId: "cklorgaaaaaaaaaaaaaaaaa1" };
const ORG_B: KbOwner = { kind: "org", organizationId: "cklorgbbbbbbbbbbbbbbbbb2" };

// Три абзаца по ~900 знаков: каждый становится своим фрагментом.
const para = (word: string) => `${word} `.repeat(150).trim();
const TEXT = [para("первый"), para("второй"), para("третий")].join("\n\n");

function counting(base: Embedder = localEmbedder, id = base.id) {
  const state = { calls: 0, texts: 0 };
  const embedder: Embedder = {
    id,
    async embed(texts) {
      state.calls++;
      state.texts += texts.length;
      return base.embed(texts);
    },
  };
  return { embedder, state };
}

const input = (over: Partial<IngestInput> = {}): IngestInput => ({
  owner: GLOBAL,
  sourceKey: "doc:1",
  name: "Тестовый документ",
  source: "тест",
  text: TEXT,
  meta: { documentType: "instruction" },
  ...over,
});

test("новый документ: разбит на фрагменты, векторы посчитаны и сохранены", async () => {
  const store = createMemoryKbStore();
  const { embedder, state } = counting();
  const result = await ingestDocument(store, embedder, input(), new Date("2026-10-06T10:00:00Z"));

  assert.equal(result.status, "created");
  assert.equal(result.document.version, 1);
  assert.equal(result.document.status, "active");
  assert.equal(result.chunks, 3);
  assert.equal(result.embedded, 3);
  assert.equal(result.reused, 0);
  assert.equal(state.calls, 1, "все новые фрагменты считаются одним пакетом");

  const stored = await store.searchable(["global"]);
  assert.equal(stored.length, 3);
  assert.equal(stored[0].chunk.embeddingModel, embedder.id);
  assert.equal(stored[0].chunk.embedding.length, 512);
  assert.equal(await store.getSourceText(result.document.id), TEXT);
});

test("тот же документ второй раз: ничего не индексируется заново, векторы не считаются", async () => {
  const store = createMemoryKbStore();
  const { embedder, state } = counting();
  await ingestDocument(store, embedder, input());
  const again = await ingestDocument(store, embedder, input());

  assert.equal(again.status, "unchanged");
  assert.equal(again.embedded, 0);
  assert.equal(state.texts, 3, "второй приём не должен ни одного вектора посчитать");
  assert.equal((await store.listDocuments()).length, 1, "дубликата не появилось");
});

test("изменился один абзац: новая версия, заново считается только он", async () => {
  const store = createMemoryKbStore();
  const { embedder, state } = counting();
  await ingestDocument(store, embedder, input());
  const changed = TEXT.replace(para("второй"), para("другой"));
  const result = await ingestDocument(store, embedder, input({ text: changed }));

  assert.equal(result.status, "updated");
  assert.equal(result.document.version, 2);
  assert.equal(result.chunks, 3);
  assert.equal(result.embedded, 1, "пересчитан только изменившийся фрагмент");
  assert.equal(result.reused, 2, "два неизменившихся фрагмента взяты из прошлой версии");
  assert.equal(state.texts, 4);
  assert.equal((await store.searchable(["global"])).length, 3, "старые фрагменты не остались рядом с новыми");
});

test("изменились только метаданные: текст не трогаем, векторы не считаем", async () => {
  const store = createMemoryKbStore();
  const { embedder, state } = counting();
  await ingestDocument(store, embedder, input());
  const result = await ingestDocument(store, embedder, input({ meta: { documentType: "instruction", topic: "Новая тема" } }));

  assert.equal(result.status, "metadata_updated");
  assert.equal(result.embedded, 0);
  assert.equal(result.document.version, 1);
  assert.equal(result.document.meta.topic, "Новая тема");
  assert.equal(state.texts, 3);
});

test("одинаковый текст внутри одного владельца переиспользует векторы, а у другой организации — нет", async () => {
  const store = createMemoryKbStore();
  const { embedder } = counting();
  await ingestDocument(store, embedder, input({ owner: ORG_A }));

  const sameOwner = await ingestDocument(store, embedder, input({ owner: ORG_A, sourceKey: "doc:copy" }));
  assert.equal(sameOwner.embedded, 0, "в своей организации тот же текст пересчитывать не нужно");
  assert.equal(sameOwner.reused, 3);

  // Другая организация, тот же текст: счётчик не должен подсказать, что такой текст уже есть у ORG_A.
  const other = await ingestDocument(store, embedder, input({ owner: ORG_B }));
  assert.equal(other.embedded, 3);
  assert.equal(other.reused, 0);
});

test("глобальный документ без имени утвердившего не принимается", async () => {
  const store = createMemoryKbStore();
  const { embedder } = counting();
  await assert.rejects(
    ingestDocument(store, embedder, input({ owner: { kind: "global", approvedBy: " " } })),
    (e: unknown) => e instanceof KbError && e.code === "invalid_owner",
  );
});

test("организация с неверным идентификатором не принимается", async () => {
  const store = createMemoryKbStore();
  const { embedder } = counting();
  await assert.rejects(
    ingestDocument(store, embedder, input({ owner: { kind: "org", organizationId: "../etc" } })),
    (e: unknown) => e instanceof KbError && e.code === "invalid_owner",
  );
});

test("неизвестный тип документа, закон и год отклоняются, а не подменяются", () => {
  assert.throws(() => normalizeMeta({ documentType: "помойка" as never }), (e: unknown) => e instanceof KbError && e.code === "invalid_meta");
  assert.throws(() => normalizeMeta({ documentType: "law", lawType: "45-FZ" as never }), (e: unknown) => e instanceof KbError && e.code === "invalid_meta");
  assert.throws(() => normalizeMeta({ documentType: "law", year: 1500 }), (e: unknown) => e instanceof KbError && e.code === "invalid_meta");
  assert.deepEqual(normalizeMeta({ documentType: "law" }).lawType, null, "неизвестное — null, а не выдуманное значение");
});

test("пустой текст не принимается", async () => {
  const store = createMemoryKbStore();
  const { embedder } = counting();
  await assert.rejects(ingestDocument(store, embedder, input({ text: "  \n " })), (e: unknown) => e instanceof KbError && e.code === "empty_text");
});

test("удалённый документ выходит из поиска и не хранит текст; повторный приём — следующая версия", async () => {
  const store = createMemoryKbStore();
  const { embedder } = counting();
  const first = await ingestDocument(store, embedder, input());
  const removed = await deleteDocument(store, GLOBAL, "doc:1");

  assert.equal(removed?.status, "deleted");
  assert.equal((await store.searchable(["global"])).length, 0);
  assert.equal(await store.getSourceText(first.document.id), "");

  const back = await ingestDocument(store, embedder, input());
  assert.equal(back.document.version, 2);
  assert.equal(back.status, "updated");
});

test("переиндексация после смены эмбеддера пересчитывает всё один раз и не повторяет лишнего", async () => {
  const store = createMemoryKbStore();
  const first = counting();
  await ingestDocument(store, first.embedder, input());

  const next = counting(localEmbedder, "hashed-ngrams-512-v2");
  const summary = await reindexAll(store, next.embedder);
  assert.equal(summary.documents, 1);
  assert.equal(summary.embedded, 3);
  assert.equal(summary.reused, 0);

  const again = await reindexAll(store, next.embedder);
  assert.equal(again.embedded, 0, "вторая переиндексация ничего не считает");
});
