/**
 * Server-side генерация object keys (S0: `org/{organizationId}/doc/{documentId}/{random}`).
 *
 * Свойства:
 * - никакого пользовательского ввода: имя файла, пути и `../` в ключ не попадают;
 * - tenant scope зашит первым сегментом — принадлежность видна без БД;
 * - случайный хвост делает ключ неперебираемым даже при известном id;
 * - формат проверяется парсером: чужой или битый ключ отклоняется до запросов.
 */

import { randomBytes } from "node:crypto";

export type ParsedObjectKey =
  | { kind: "document"; organizationId: string; documentId: string }
  | { kind: "sample"; organizationId: string; sampleId: string }
  | { kind: "unknown" };

/** Новый ключ документа: только серверные идентификаторы плюс случайность. */
export function documentObjectKey(organizationId: string, documentId: string): string {
  assertSafeSegment(organizationId, "organizationId");
  assertSafeSegment(documentId, "documentId");
  return `org/${organizationId}/doc/${documentId}/${randomBytes(16).toString("hex")}`;
}

/** Новый ключ текста/карты образца участника (S11-R0). */
export function sampleObjectKey(organizationId: string, sampleId: string): string {
  assertSafeSegment(organizationId, "organizationId");
  assertSafeSegment(sampleId, "sampleId");
  return `org/${organizationId}/sample/${sampleId}/${randomBytes(16).toString("hex")}`;
}

function assertSafeSegment(value: string, name: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 64 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`keys: некорректный ${name}`);
  }
}

/** Разбор ключа с проверкой формы. Не прошедший проверку — `unknown`, не исключение. */
export function parseObjectKey(key: string): ParsedObjectKey {
  if (typeof key !== "string") {
    return { kind: "unknown" };
  }
  // org/{organizationId}/{doc|sample}/{entityId}/{random}: ровно 5 сегментов.
  const parts = key.split("/");
  if (parts.length !== 5 || parts[0] !== "org" || (parts[2] !== "doc" && parts[2] !== "sample")) {
    return { kind: "unknown" };
  }
  const [, organizationId, kind, entityId, random] = parts;
  try {
    assertSafeSegment(organizationId, "organizationId");
  } catch {
    return { kind: "unknown" };
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(entityId) || !/^[0-9a-f]{32}$/.test(random)) {
    return { kind: "unknown" };
  }
  return kind === "doc"
    ? { kind: "document", organizationId, documentId: entityId }
    : { kind: "sample", organizationId, sampleId: entityId };
}
