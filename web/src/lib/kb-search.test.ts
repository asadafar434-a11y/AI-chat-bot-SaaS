// Поиск по базе знаний — npm test: нужный документ, фильтры по метаданным, изоляция по организациям, удалённые.
import assert from "node:assert/strict";
import { test } from "node:test";
import { localEmbedder } from "./kb-embed.ts";
import { deleteDocument, ingestDocument, type IngestInput } from "./kb-ingest.ts";
import { searchKnowledge, TOP_K_MAX } from "./kb-search.ts";
import { createMemoryKbStore, type KbStore } from "./kb-store.ts";
import { KbError, type KbOwner } from "./kb-types.ts";

const GLOBAL: KbOwner = { kind: "global", approvedBy: "Владелец продукта" };
const ORG_A = "cklorgaaaaaaaaaaaaaaaaa1";
const ORG_B = "cklorgbbbbbbbbbbbbbbbbb2";

async function corpus(store: KbStore) {
  const add = (over: Partial<IngestInput> & Pick<IngestInput, "sourceKey" | "name" | "text">) =>
    ingestDocument(store, localEmbedder, { source: "тест", meta: { documentType: "regulation" }, ...over } as IngestInput);

  await add({
    owner: GLOBAL,
    sourceKey: "law:44:art:44",
    name: "44-ФЗ, ст. 44. Обеспечение заявки",
    text: "Статья 44. Обеспечение заявки\n\nЗаказчик вправе установить требование обеспечения заявки на участие в размере не более пяти процентов начальной цены.",
    meta: { documentType: "law", lawType: "44-FZ", category: "обеспечение", reliability: "official" },
  });
  await add({
    owner: GLOBAL,
    sourceKey: "law:44:art:96",
    name: "44-ФЗ, ст. 96. Обеспечение исполнения контракта",
    text: "Статья 96. Обеспечение исполнения контракта\n\nОбеспечение исполнения контракта предоставляется поставщиком до заключения контракта.",
    meta: { documentType: "law", lawType: "44-FZ", category: "обеспечение", reliability: "official" },
  });
  await add({
    owner: GLOBAL,
    sourceKey: "law:223:art:3",
    name: "223-ФЗ, ст. 3.2. Заявки участников",
    text: "Статья 3.2. Заявки участников\n\nСрок подачи заявок на участие в закупке устанавливается заказчиком в извещении.",
    meta: { documentType: "law", lawType: "223-FZ", category: "сроки", reliability: "official" },
  });
  await add({
    owner: { kind: "org", organizationId: ORG_A },
    sourceKey: "mine:fact",
    name: "Лицензия компании А",
    text: "Лицензия на деятельность по перевозке пассажиров выдана компании и действует до 2028 года.",
    meta: { documentType: "other" },
  });
}

test("по номеру и названию статьи находится нужный документ, на первом месте", async () => {
  const store = createMemoryKbStore();
  await corpus(store);
  const hits = await searchKnowledge(store, localEmbedder, { query: "обеспечение исполнения контракта статья 96", visibility: { organizationId: null } });
  assert.equal(hits[0].sourceKey, "law:44:art:96");
  assert.ok(hits[0].keywordScore > 0, "совпало ключевое слово");
});

test("окончания не мешают: «обеспечения заявки» находит статью про обеспечение заявки", async () => {
  const store = createMemoryKbStore();
  await corpus(store);
  const hits = await searchKnowledge(store, localEmbedder, { query: "размер обеспечения заявок", visibility: { organizationId: null } });
  assert.equal(hits[0].sourceKey, "law:44:art:44");
});

test("фильтр по закону отсекает другой закон, фильтр по категории строго совпадает", async () => {
  const store = createMemoryKbStore();
  await corpus(store);
  const only223 = await searchKnowledge(store, localEmbedder, { query: "срок подачи заявок", visibility: { organizationId: null }, filter: { lawType: "223-FZ" } });
  assert.deepEqual([...new Set(only223.map((h) => h.meta.lawType))], ["223-FZ"]);

  const obespechenie = await searchKnowledge(store, localEmbedder, { query: "срок подачи заявок", visibility: { organizationId: null }, filter: { category: "обеспечение" } });
  assert.ok(obespechenie.every((h) => h.meta.category === "обеспечение"));
  assert.ok(!obespechenie.some((h) => h.sourceKey === "law:223:art:3"));
});

