// Хранилище базы знаний поверх таблиц PostgreSQL — npm test. Делегаты Prisma подменены памятью с теми же условиями
// (равенство и «в списке»), поэтому проверяется логика хранилища, а не сам PostgreSQL. Живую БД проверяет
// scripts/kb-folder.ts при записи в базу.
import assert from "node:assert/strict";
import { test } from "node:test";
import { localEmbedder, type Embedder } from "./kb-embed.ts";
import { deleteDocument, ingestDocument } from "./kb-ingest.ts";
import { searchKnowledge } from "./kb-search.ts";
import { createDbKbStore } from "./kb-store-db.ts";

type Row = Record<string, unknown> & { id: string };
type Where = Record<string, unknown>;

// Условие Prisma: значение — равенство, { in: [...] } — вхождение в список.
const matches = (row: Row, where: Where = {}) =>
  Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond && typeof cond === "object" && "in" in (cond as object)) return (cond as { in: unknown[] }).in.includes(value);
    return value === cond;
  });

function fakeDelegate(table: Row[], prefix: string) {
  let seq = 0;
  return {
    async findFirst(args?: { where?: Where }) {
      return table.find((r) => matches(r, args?.where)) ?? null;
    },
    async findMany(args?: { where?: Where }) {
      return table.filter((r) => matches(r, args?.where));
    },
    async create(args: { data: Record<string, unknown> }) {
      // Как в Prisma: поле @updatedAt заполняется при создании само.
      const row = { id: (args.data.id as string) ?? `${prefix}${++seq}`, updatedAt: new Date(), ...args.data } as Row;
      table.push(row);
      return row;
    },
    async updateMany(args: { where?: Where; data: Record<string, unknown> }) {
      const hit = table.filter((r) => matches(r, args.where));
      for (const r of hit) Object.assign(r, args.data, { updatedAt: new Date() });
      return { count: hit.length };
    },
    async deleteMany(args: { where?: Where }) {
      const keep = table.filter((r) => !matches(r, args.where));
      const count = table.length - keep.length;
      table.splice(0, table.length, ...keep);
      return { count };
    },
    async count(args?: { where?: Where }) {
      return table.filter((r) => matches(r, args?.where)).length;
    },
  };
}

function setup() {
  const docs: Row[] = [];
  const chunks: Row[] = [];
  const store = createDbKbStore({
    knowledgeDocument: fakeDelegate(docs, "doc"),
    knowledgeChunk: fakeDelegate(chunks, "ch"),
  } as never);
  return { store, docs, chunks };
}

const GLOBAL = { kind: "global" as const, approvedBy: "Владелец продукта" };
const ORG_A = { kind: "org" as const, organizationId: "cklorgaaaaaaaaaaaaaaaaa1" };
const ORG_B = { kind: "org" as const, organizationId: "cklorgbbbbbbbbbbbbbbbbb2" };

const TEXT = "Обеспечение заявки вносится в размере одного процента начальной цены на счёт заказчика.";

test("документ записывается строкой с ownerKey и утвердившим, текст сохраняется для переиндексации", async () => {
  const { store, docs } = setup();
  await ingestDocument(store, localEmbedder, { owner: GLOBAL, sourceKey: "a", name: "А", source: "тест", text: TEXT, meta: { documentType: "instruction" } });
  assert.equal(docs.length, 1);
  assert.equal(docs[0].ownerKey, "global");
  assert.equal(docs[0].approvedBy, "Владелец продукта");
  assert.equal(docs[0].sourceText, TEXT);
  assert.equal(await store.getSourceText(docs[0].id as string), TEXT);
});

test("повторный приём того же текста не создаёт вторую строку и не считает векторы", async () => {
  const { store, docs } = setup();
  let embedded = 0;
  const counting: Embedder = { id: localEmbedder.id, async embed(t) { embedded += t.length; return localEmbedder.embed(t); } };
  const input = { owner: GLOBAL, sourceKey: "a", name: "А", source: "тест", text: TEXT, meta: { documentType: "instruction" as const } };
  await ingestDocument(store, counting, input);
  const again = await ingestDocument(store, counting, input);
  assert.equal(again.status, "unchanged");
  assert.equal(docs.length, 1);
  assert.equal(embedded, 1);
});

test("поиск по базе находит документ; организация B не видит документ организации A", async () => {
  const { store } = setup();
  await ingestDocument(store, localEmbedder, { owner: GLOBAL, sourceKey: "g", name: "Общий", source: "тест", text: TEXT, meta: { documentType: "law" } });
  await ingestDocument(store, localEmbedder, { owner: ORG_A, sourceKey: "a", name: "Наш", source: "тест", text: "Лицензия на перевозку пассажиров выдана компании.", meta: { documentType: "other" } });

  const forA = await searchKnowledge(store, localEmbedder, { query: "лицензия перевозка пассажиров", visibility: { organizationId: ORG_A.organizationId } });
  assert.ok(forA.some((h) => h.documentName === "Наш"));
  const forB = await searchKnowledge(store, localEmbedder, { query: "лицензия перевозка пассажиров", visibility: { organizationId: ORG_B.organizationId } });
  assert.ok(!forB.some((h) => h.documentName === "Наш"));
  const common = await searchKnowledge(store, localEmbedder, { query: "обеспечение заявки", visibility: { organizationId: null } });
  assert.ok(common.some((h) => h.documentName === "Общий"));
});

test("удалённый документ уходит из поиска, текст очищается", async () => {
  const { store, docs } = setup();
  await ingestDocument(store, localEmbedder, { owner: GLOBAL, sourceKey: "a", name: "А", source: "тест", text: TEXT, meta: { documentType: "instruction" } });
  await deleteDocument(store, GLOBAL, "a");
  const hits = await searchKnowledge(store, localEmbedder, { query: "обеспечение заявки", visibility: { organizationId: null } });
  assert.equal(hits.length, 0);
  assert.equal(docs[0].status, "deleted");
  assert.equal(docs[0].sourceText, "");
});

test("векторы переиспользуются только внутри одного владельца", async () => {
  const { store } = setup();
  await ingestDocument(store, localEmbedder, { owner: ORG_A, sourceKey: "a", name: "А", source: "тест", text: TEXT, meta: { documentType: "other" } });
  const sameOwner = await ingestDocument(store, localEmbedder, { owner: ORG_A, sourceKey: "copy", name: "Копия", source: "тест", text: TEXT, meta: { documentType: "other" } });
  assert.equal(sameOwner.embedded, 0);
  const other = await ingestDocument(store, localEmbedder, { owner: ORG_B, sourceKey: "a", name: "Чужая", source: "тест", text: TEXT, meta: { documentType: "other" } });
  assert.equal(other.embedded, 1, "чужой владелец не получает готовый вектор");
});
