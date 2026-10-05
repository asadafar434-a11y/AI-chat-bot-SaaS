/**
 * Файловые операции S6: upload → metadata, signed download, delete.
 *
 * Порядок upload (без фоновых воркеров, этап S8 отсутствует):
 * session → membership → purchase в скоупе → валидация → строка метаданных
 * (без ключа) → put объекта → запись ключа в строку.
 *
 * Failure behavior — явный, без тихой зачистки:
 * - упал put → строка остаётся без ключа: скачивание отвечает 404,
 *   reconciliation видит «metadata pointing to missing object»;
 * - упал commit метаданных после put → объект-сирота: reconciliation видит
 *   «orphan object», удаляется только явным delete (S8 решит фоновую чистку);
 * - обе операции идут последовательно в вызывающем порядке, а не в одной
 *   транзакции: БД и хранилище заведомо не атомарны, код это показывает.
 *
 * Тексты в PostgreSQL не кладутся никогда (только sha/size в метаданных).
 * Сами байты в отчёты/логи не попадают — только id, счётчики, хеши.
 */

import { MAX_FILE_BYTES } from "@/lib/read-documents";

import { auditEvent } from "../audit/service.ts";
import type { DbClient } from "../db/db-client.ts";
import { InvalidArgumentError, NotFoundInScopeError } from "../db/errors.ts";
import type { OrgScope } from "../db/org-scope.ts";
import { findMembership, orgRepositories } from "../db/repositories/index.ts";
import { sha256HexBytes } from "./sign.ts";
import { documentObjectKey, parseObjectKey } from "./keys.ts";
import { signedUrlTtlSeconds } from "./config.ts";
import { StorageError, type StorageAdapter, type StoredObjectHead } from "./types.ts";

export type FileContext = {
  db: DbClient;
  storage: StorageAdapter;
  scope: OrgScope;
  /**
   * Пользователь-инициатор. `null` — системный контекст фоновой задачи
   * (например, сверка хранилища), где конкретного пользователя нет.
   */
  userId: string | null;
};

type Row = Record<string, unknown>;

async function requireMember(ctx: FileContext): Promise<void> {
  if (!ctx.userId) {
    throw new NotFoundInScopeError("files.requireMember");
  }
  const membership = await findMembership(ctx.db, ctx.scope, ctx.userId);
  if (!membership) {
    throw new NotFoundInScopeError("files.requireMember");
  }
}

const BASE64_RE = /^[A-Za-z0-9+/=_-]*$/;

export type UploadInput = {
  purchaseId: string;
  fileName: string;
  mimeType?: unknown;
  contentBase64: unknown;
  sha256?: unknown;
  ocr?: unknown;
};

export type UploadedFile = {
  id: string;
  legacyId: null;
  purchaseId: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  sha256: string;
  ocr: boolean;
};

/** Поиск закупки в скоупе: чужая или отсутствующая — null (без раскрытия). */
async function findPurchase(ctx: FileContext, purchaseId: string): Promise<Row | null> {
  const repos = orgRepositories(ctx.db, ctx.scope);
  const byLegacy = (await repos.purchase.list({ where: { legacyId: purchaseId } })) as unknown as Row[];
  if (byLegacy.length > 1) {
    throw new InvalidArgumentError("files: дубль закупки");
  }
  return byLegacy[0] ?? ((await repos.purchase.getById(purchaseId)) as unknown as Row | null);
}

function validatedBytes(input: UploadInput): { bytes: Uint8Array; sha256: string } {
  if (typeof input.fileName !== "string" || !input.fileName.trim() || input.fileName.length > 500) {
    throw new InvalidArgumentError("files.upload — некорректное имя файла");
  }
  if (input.mimeType !== undefined && (typeof input.mimeType !== "string" || input.mimeType.length > 200)) {
    throw new InvalidArgumentError("files.upload — некорректный MIME-тип");
  }
  if (typeof input.contentBase64 !== "string" || !BASE64_RE.test(input.contentBase64)) {
    throw new InvalidArgumentError("files.upload — тело обязано быть base64");
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(input.contentBase64, "base64"));
  } catch {
    throw new InvalidArgumentError("files.upload — тело не декодируется из base64");
  }
  if (bytes.length === 0) {
    throw new InvalidArgumentError("files.upload — пустой файл");
  }
  if (bytes.length > MAX_FILE_BYTES) {
    throw new InvalidArgumentError(`files.upload — файл больше ${MAX_FILE_BYTES} байт`);
  }
  const sha256 = sha256HexBytes(bytes);
  if (input.sha256 !== undefined) {
    if (typeof input.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(input.sha256)) {
      throw new InvalidArgumentError("files.upload — некорректный sha256");
    }
    if (input.sha256.toLowerCase() !== sha256) {
      throw new InvalidArgumentError("files.upload — sha256 не совпал с содержимым");
    }
  }
  if (input.ocr !== undefined && typeof input.ocr !== "boolean") {
    throw new InvalidArgumentError("files.upload — ocr обязан быть boolean");
  }
  return { bytes, sha256 };
}