test("документ организации A не виден организации B и общей базе, виден самой A; общая виден всем", async () => {
  const store = createMemoryKbStore();
  await corpus(store);
  const query = "лицензия перевозка пассажиров";

  const asA = await searchKnowledge(store, localEmbedder, { query, visibility: { organizationId: ORG_A } });
  assert.ok(asA.some((h) => h.sourceKey === "mine:fact"), "своя организация видит свой документ");

  const asB = await searchKnowledge(store, localEmbedder, { query, visibility: { organizationId: ORG_B } });
  assert.ok(!asB.some((h) => h.sourceKey === "mine:fact"), "чужой документ не виден");

  const asGlobal = await searchKnowledge(store, localEmbedder, { query, visibility: { organizationId: null } });
  assert.ok(!asGlobal.some((h) => h.sourceKey === "mine:fact"), "общий поиск документов организаций не видит");

  const globalQuery = await searchKnowledge(store, localEmbedder, { query: "обеспечение заявки", visibility: { organizationId: ORG_B } });
  assert.ok(globalQuery.some((h) => h.sourceKey === "law:44:art:44"), "общая база видна и организации B");
});

test("без указания видимости поиск не запускается", async () => {
  const store = createMemoryKbStore();
  await corpus(store);
  await assert.rejects(
    searchKnowledge(store, localEmbedder, { query: "обеспечение", visibility: undefined as never }),
    (e: unknown) => e instanceof KbError && e.code === "invalid_scope",
  );
  await assert.rejects(
    searchKnowledge(store, localEmbedder, { query: "обеспечение", visibility: { organizationId: "../x" } }),
    (e: unknown) => e instanceof KbError && e.code === "invalid_scope",
  );
});

test("удалённый документ больше не участвует в поиске", async () => {
  const store = createMemoryKbStore();
  await corpus(store);
  await deleteDocument(store, GLOBAL, "law:44:art:96");
  const hits = await searchKnowledge(store, localEmbedder, { query: "обеспечение исполнения контракта", visibility: { organizationId: null } });
  assert.ok(!hits.some((h) => h.sourceKey === "law:44:art:96"));
});

test("пустой запрос из служебных слов — пустой ответ; число результатов ограничено", async () => {
  const store = createMemoryKbStore();
  await corpus(store);
  assert.deepEqual(await searchKnowledge(store, localEmbedder, { query: "и в на", visibility: { organizationId: null } }), []);
  const many = await searchKnowledge(store, localEmbedder, { query: "обеспечение", visibility: { organizationId: null }, topK: 1000 });
  assert.ok(many.length <= TOP_K_MAX);
});

test("один документ не занимает больше двух мест в выдаче", async () => {
  const store = createMemoryKbStore();
  // Длинный документ с одним и тем же словом в каждом абзаце: фрагментов много, все подходят.
  const word = "обеспечение исполнения контракта ";
  const text = ["Статья 96. Обеспечение", word.repeat(60), word.repeat(60), word.repeat(60), word.repeat(60)].join("\n\n");
  await ingestDocument(store, localEmbedder, { owner: GLOBAL, sourceKey: "long", name: "Длинный", source: "тест", text, meta: { documentType: "law" } });
  const hits = await searchKnowledge(store, localEmbedder, { query: "обеспечение исполнения контракта", visibility: { organizationId: null }, topK: 10 });
  assert.ok(hits.length > 0);
  assert.ok(hits.length <= 2, `мест ${hits.length}`);
});

test("обновлённый документ ищется по новому тексту, старый текст больше не находится", async () => {
  const store = createMemoryKbStore();
  await corpus(store);
  await ingestDocument(store, localEmbedder, {
    owner: GLOBAL,
    sourceKey: "law:44:art:96",
    name: "44-ФЗ, ст. 96. Обеспечение исполнения контракта",
    source: "тест",
    text: "Статья 96. Обеспечение исполнения контракта\n\nНовая редакция: размер обеспечения устанавливается в процентах цены контракта.",
    meta: { documentType: "law", lawType: "44-FZ", category: "обеспечение", reliability: "official" },
  });
  const hits = await searchKnowledge(store, localEmbedder, { query: "процентах цены контракта", visibility: { organizationId: null } });
  assert.equal(hits[0].sourceKey, "law:44:art:96");
  assert.match(hits[0].text, /Новая редакция/);
});
