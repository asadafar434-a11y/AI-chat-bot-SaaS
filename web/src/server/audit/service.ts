/**
 * Единый server-side audit service S7.
 *
 * Каждое событие фиксирует: кто (actor из серверного контекста), в какой
 * организации (скоуп, никогда из запроса), что (строгое действие из
 * таксономии), над каким объектом (тип + id), когда (createdAt БД) и с каким
 * результатом (поля метаданных). Пишется только через этот модуль.
 *
 * Гарантии:
 * - actor/organization — только серверные (параметры вызывающего сервиса,
 *   в production — из сессии и членства); клиентские userId/orgId сюда
 *   не попадают by construction: в сигнатуре их нет;
 * - действие и тип сущности — из закрытых allowlist: опечатка и выдуманное
 *   событие отклоняются до записи;
 * - метаданные проходят sanitization: запрещённые ключи (пароли, токены,
 *   секреты, карты), только JSON-скаляры, лимит размера;
 * - запись — через репозиторий S1 (`appendAuditEvent`), организация
 *   проставляется скоупом и не может быть подменена аргументом;
 * - append-only: обновления и удаления строк нет ни в этом модуле, ни где-либо
 *   в application API (проверяется тестом поверхности).
 */

import type { DbClient } from "../db/db-client.ts";
import { InvalidArgumentError } from "../db/errors.ts";
import type { OrgScope } from "../db/org-scope.ts";
import { appendAuditEvent } from "../db/repositories/index.ts";

/**
 * Стабильная таксономия S7: только реально существующие server-side мутации.
 * Прошлое время, точечная нотация (контракт S0, data-model.md §3.10).
 */
export const AUDIT_ACTIONS = [
  "purchase.created",
  "purchase.updated",
  "purchase.deleted",
  "purchase.documents.replaced",
  "sample.created",
  "sample.updated",
  "sample.deleted",
  "fact.created",
  "fact.updated",
  "fact.deleted",
  "profile.updated",
  "document.uploaded",
  "document.downloaded",
  "document.deleted",
  "invitation.created",
  "member.joined",
  "member.role_changed",
  "member.removed",
  "auth.password_reset",
  // S8: события фоновых задач.
  "document.extracted",
  "storage.reconciled",
  // P1: удаление данных пользователем (owner — данные организации, member — личные).
  "organization.wiped",
  "user.data_wiped",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ENTITY_TYPES = [
  "purchase",
  "document",
  "fact",
  "sample",
  "profile",
  "member",
  "invitation",
  "user",
  "organization",
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export function isAuditAction(value: unknown): value is AuditAction {
  return typeof value === "string" && (AUDIT_ACTIONS as readonly string[]).includes(value);
}

export function isAuditEntityType(value: unknown): value is AuditEntityType {
  return typeof value === "string" && (AUDIT_ENTITY_TYPES as readonly string[]).includes(value);
}

/** Ключи, которые никогда не попадают в метаданные (регистронезависимо). */
const FORBIDDEN_METADATA_KEYS = new Set([
  "password",
  "passwordhash",
  "passwd",
  "secret",
  "token",
  "sessiontoken",
  "refreshtoken",
  "accesstoken",
  "idtoken",
  "cookie",
  "set-cookie",
  "authorization",
  "apikey",
  "api_key",
  "card",
  "cardnumber",
  "pan",
  "cvv",
  "cvc",
  "privatekey",
]);

const MAX_METADATA_JSON_BYTES = 4096;

function sanitizeValue(value: unknown, path: string): unknown {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    if (value.length > 500) {
      throw new InvalidArgumentError(`audit.metadata: значение ${path} длиннее 500 символов`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new InvalidArgumentError(`audit.metadata: значение ${path} не конечно`);
    }
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeValue(item, `${path}[${index}]`));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_METADATA_KEYS.has(key.toLowerCase())) {
        throw new InvalidArgumentError(`audit.metadata: запрещённый ключ ${path}.${key}`);
      }
      out[key] = sanitizeValue(entry, path ? `${path}.${key}` : key);
    }
    return out;
  }
  throw new InvalidArgumentError(`audit.metadata: значение ${path || "корень"} недопустимого типа`);
}

/**
 * Чистит метаданные: только plain-объект JSON-скаляров без запрещённых ключей,
 * суммарно не больше 4 КБ. Отсутствующие метаданные — `null`, а не `{}`:
 * пустой объект означал бы «нечего сказать», null — «метаданных нет».
 */
export function sanitizeMetadata(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidArgumentError("audit.metadata: метаданные обязаны быть объектом");
  }
  const clean = sanitizeValue(value, "") as Record<string, unknown>;
  if (Buffer.byteLength(JSON.stringify(clean), "utf8") > MAX_METADATA_JSON_BYTES) {
    throw new InvalidArgumentError("audit.metadata: превышен лимит 4 КБ");
  }
  return clean;
}

export type AuditInput = {
  /**
   * Server identity вызывающего: в production — из сессии. `null` — системное
   * событие фоновой задачи без конкретного пользователя (не подставляем
   * случайного actor).
   */
  actorUserId: string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  metadata?: unknown;
};

export type AuditEventRow = {
  id: string;
  organizationId: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: Date;
};

/**
 * Записать событие. Организация — только из скоупа. Бросает на невалидном
 * входе до всякого обращения к БД; вызывающий код не перехватывает ошибку
 * молча — иначе мутация и аудит разойдутся.
 */
export async function auditEvent(db: DbClient, scope: OrgScope, input: AuditInput): Promise<AuditEventRow> {
  if (input.actorUserId !== null && (typeof input.actorUserId !== "string" || input.actorUserId.length === 0)) {
    throw new InvalidArgumentError("audit: actorUserId — непустая строка либо null (системное событие)");
  }
  if (!isAuditAction(input.action)) {
    throw new InvalidArgumentError(`audit: неизвестное действие ${JSON.stringify(input.action)}`);
  }
  if (!isAuditEntityType(input.entityType)) {
    throw new InvalidArgumentError(`audit: неизвестный тип сущности ${JSON.stringify(input.entityType)}`);
  }
  if (typeof input.entityId !== "string" || input.entityId.length === 0) {
    throw new InvalidArgumentError("audit: entityId обязан быть непустой строкой");
  }
  const metadata = sanitizeMetadata(input.metadata);
  return (await appendAuditEvent(db, scope, {
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata,
  })) as unknown as AuditEventRow;
}