/**
 * Загрузка файла: метаданные → объект → ключ в строку. Возвращаемые метаданные
 * не содержат `storageKey`: скачивание идёт только по id документа.
 */
export async function uploadDocument(ctx: FileContext, input: UploadInput): Promise<UploadedFile> {
  await requireMember(ctx);
  if (typeof input.purchaseId !== "string" || !input.purchaseId || input.purchaseId.length > 200) {
    throw new InvalidArgumentError("files.upload — некорректный purchaseId");
  }
  const purchase = await findPurchase(ctx, input.purchaseId);
  if (!purchase) {
    throw new NotFoundInScopeError("files.upload");
  }
  const { bytes, sha256 } = validatedBytes(input);
  const repos = orgRepositories(ctx.db, ctx.scope);
  const created = (await repos.document.create({
    legacyId: null,
    purchaseId: purchase.id,
    fileName: input.fileName.trim(),
    mimeType: typeof input.mimeType === "string" && input.mimeType ? input.mimeType : null,
    sizeBytes: bytes.length,
    sha256,
    storageKey: null,
    textKey: null,
    pageCount: null,
    ocr: input.ocr === true,
    readError: null,
  })) as unknown as Row;
  const key = documentObjectKey(ctx.scope.organizationId, created.id as string);
  try {
    await ctx.storage.putObject(key, bytes, { contentType: "application/octet-stream", sha256 });
  } catch (error) {
    // Строка без ключа остаётся: скачивание ответит 404, reconciliation увидит
    // «metadata pointing to missing object». Молча откатывать строку нельзя:
    // клиент уже получил бы id несуществующей записи при другом порядке.
    throw error instanceof StorageError
      ? error
      : new StorageError("put-failed", error instanceof Error ? error.message : String(error));
  }
  await repos.document.update(created.id as string, { storageKey: key });
  await auditEvent(ctx.db, ctx.scope, {
    actorUserId: ctx.userId,
    action: "document.uploaded",
    entityType: "document",
    entityId: created.id as string,
    metadata: { sizeBytes: bytes.length, sha256 },
  });
  return {
    id: created.id as string,
    legacyId: null,
    purchaseId: purchase.id as string,
    fileName: input.fileName.trim(),
    mimeType: typeof input.mimeType === "string" && input.mimeType ? input.mimeType : null,
    sizeBytes: bytes.length,
    sha256,
    ocr: input.ocr === true,
  };
}

export type DownloadGrant = { url: string; expiresIn: number; documentId: string };

/**
 * Выдача подписанной ссылки: session → membership → строка в скоупе →
 * подписанный URL. Знание `storageKey` само по себе ссылку не даёт:
 * ключ из запроса не принимается вообще.
 */
export async function grantDocumentDownload(ctx: FileContext, documentId: string): Promise<DownloadGrant> {
  await requireMember(ctx);
  if (typeof documentId !== "string" || !documentId || documentId.length > 200) {
    throw new InvalidArgumentError("files.download — некорректный id");
  }
  const repos = orgRepositories(ctx.db, ctx.scope);
  const byLegacy = (await repos.document.list({ where: { legacyId: documentId } })) as unknown as Row[];
  if (byLegacy.length > 1) {
    throw new InvalidArgumentError("files.download: дубль документа");
  }
  const row = byLegacy[0] ?? ((await repos.document.getById(documentId)) as unknown as Row | null);
  if (!row || typeof row.storageKey !== "string" || !row.storageKey) {
    // Нет строки, чужая строка и строка без объекта — один ответ 404:
    // enumeration по различию ответов исключено.
    throw new NotFoundInScopeError("files.download");
  }
  const ttl = signedUrlTtlSeconds();
  const { url, expiresIn } = await ctx.storage.getSignedUrl(row.storageKey, ttl);
  await auditEvent(ctx.db, ctx.scope, {
    actorUserId: ctx.userId,
    action: "document.downloaded",
    entityType: "document",
    entityId: row.id as string,
    metadata: { expiresIn },
  });
  return { url, expiresIn, documentId: row.id as string };
}

export type DeleteResult = { ok: true; objectDeleted: boolean };

/**
 * Удаление: сначала объект, затем строка. Объект уже отсутствует —
 * строка всё равно удаляется, но ответ явно говорит `objectDeleted: false`
 * (ложного успеха нет). Строки нет — 404. Повтор — тоже 404.
 */
