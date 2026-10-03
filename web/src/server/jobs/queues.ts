/**
 * Реестр очередей S8: имена, схемы payload, политики retry/backoff.
 *
 * Только реальные background workloads, найденные в коде:
 * - `storage.reconcile` — сверка метаданных PostgreSQL с объектным хранилищем
 *   (`reconcileFileStorage` из S6): долгая read-only операция, идемпотентна;
 * - `document.extract` — фоновое извлечение текста загруженного документа
 *   (S6 object → текст → `textKey`): тяжёлая операция (PDF/DOCX/XLSX/OCR),
 *   которую нельзя держать в HTTP-запросе.
 *
 * Одна универсальная очередь `default` сознательно не заводится.
 */

import { z } from "zod/v4";

export const QUEUE_NAMES = ["storage.reconcile", "document.extract"] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

// ─── Payload-схемы (строгая валидация до постановки) ─────────────────────────
//
// Payload содержит только серверные идентификаторы. Секреты, cookie, токены,
// signed URL, бинарные данные и произвольные тела запросов недопустимы.

export const StorageReconcilePayload = z.object({
  organizationId: z.string().min(1).max(200),
  requestId: z.string().min(1).max(200),
  operationVersion: z.literal(1),
});

export const DocumentExtractPayload = z.object({
  documentId: z.string().min(1).max(200),
  organizationId: z.string().min(1).max(200),
  operationVersion: z.literal(1),
});

export type StorageReconcileJob = z.infer<typeof StorageReconcilePayload>;
export type DocumentExtractJob = z.infer<typeof DocumentExtractPayload>;

// ─── Классификация ошибок ────────────────────────────────────────────────────
//
// pg-boss повторяет задачу при ошибке. Разделяем явно:
// - RetryableJobError — временная причина (сеть, хранилище, провайдер); повтор
//   с exponential backoff до retryLimit;
// - PermanentJobError — повтор не исправит (неверный payload, нет сущности,
//   неподдерживаемый формат); задача завершается терминально (`deadletter`)
//   без бесконечных повторов.

export class RetryableJobError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`RetryableJobError(${code}): ${message}`);
    this.name = "RetryableJobError";
    this.code = code;
  }
}

export class PermanentJobError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`PermanentJobError(${code}): ${message}`);
    this.name = "PermanentJobError";
    this.code = code;
  }
}

// ─── Определения очередей ────────────────────────────────────────────────────

export type RetryPolicy = {
  maxRetries: number;
  /** Базовая задержка до первого повтора, секунды. */
  backoffSeconds: number;
  /** Верхний предел задержки, секунды. */
  backoffMaxSeconds: number;
};

export type QueueDefinition = {
  name: QueueName;
  payloadSchema: z.ZodType;
  retryPolicy: RetryPolicy;
  /** Таймаут задачи, секунды (pg-boss `expireInSeconds`). */
  timeoutSeconds: number;
  /** Параллелизм воркера. */
  concurrency: number;
  /** Интервал опроса пустой очереди, мс. */
  pollIntervalMs: number;
  /** Идемпотентность: что делает повторный запуск безопасным. */
  idempotency: string;
};

export const QUEUE_REGISTRY: Record<QueueName, QueueDefinition> = {
  "storage.reconcile": {
    name: "storage.reconcile",
    payloadSchema: StorageReconcilePayload,
    retryPolicy: { maxRetries: 2, backoffSeconds: 30, backoffMaxSeconds: 120 },
    timeoutSeconds: 120,
    concurrency: 1,
    pollIntervalMs: 3000,
    idempotency: "organizationId + requestId: read-only сверка, повтор не меняет состояние",
  },
  "document.extract": {
    name: "document.extract",
    payloadSchema: DocumentExtractPayload,
    retryPolicy: { maxRetries: 3, backoffSeconds: 10, backoffMaxSeconds: 120 },
    timeoutSeconds: 300,
    concurrency: 2,
    pollIntervalMs: 2000,
    idempotency: "documentId + operationVersion: если текст уже извлечён, повтор пропускается",
  },
};

export function getQueueDefinition(name: QueueName): QueueDefinition {
  const def = QUEUE_REGISTRY[name];
  if (!def) {
    throw new Error(`jobs: неизвестная очередь ${name}`);
  }
  return def;
}

const ALLOWED_KEYS: Record<QueueName, readonly string[]> = {
  "storage.reconcile": ["organizationId", "requestId", "operationVersion"],
  "document.extract": ["documentId", "organizationId", "operationVersion"],
};

/**
 * Валидирует payload по схеме очереди и отклоняет лишние поля.
 * Неизвестные поля отклоняются явно: тело, пришедшее от клиента, не должно
 * проскакивать в очередь как есть.
 */
export function validatePayload(
  name: QueueName,
  payload: unknown,
): { ok: true; data: unknown } | { ok: false; error: string } {
  const def = getQueueDefinition(name);
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "payload обязан быть объектом" };
  }
  const allowed = ALLOWED_KEYS[name];
  const extra = Object.keys(payload as Record<string, unknown>).filter((k) => !allowed.includes(k));
  if (extra.length > 0) {
    return { ok: false, error: `недопустимые поля payload: ${extra.join(", ")}` };
  }
  const result = def.payloadSchema.safeParse(payload);
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  return { ok: true, data: result.data };
}

/** Классифицирует неожиданную ошибку: по умолчанию повторяемая (ограничено retryLimit). */
export function isRetryable(error: unknown): boolean {
  if (error instanceof PermanentJobError) {
    return false;
  }
  return true;
}
