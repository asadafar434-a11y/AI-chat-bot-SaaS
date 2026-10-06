import "server-only";
import { createHash } from "node:crypto";
import { orgScope } from "../server/db/org-scope.ts";
import { chunkText } from "./kb-chunk.ts";
import type { Embedder } from "./kb-embed.ts";
import type { KbStore } from "./kb-store.ts";
import {
  DOCUMENT_TYPES,
  KbError,
  LAW_TYPES,
  PROCUREMENT_TYPES,
  ownerKeyOf,
  type DocumentType,
  type KbChunk,
  type KbDocument,
  type KbMeta,
  type KbOwner,
} from "./kb-types.ts";

// Приём документов в базу знаний. Здесь три правила, которые нельзя обойти:
// 1. Глобальный документ принимается только с именем того, кто его утвердил. Документ организации в глобальную
//    базу не попадает никаким путём: владелец задаётся один раз и не меняется.
// 2. Один и тот же документ (тот же владелец и ключ) не индексируется заново: совпал текст — значит, эмбеддинги
//    уже есть. Изменился текст — новая версия, но вектор пересчитывается только у изменившихся фрагментов.
// 3. Метаданные проверяются строго: неизвестный тип документа или закон — ошибка, а не тихая подмена.

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export type IngestInput = {
  owner: KbOwner;
  sourceKey: string;
  name: string;
  source: string;
  text: string;
  meta: Partial<KbMeta> & { documentType: DocumentType };
};

export type IngestStatus = "created" | "updated" | "metadata_updated" | "unchanged";

export type IngestResult = {
  status: IngestStatus;
  document: KbDocument;
  chunks: number;
  /** Сколько фрагментов получили новый вектор. */
  embedded: number;
  /** Сколько фрагментов взяли вектор из прошлых версий или уже проиндексированных документов владельца. */
  reused: number;
};

const ONE_LINE = /[\u0000-\u001f]/;

/** Метаданные — только из списков; всё, что не задано, — null. Неизвестное значение — ошибка. */
export function normalizeMeta(input: Partial<KbMeta> & { documentType: DocumentType }): KbMeta {
  if (!DOCUMENT_TYPES.includes(input.documentType)) throw new KbError("invalid_meta", `неизвестный тип документа: ${String(input.documentType)}`);
  const pick = <T extends string>(value: unknown, allowed: readonly T[], field: string): T | null => {
    if (value === undefined || value === null || value === "") return null;
    if (!allowed.includes(value as T)) throw new KbError("invalid_meta", `${field}: неизвестное значение ${String(value)}`);
    return value as T;
  };
  const text = (value: unknown, field: string, max: number): string | null => {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || value.length > max || ONE_LINE.test(value)) throw new KbError("invalid_meta", `${field}: некорректная строка`);
    return value;
  };
  const year = input.year ?? null;
  if (year !== null && (!Number.isInteger(year) || year < 1990 || year > 2100)) throw new KbError("invalid_meta", "year: некорректный год");
  const reliability = input.reliability ?? "unverified";
  if (!["official", "verified", "unverified"].includes(reliability)) throw new KbError("invalid_meta", "reliability: неизвестное значение");
  return {
    documentType: input.documentType,
    lawType: pick(input.lawType, LAW_TYPES, "lawType"),
    procurementType: pick(input.procurementType, PROCUREMENT_TYPES, "procurementType"),
    category: text(input.category, "category", 60),
    topic: text(input.topic, "topic", 120),
    tenderPlatform: text(input.tenderPlatform, "tenderPlatform", 120),
    year,
    edition: text(input.edition, "edition", 200),
    reliability,
  };
}

function checkOwner(owner: KbOwner): void {
  if (owner.kind === "global") {
    if (typeof owner.approvedBy !== "string" || owner.approvedBy.trim().length < 2 || owner.approvedBy.length > 120) {
      throw new KbError("invalid_owner", "глобальный документ требует имени утвердившего");
    }
    return;
  }
  try {
    orgScope(owner.organizationId);
  } catch {
    throw new KbError("invalid_owner", "организация задана некорректно");
  }
}

const documentId = (ownerKey: string, sourceKey: string) => `kb_${sha256(`${ownerKey}\n${sourceKey}`).slice(0, 24)}`;

/** Текст нормализуем так же при каждом приёме: переводы строк и лишние пробелы не меняют отпечаток. */
const normalizeText = (text: string) => text.replace(/\r\n?/g, "\n").replace(/[ \t ]+\n/g, "\n").trim();

type Indexed = { rows: Omit<KbChunk, "id" | "documentId" | "ownerKey" | "chunkIndex" | "createdAt">[]; embedded: number; reused: number };

/**
 * Текст → фрагменты с векторами. Вектор берётся из хранилища, если тот же текст уже проиндексирован у этого
 * владельца той же моделью; остальное эмбеддер считает одним пакетом.
 */