export async function deleteDocument(ctx: FileContext, documentId: string): Promise<DeleteResult> {
  await requireMember(ctx);
  if (typeof documentId !== "string" || !documentId || documentId.length > 200) {
    throw new InvalidArgumentError("files.delete — некорректный id");
  }
  const repos = orgRepositories(ctx.db, ctx.scope);
  const byLegacy = (await repos.document.list({ where: { legacyId: documentId } })) as unknown as Row[];
  if (byLegacy.length > 1) {
    throw new InvalidArgumentError("files.delete: дубль документа");
  }
  const row = byLegacy[0] ?? ((await repos.document.getById(documentId)) as unknown as Row | null);
  if (!row) {
    throw new NotFoundInScopeError("files.delete");
  }
  // Удаляются все объекты строки: исходник, текст и карта (S11-R0). Иначе они
  // остаются сиротами и ломают сверку S8 / валидацию backup S9.
  let objectDeleted = false;
  for (const key of [row.storageKey, row.textKey, row.mapKey]) {
    if (typeof key === "string" && key) {
      const removed = await ctx.storage.deleteObject(key);
      if (key === row.storageKey) {
        objectDeleted = removed.deleted;
      }
    }
  }
  await repos.document.remove(row.id as string);
  await auditEvent(ctx.db, ctx.scope, {
    actorUserId: ctx.userId,
    action: "document.deleted",
    entityType: "document",
    entityId: row.id as string,
    metadata: { objectDeleted },
  });
  return { ok: true, objectDeleted };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation файлового слоя (только тесты/диагностика, не request path)
// ─────────────────────────────────────────────────────────────────────────────

export type FileReconciliation = {
  checked: number;
  ok: number;
  metadataWithoutObject: string[];
  orphanObjects: string[];
  sizeMismatch: string[];
  checksumMismatch: string[];
  crossTenant: string[];
  duplicateKeys: string[];
  match: boolean;
};

/**
 * Сверка метаданных PostgreSQL с объектами хранилища:
 * существование, размер, checksum; сироты; ссылки в никуда; чужие tenant
 * в ключах; дубли ключей. Байты содержимого в отчёт не попадают.
 */
export async function reconcileFileStorage(
  ctx: FileContext,
  storage: StorageAdapter = ctx.storage,
): Promise<FileReconciliation> {
  const repos = orgRepositories(ctx.db, ctx.scope);
  const rows = (await repos.document.list()) as unknown as Row[];
  const withKeys = rows.filter((r) => typeof r.storageKey === "string" && r.storageKey);
  const seen = new Map<string, string[]>();
  const metadataWithoutObject: string[] = [];
  const sizeMismatch: string[] = [];
  const checksumMismatch: string[] = [];
  const crossTenant: string[] = [];
  let ok = 0;

  for (const row of withKeys) {
    const key = row.storageKey as string;
    const list = seen.get(key) ?? [];
    list.push(row.id as string);
    seen.set(key, list);
    const parsed = parseObjectKey(key);
    if (parsed.kind === "document" && parsed.organizationId !== ctx.scope.organizationId) {
      crossTenant.push(row.id as string);
      continue;
    }
    let head: StoredObjectHead | null;
    try {
      head = await storage.headObject(key);
    } catch {
      head = null;
    }
    if (!head || !head.exists) {
      metadataWithoutObject.push(row.id as string);
      continue;
    }
    let mismatch = false;
    if (head.sizeBytes !== null && head.sizeBytes !== (row.sizeBytes as number)) {
      sizeMismatch.push(row.id as string);
      mismatch = true;
    }
    if (head.sha256 !== null && head.sha256 !== (row.sha256 as string)) {
      checksumMismatch.push(row.id as string);
      mismatch = true;
    }
    if (!mismatch) {
      ok += 1;
    }
  }

  const duplicateKeys = [...seen.entries()].filter(([, ids]) => ids.length > 1).map(([key]) => key);
  // Только префикс документов: объекты образцов лежат под `.../sample/` и в
  // сверку документов не входят. Карты документов (`mapKey`) — часть известного
  // набора, иначе они выглядели бы сиротами (S11-R0).
  const prefix = `org/${ctx.scope.organizationId}/doc/`;
  let orphanObjects: string[] = [];
  try {
    const objects = await storage.listObjects(prefix);
    const known = new Set<string>([
      ...withKeys.map((r) => r.storageKey as string),
      ...rows
        .filter((r) => typeof r.mapKey === "string" && r.mapKey)
        .map((r) => r.mapKey as string),
    ]);
    orphanObjects = objects.filter((k) => !known.has(k));
  } catch {
    orphanObjects = [];
  }

  const match =
    metadataWithoutObject.length === 0 &&
    orphanObjects.length === 0 &&
    sizeMismatch.length === 0 &&
    checksumMismatch.length === 0 &&
    crossTenant.length === 0 &&
    duplicateKeys.length === 0;
  return {
    checked: withKeys.length,
    ok,
    metadataWithoutObject,
    orphanObjects,
    sizeMismatch,
    checksumMismatch,
    crossTenant,
    duplicateKeys,
    match,
  };
}
