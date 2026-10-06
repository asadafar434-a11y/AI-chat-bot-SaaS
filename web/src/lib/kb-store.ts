// Хранилище базы знаний. Интерфейс отделён от реализации: сейчас — память процесса (тесты и разработка),
// позже — PostgreSQL (таблицы решает владелец: см. отчёт). Все методы асинхронные, чтобы замена не меняла логику.
//
// Изоляция: поиск принимает список ключей владельцев и отбирает только их. Повторно используемые эмбеддинги
// ищутся только внутри одного владельца: иначе по счётчику «переиспользовано» одна организация узнала бы,
// что другая загружала такой же текст.

import type { KbChunk, KbDocument } from "./kb-types.ts";

export interface KbStore {
  getDocument(ownerKey: string, sourceKey: string): Promise<KbDocument | null>;
  getDocumentById(id: string): Promise<KbDocument | null>;
  listDocuments(): Promise<KbDocument[]>;
  /** Сохраняет метаданные документа и его исходный текст (нужен для переиндексации). */
  putDocument(doc: KbDocument, sourceText: string): Promise<void>;
  getSourceText(documentId: string): Promise<string | null>;
  replaceChunks(documentId: string, chunks: KbChunk[]): Promise<void>;
  countChunks(documentId: string): Promise<number>;
  removeChunks(documentId: string): Promise<void>;
  /** Фрагменты активных документов указанных владельцев. Остальные владельцы сюда не попадают. */
  searchable(ownerKeys: string[]): Promise<{ document: KbDocument; chunk: KbChunk }[]>;
  /** Вектор того же текста и той же модели, но только у этого владельца. */
  findEmbedding(ownerKey: string, hash: string, model: string): Promise<number[] | null>;
}

/** Всё содержимое базы одним куском: для сохранения в файл и загрузки обратно. */
export type KbSnapshot = {
  documents: KbDocument[];
  sources: [string, string][];
  chunks: [string, KbChunk[]][];
};

export function createMemoryKbStore(from?: KbSnapshot): KbStore & { snapshot(): KbSnapshot } {
  const documents = new Map<string, KbDocument>((from?.documents ?? []).map((d) => [d.id, d]));
  const sources = new Map<string, string>(from?.sources ?? []);
  const chunks = new Map<string, KbChunk[]>(from?.chunks ?? []);
  const ownerOf = (doc: KbDocument) => (doc.owner.kind === "global" ? "global" : `org:${doc.owner.organizationId}`);

  return {
    snapshot() {
      return { documents: [...documents.values()], sources: [...sources.entries()], chunks: [...chunks.entries()] };
    },
    async getDocument(ownerKey, sourceKey) {
      for (const doc of documents.values()) if (ownerOf(doc) === ownerKey && doc.sourceKey === sourceKey) return doc;
      return null;
    },
    async getDocumentById(id) {
      return documents.get(id) ?? null;
    },
    async listDocuments() {
      return [...documents.values()];
    },
    async putDocument(doc, sourceText) {
      documents.set(doc.id, doc);
      sources.set(doc.id, sourceText);
    },
    async getSourceText(documentId) {
      return sources.get(documentId) ?? null;
    },
    async replaceChunks(documentId, rows) {
      chunks.set(documentId, rows);
    },
    async countChunks(documentId) {
      return (chunks.get(documentId) ?? []).length;
    },
    async removeChunks(documentId) {
      chunks.delete(documentId);
    },
    async searchable(ownerKeys) {
      const allowed = new Set(ownerKeys);
      const out: { document: KbDocument; chunk: KbChunk }[] = [];
      for (const doc of documents.values()) {
        if (doc.status !== "active" || !allowed.has(ownerOf(doc))) continue;
        for (const chunk of chunks.get(doc.id) ?? []) {
          if (allowed.has(chunk.ownerKey)) out.push({ document: doc, chunk });
        }
      }
      return out;
    },
    async findEmbedding(ownerKey, hash, model) {
      for (const rows of chunks.values()) {
        for (const chunk of rows) {
          if (chunk.ownerKey === ownerKey && chunk.hash === hash && chunk.embeddingModel === model) return chunk.embedding;
        }
      }
      return null;
    },
  };
}
