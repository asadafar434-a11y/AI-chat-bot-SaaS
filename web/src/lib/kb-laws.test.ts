// Первое наполнение базы знаний статьями 44-ФЗ и 223-ФЗ — npm test. Работает на настоящих текстах из репозитория.
import assert from "node:assert/strict";
import { test } from "node:test";
import { localEmbedder } from "./kb-embed.ts";
import { seedLawsIntoKnowledgeBase } from "./kb-laws.ts";
import { searchKnowledge } from "./kb-search.ts";
import { createMemoryKbStore } from "./kb-store.ts";

test("статьи загружаются, повторная загрузка ничего не пересчитывает", async () => {
  const store = createMemoryKbStore();
  const first = await seedLawsIntoKnowledgeBase(store, localEmbedder, "Владелец продукта");
  assert.ok(first.documents > 100, `статей ${first.documents}`);
  assert.equal(first.created, first.documents);
  assert.ok(first.embedded > 0);

  const second = await seedLawsIntoKnowledgeBase(store, localEmbedder, "Владелец продукта");
  assert.equal(second.unchanged, second.documents);
  assert.equal(second.embedded, 0);
});

test("у статей есть нормативный ранг, надёжность «официально» и редакция", async () => {
  const store = createMemoryKbStore();
  await seedLawsIntoKnowledgeBase(store, localEmbedder, "Владелец продукта");
  const docs = await store.listDocuments();
  assert.ok(docs.every((d) => d.meta.documentType === "law" && d.meta.reliability === "official"));
  assert.ok(docs.some((d) => d.meta.lawType === "44-FZ") && docs.some((d) => d.meta.lawType === "223-FZ"));
  assert.ok(docs.every((d) => d.meta.edition && d.source.startsWith("http")));
});

test("по запросу о сроке обеспечения исполнения контракта находится статья 44-ФЗ о нём", async () => {
  const store = createMemoryKbStore();
  await seedLawsIntoKnowledgeBase(store, localEmbedder, "Владелец продукта");
  const hits = await searchKnowledge(store, localEmbedder, {
    query: "обеспечение исполнения контракта",
    visibility: { organizationId: null },
    filter: { lawType: "44-FZ" },
    topK: 5,
  });
  assert.ok(hits.length > 0);
  assert.ok(hits.some((h) => /обеспечени[ея] исполнения контракта/i.test(h.documentName)), hits.map((h) => h.documentName).join(" | "));
});
