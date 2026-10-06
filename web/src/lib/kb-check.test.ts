// Проверка заявки с базой знаний — npm test. Без сети и без платных запросов: поиск по памяти, модель не вызывается.
import assert from "node:assert/strict";
import { test } from "node:test";
import { localEmbedder } from "./kb-embed.ts";
import { ingestDocument } from "./kb-ingest.ts";
import { retrieveKnowledgeBlock, type RagLogEntry } from "./kb-rag.ts";
import { CHECK_KB_QUERY, checkKnowledgeBlock, draftKnowledgeBlock, knowledgeEnabled, knowledgeForCheckEnabled, knowledgeTextBlock } from "./kb-check.ts";
import { createMemoryKbStore } from "./kb-store.ts";

const GLOBAL = { kind: "global" as const, approvedBy: "Евгений" };

async function store() {
  const s = createMemoryKbStore();
  await ingestDocument(s, localEmbedder, {
    owner: GLOBAL,
    sourceKey: "law:44:art:44",
    name: "44-ФЗ, ст. 44. Обеспечение заявки",
    source: "тест",
    text: "Статья 44. Обеспечение заявки\n\nОбеспечение заявки на участие вносится в размере не более пяти процентов начальной цены.",
    meta: { documentType: "law", lawType: "44-FZ", reliability: "official" },
  });
  return s;
}

test("без флага KB_CHECK база в проверке не используется", async () => {
  const saved = { flag: process.env.KB_CHECK, url: process.env.DATABASE_URL };
  delete process.env.KB_CHECK;
  process.env.DATABASE_URL = "postgresql://unused";
  try {
    assert.equal(knowledgeForCheckEnabled(), false);
    assert.equal(await checkKnowledgeBlock(), null);
  } finally {
    process.env.KB_CHECK = saved.flag;
    process.env.DATABASE_URL = saved.url;
  }
});

test("с флагом, но без DATABASE_URL база тоже не используется", () => {
  const saved = { flag: process.env.KB_CHECK, url: process.env.DATABASE_URL };
  process.env.KB_CHECK = "on";
  delete process.env.DATABASE_URL;
  try {
    assert.equal(knowledgeForCheckEnabled(), false);
  } finally {
    process.env.KB_CHECK = saved.flag;
    process.env.DATABASE_URL = saved.url;
  }
});

test("блок для проверки собирается из общей базы, с номерами источников и без вызова модели", async () => {
  const s = await store();
  const block = await retrieveKnowledgeBlock(
    { store: s, embedder: localEmbedder, log: () => {} },
    { query: CHECK_KB_QUERY, visibility: { organizationId: null }, label: "check", maxChars: 4000 },
  );
  assert.ok(block);
  assert.match(block, /Обеспечение заявки на участие/);
  assert.match(block, /\[KB-1\]/);
});

test("если подходящего ничего нет, блок пустой и проверка идёт без базы", async () => {
  const empty = createMemoryKbStore();
  const block = await retrieveKnowledgeBlock(
    { store: empty, embedder: localEmbedder, log: () => {} },
    { query: CHECK_KB_QUERY, visibility: { organizationId: null }, label: "check" },
  );
  assert.equal(block, null);
});

test("журнал поиска для проверки: хэш запроса вместо текста", async () => {
  const s = await store();
  const entries: RagLogEntry[] = [];
  await retrieveKnowledgeBlock(
    { store: s, embedder: localEmbedder, log: (e) => entries.push(e) },
    { query: CHECK_KB_QUERY, visibility: { organizationId: null }, label: "check" },
  );
  assert.equal(entries[0].event, "kb_retrieve");
  assert.ok(!JSON.stringify(entries[0]).includes("декларация о соответствии"));
});

test("ТП и требования без флага KB_DOCS базу не читают", async () => {
  const saved = { flag: process.env.KB_DOCS, url: process.env.DATABASE_URL };
  delete process.env.KB_DOCS;
  process.env.DATABASE_URL = "postgresql://unused";
  try {
    assert.equal(knowledgeEnabled("KB_DOCS"), false);
    assert.equal(await draftKnowledgeBlock("техническое предложение"), null);
  } finally {
    process.env.KB_DOCS = saved.flag;
    process.env.DATABASE_URL = saved.url;
  }
});

test("блок для модели несёт правило приоритета и сами фрагменты", () => {
  const block = knowledgeTextBlock("[KB-1] Закон, ст. 44");
  assert.equal(block.type, "text");
  assert.match(block.text, /верны документы закупки/);
  assert.match(block.text, /не подставлять вместо границ, которые задал заказчик/);
  assert.match(block.text, /\[KB-1\] Закон, ст\. 44/);
});