async function indexText(store: KbStore, embedder: Embedder, ownerKey: string, text: string): Promise<Indexed> {
  const raw = chunkText(text).map((c) => {
    const indexed = c.heading ? `${c.heading}\n${c.text}` : c.text;
    return { heading: c.heading, text: c.text, indexed, hash: sha256(indexed) };
  });
  const vectors = new Map<string, number[]>();
  const missing = new Map<string, string>();
  for (const row of raw) {
    if (vectors.has(row.hash) || missing.has(row.hash)) continue;
    const known = await store.findEmbedding(ownerKey, row.hash, embedder.id);
    if (known) vectors.set(row.hash, known);
    else missing.set(row.hash, row.indexed);
  }
  if (missing.size) {
    const hashes = [...missing.keys()];
    const computed = await embedder.embed(hashes.map((h) => missing.get(h)!));
    hashes.forEach((h, i) => vectors.set(h, computed[i]));
  }
  // «embedded» — сколько векторов посчитано заново (одинаковый текст внутри документа считается один раз);
  // «reused» — сколько фрагментов обошлось без расчёта.
  const rows = raw.map((r) => ({ heading: r.heading, text: r.text, hash: r.hash, embedding: vectors.get(r.hash)!, embeddingModel: embedder.id }));
  return { rows, embedded: missing.size, reused: raw.length - missing.size };
}

/** Принимает документ: создаёт, обновляет или пропускает. Возвращает, что сделано и сколько векторов посчитано. */
export async function ingestDocument(store: KbStore, embedder: Embedder, input: IngestInput, now = new Date()): Promise<IngestResult> {
  checkOwner(input.owner);
  if (!input.sourceKey || input.sourceKey.length > 300 || ONE_LINE.test(input.sourceKey)) throw new KbError("invalid_source_key", "ключ документа некорректен");
  const name = input.name.trim();
  // Длина как у имени файла в базе приложения (Document.fileName): длинные названия статей тоже помещаются.
  if (!name || name.length > 500 || ONE_LINE.test(name)) throw new KbError("invalid_meta", "название документа некорректно");
  const meta = normalizeMeta(input.meta);
  const text = normalizeText(input.text);
  if (!text) throw new KbError("empty_text", `пустой текст: ${input.sourceKey}`);

  const ownerKey = ownerKeyOf(input.owner);
  const checksum = sha256(text);
  const existing = await store.getDocument(ownerKey, input.sourceKey);
  const sameMeta = existing && JSON.stringify(existing.meta) === JSON.stringify(meta);

  if (existing && existing.status === "active" && existing.checksum === checksum) {
    if (sameMeta && existing.name === name && existing.source === input.source) {
      return { status: "unchanged", document: existing, chunks: existing.chunkCount, embedded: 0, reused: 0 };
    }
    // Текст тот же — меняются только метаданные или название: фрагменты и векторы не трогаем.
    const doc: KbDocument = { ...existing, name, source: input.source, meta, updatedAt: now.toISOString() };
    await store.putDocument(doc, text);
    return { status: "metadata_updated", document: doc, chunks: doc.chunkCount, embedded: 0, reused: 0 };
  }

  const indexed = await indexText(store, embedder, ownerKey, text);
  const id = documentId(ownerKey, input.sourceKey);
  const stamp = now.toISOString();
  const doc: KbDocument = {
    id,
    owner: input.owner,
    sourceKey: input.sourceKey,
    name,
    source: input.source,
    meta,
    version: existing ? existing.version + 1 : 1,
    checksum,
    status: "active",
    chunkCount: indexed.rows.length,
    createdAt: existing?.createdAt ?? stamp,
    updatedAt: stamp,
  };
  await store.replaceChunks(
    id,
    indexed.rows.map((row, chunkIndex) => ({
      ...row,
      id: `${id}:${doc.version}:${chunkIndex}`,
      documentId: id,
      ownerKey,
      chunkIndex,
      createdAt: stamp,
    })),
  );
  await store.putDocument(doc, text);
  return { status: existing ? "updated" : "created", document: doc, chunks: indexed.rows.length, embedded: indexed.embedded, reused: indexed.reused };
}

/** Удаляет документ из поиска: фрагменты и исходный текст стираются, строка документа остаётся со статусом deleted. */
export async function deleteDocument(store: KbStore, owner: KbOwner, sourceKey: string, now = new Date()): Promise<KbDocument | null> {
  const doc = await store.getDocument(ownerKeyOf(owner), sourceKey);
  if (!doc || doc.status === "deleted") return doc;
  await store.removeChunks(doc.id);
  const deleted: KbDocument = { ...doc, status: "deleted", chunkCount: 0, updatedAt: now.toISOString() };
  await store.putDocument(deleted, "");
  return deleted;
}

/**
 * Переиндексация всех активных документов, например после смены эмбеддера. Текст берётся из хранилища;
 * векторы, которые уже есть для той же модели, не пересчитываются.
 */
export async function reindexAll(store: KbStore, embedder: Embedder, now = new Date()) {
  let documents = 0;
  let embedded = 0;
  let reused = 0;
  for (const doc of await store.listDocuments()) {
    if (doc.status !== "active") continue;
    const text = await store.getSourceText(doc.id);
    if (!text) continue;
    const ownerKey = ownerKeyOf(doc.owner);
    const indexed = await indexText(store, embedder, ownerKey, text);
    const stamp = now.toISOString();
    await store.replaceChunks(
      doc.id,
      indexed.rows.map((row, chunkIndex) => ({ ...row, id: `${doc.id}:${doc.version}:${chunkIndex}`, documentId: doc.id, ownerKey, chunkIndex, createdAt: stamp })),
    );
    await store.putDocument({ ...doc, chunkCount: indexed.rows.length, updatedAt: stamp }, text);
    documents++;
    embedded += indexed.embedded;
    reused += indexed.reused;
  }
  return { documents, embedded, reused };
}
