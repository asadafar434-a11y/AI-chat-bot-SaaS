import "server-only";
import type { DbClient } from "../server/db/db-client.ts";
import type { KbStore } from "./kb-store.ts";
import { ownerKeyOf, type KbChunk, type KbDocument, type KbMeta, type KbOwner } from "./kb-types.ts";

// Хранилище базы знаний в PostgreSQL (таблицы KnowledgeDocument и KnowledgeChunk, миграция S12).
// Тот же интерфейс, что у памяти (kb-store.ts), поэтому приём и поиск не знают, где лежит база.
// Владелец хранится строкой ownerKey («global» или «org:<id>»); поиск отбирает по ней в условии запроса.

type Delegates = Pick<DbClient, "knowledgeDocument" | "knowledgeChunk">;

type DocRow = {
  id: string;
  ownerKey: string;
  approvedBy: string | null;
  sourceKey: string;
  name: string;
  source: string;
  meta: unknown;
  version: number;
  checksum: string;
  status: "active" | "deleted";
  chunkCount: number;
  createdAt: Date;
  updatedAt: Date;
};

type ChunkRow = {
  id: string;
  documentId: string;
  ownerKey: string;
  chunkIndex: number;
  heading: string | null;
  text: string;
  hash: string;
  embedding: number[];
  embeddingModel: string;
  createdAt: Date;
};

const ownerOf = (row: DocRow): KbOwner =>
  row.ownerKey === "global"
    ? { kind: "global", approvedBy: row.approvedBy ?? "" }
    : { kind: "org", organizationId: row.ownerKey.slice("org:".length) };

const docOf = (row: DocRow): KbDocument => ({
  id: row.id,
  owner: ownerOf(row),
  sourceKey: row.sourceKey,
  name: row.name,
  source: row.source,
  meta: row.meta as KbMeta,
  version: row.version,
  checksum: row.checksum,
  status: row.status,
  chunkCount: row.chunkCount,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const chunkOf = (row: ChunkRow): KbChunk => ({
  id: row.id,
  documentId: row.documentId,
  ownerKey: row.ownerKey,
  chunkIndex: row.chunkIndex,
  heading: row.heading,
  text: row.text,
  hash: row.hash,
  embedding: row.embedding,
  embeddingModel: row.embeddingModel,
  createdAt: row.createdAt.toISOString(),
});

export function createDbKbStore(db: Delegates): KbStore {
  const docs = db.knowledgeDocument;
  const chunks = db.knowledgeChunk;

  return {
    async getDocument(ownerKey, sourceKey) {
      const row = (await docs.findFirst({ where: { ownerKey, sourceKey } })) as DocRow | null;
      return row ? docOf(row) : null;
    },
    async getDocumentById(id) {
      const row = (await docs.findFirst({ where: { id } })) as DocRow | null;
      return row ? docOf(row) : null;
    },
    async listDocuments() {
      return ((await docs.findMany({})) as DocRow[]).map(docOf);
    },
    async putDocument(doc, sourceText) {
      const data = {
        id: doc.id,
        ownerKey: ownerKeyOf(doc.owner),
        approvedBy: doc.owner.kind === "global" ? doc.owner.approvedBy : null,
        sourceKey: doc.sourceKey,
        name: doc.name,
        source: doc.source,
        meta: doc.meta,
        version: doc.version,
        checksum: doc.checksum,
        status: doc.status,
        chunkCount: doc.chunkCount,
        sourceText,
        createdAt: new Date(doc.createdAt),
      };
      // Сначала обновляем, а если строки нет — создаём. Так одна функция работает и для новых, и для изменённых документов.
      const { id, ...changes } = data;
      const { count } = await docs.updateMany({ where: { id }, data: changes });
      if (count === 0) await docs.create({ data });
    },
    async getSourceText(documentId) {
      const row = (await docs.findFirst({ where: { id: documentId } })) as DocRow & { sourceText: string } | null;
      return row ? row.sourceText : null;
    },
    async replaceChunks(documentId, rows) {
      await chunks.deleteMany({ where: { documentId } });
      for (const row of rows) {
        await chunks.create({
          data: {
            id: row.id,
            documentId,
            ownerKey: row.ownerKey,
            chunkIndex: row.chunkIndex,
            heading: row.heading,
            text: row.text,
            hash: row.hash,
            embedding: row.embedding,
            embeddingModel: row.embeddingModel,
            createdAt: new Date(row.createdAt),
          },
        });
      }
    },
    async countChunks(documentId) {
      return chunks.count({ where: { documentId } });
    },
    async removeChunks(documentId) {
      await chunks.deleteMany({ where: { documentId } });
    },
    async searchable(ownerKeys) {
      if (ownerKeys.length === 0) return [];
      const documents = (await docs.findMany({ where: { ownerKey: { in: ownerKeys }, status: "active" } })) as DocRow[];
      if (documents.length === 0) return [];
      const byId = new Map(documents.map((d) => [d.id, d]));
      const rows = (await chunks.findMany({
        where: { documentId: { in: [...byId.keys()] }, ownerKey: { in: ownerKeys } },
      })) as ChunkRow[];
      return rows.map((row) => ({ document: docOf(byId.get(row.documentId)!), chunk: chunkOf(row) }));
    },
    async findEmbedding(ownerKey, hash, model) {
      const row = (await chunks.findFirst({ where: { ownerKey, hash, embeddingModel: model } })) as ChunkRow | null;
      return row ? row.embedding : null;
    },
  };
}
