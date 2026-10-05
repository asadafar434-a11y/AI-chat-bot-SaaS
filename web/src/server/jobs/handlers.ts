/**
 * Обработчики фоновых задач S8.
 *
 * Контракт handler: загрузить из БД → проверить принадлежность по БД (payload
 * — не доказательство владения) → выполнить операцию → сохранить результат →
 * вернуть исход. Ошибки классифицируются: `RetryableJobError` (повтор),
 * `PermanentJobError`/`{status:"permanent"}` (терминально).
 *
 * Runtime инъектируется: в тестах подменяются db/storage/extract/audit, а
 * тяжёлый `@/lib/extract-text` и next-auth подгружаются только в реальном
 * прогоне (динамический импорт).
 */

import { auditEvent } from "../audit/service.ts";
import type { AuditInput } from "../audit/service.ts";
import type { DbClient } from "../db/db-client.ts";
import { getDb } from "../db/client.ts";
import type { OrgScope } from "../db/org-scope.ts";
import { orgScope } from "../db/org-scope.ts";
import { createStorageAdapter } from "../storage/config.ts";
import { putObjectJson } from "../storage/content.ts";
import { reconcileFileStorage, type FileContext } from "../storage/files.ts";
import { documentObjectKey } from "../storage/keys.ts";
import { StorageError, type StorageAdapter } from "../storage/types.ts";
import type { DocMap } from "@/lib/doc-source";
import type { DocumentExtractJob, StorageReconcileJob } from "./queues.ts";
import { RetryableJobError } from "./queues.ts";

export type JobOutcome =
  | { status: "completed"; output?: Record<string, unknown> }
  | { status: "permanent"; error: string };

export type DocumentTextResult =
  | { ok: true; text: string; scan?: boolean; map?: DocMap }
  | { ok: false; reason: string };

export type DocumentTextExtractor = (
  bytes: Uint8Array,
  fileName: string,
  mimeType: string | null,
) => Promise<DocumentTextResult>;

export type JobRuntime = {
  db: DbClient;
  storage: StorageAdapter;
  extractText: DocumentTextExtractor;
  audit: (db: DbClient, scope: OrgScope, input: AuditInput) => Promise<unknown>;
};

let override: Partial<JobRuntime> | null = null;

/** Подмена зависимостей в тестах. `null` возвращает реальные зависимости. */
export function setJobRuntimeForTests(rt: Partial<JobRuntime> | null): void {
  override = rt;
}

async function defaultExtractText(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string | null,
): Promise<DocumentTextResult> {
  // Динамический импорт: тянет pdf-parse/mammoth/OCR — нужен только в реальном
  // worker-процессе, не в модульных тестах.
  const { extractText } = await import("@/lib/extract-text");
  const file = new File([new Uint8Array(bytes)], fileName, mimeType ? { type: mimeType } : undefined);
  return extractText(file, { ocr: false });
}

function runtime(): JobRuntime {
  return {
    db: override?.db ?? getDb(),
    storage: override?.storage ?? createStorageAdapter(),
    extractText: override?.extractText ?? defaultExtractText,
    audit: override?.audit ?? auditEvent,
  };
}

/**
 * Сверка метаданных PostgreSQL с объектным хранилищем.
 * Read-only, идемпотентна: повторный запуск не меняет состояние и не удаляет
 * найденные «сироты» (S8 — инфраструктура запуска, а не destructive cleanup).
 */
export async function storageReconcileHandler(job: { data: StorageReconcileJob }): Promise<JobOutcome> {
  const { organizationId, requestId } = job.data;
  const rt = runtime();
  const scope = orgScope(organizationId);
  const ctx: FileContext = { db: rt.db, storage: rt.storage, scope, userId: null };

  const report = await reconcileFileStorage(ctx, rt.storage);

  await rt.audit(rt.db, scope, {
    actorUserId: null,
    action: "storage.reconciled",
    entityType: "organization",
    entityId: organizationId,
    metadata: {
      requestId,
      checked: report.checked,
      missing: report.metadataWithoutObject.length,
      orphan: report.orphanObjects.length,
      crossTenant: report.crossTenant.length,
      duplicateKeys: report.duplicateKeys.length,
      sizeMismatch: report.sizeMismatch.length,
      checksumMismatch: report.checksumMismatch.length,
    },
  });

  return { status: "completed", output: { checked: report.checked, match: report.match } };
}

/**
 * Извлечение текста документа, загруженного в S6-хранилище.
 *
 * Идемпотентность: если `textKey` уже заполнен — повтор пропускается.
 * Формат, который не поддержан (в т.ч. скан без OCR) — терминальный отказ с
 * `readError` в строке, без бесконечных повторов.
 */
export async function documentExtractHandler(job: { data: DocumentExtractJob }): Promise<JobOutcome> {
  const { documentId, organizationId } = job.data;
  const rt = runtime();
  const scope = orgScope(organizationId);

  // Принадлежность доказывается строкой БД, а не payload.
  const doc = (await rt.db.document.findFirst({
    where: { id: documentId, organizationId },
  })) as {
    id: string;
    storageKey: string | null;
    textKey: string | null;
    fileName: string;
    mimeType: string | null;
  } | null;

  if (!doc) {
    return { status: "permanent", error: "unknown-document" };
  }
  if (!doc.storageKey) {
    return { status: "permanent", error: "no-object" };
  }
  if (doc.textKey) {
    return { status: "completed", output: { skipped: true } };
  }

  const object = await rt.storage.getObject(doc.storageKey);
  if (!object) {
    return { status: "permanent", error: "object-missing" };
  }

  let extraction: DocumentTextResult;
  try {
    extraction = await rt.extractText(object.bytes, doc.fileName, doc.mimeType);
  } catch (error) {
    if (error instanceof StorageError) {
      throw new RetryableJobError("storage", error.message);
    }
    throw error;
  }

  if (!extraction.ok) {
    await rt.db.document.updateMany({
      where: { id: documentId, organizationId },
      data: { readError: extraction.reason },
    });
    return { status: "permanent", error: extraction.reason };
  }

  const textKey = documentObjectKey(organizationId, documentId);
  await rt.storage.putObject(textKey, new TextEncoder().encode(extraction.text), {
    contentType: "text/plain; charset=utf-8",
  });
  // Карта (страница/таблица/ячейка) — производная от текста, но её нельзя
  // восстановить без исходного файла: сохраняем рядом с текстом (S11-R0).
  const data: Record<string, unknown> = { textKey, readError: null };
  if (extraction.map) {
    const mapKey = documentObjectKey(organizationId, documentId);
    await putObjectJson(rt.storage, mapKey, extraction.map);
    data.mapKey = mapKey;
  }
  await rt.db.document.updateMany({
    where: { id: documentId, organizationId },
    data,
  });

  await rt.audit(rt.db, scope, {
    actorUserId: null,
    action: "document.extracted",
    entityType: "document",
    entityId: documentId,
    metadata: { chars: extraction.text.length, scan: extraction.scan === true },
  });

  return { status: "completed", output: { chars: extraction.text.length } };
}

/** Реестр обработчиков. Ключи совпадают с именами очередей. */
export const JOB_HANDLERS = {
  "storage.reconcile": storageReconcileHandler,
  "document.extract": documentExtractHandler,
} as const;
