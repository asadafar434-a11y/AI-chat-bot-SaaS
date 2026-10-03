/**
 * Типы import pipeline S3: IndexedDB (формат `tender-lawyer-backup` v1) → PostgreSQL.
 *
 * Этапы конвейера зеркалят задачу S3:
 * S3.1 parse → S3.2 validate → S3.3 normalize → S3.4 plan → S3.5 import →
 * S3.6 verify → S3.7 reconciliation.
 *
 * Принципы, зашитые в типы:
 * - ни одна запись не перезаписывается молча: расхождение существующей строки
 *   с источником — это `conflict`, а не обновление;
 * - в отчётах нет содержимого документов и значений реквизитов — только
 *   идентификаторы (`legacyId`), счётчики, причины и хеши;
 * - профиль не имеет `legacyId`: его ключ — константа `"profile"`.
 */

/** Сущности переноса. `profiles` объединяет `settings["profile"]` и `settings["profile-meta"]`. */
export type BackupEntity = "purchases" | "documents" | "samples" | "facts" | "profiles";

export const BACKUP_ENTITIES: readonly BackupEntity[] = [
  "purchases",
  "documents",
  "samples",
  "facts",
  "profiles",
];

/** Секции исходной копии (формат `Dump` из `backup-format.ts`). */
export type BackupSection = "purchases" | "documents" | "settings" | "samples" | "facts";

/** Запись, отброшенная разбором или валидацией: только адрес и причина, без содержимого. */
export type MalformedRecord = {
  section: BackupSection;
  /** Позиция в исходном массиве секции (для `documents` — позиция пары, для `settings` — позиция пары). */
  index: number;
  /** Ключ пары (`documents`: id закупки, `settings`: имя настройки), если известен. */
  key?: string;
  reason: string;
};

/** Запись, которую нельзя импортировать: валидна как JSON, но не ложится в схему. */
export type UnimportableRecord = {
  entity: BackupEntity;
  legacyId: string;
  reason: string;
};

/** Нормализованная закупка — ровно те данные, которые лягут в колонки `Purchase`. */
export type NormalizedPurchase = {
  legacyId: string;
  originalFormatVersion: number;
  status: "draft" | "submitted";
  payload: Record<string, unknown>;
};

/**
 * Нормализованный документ — только метаданные. Текст документа в PostgreSQL
 * не хранится (этап S6): от него остаётся `sha256` и `sizeBytes`, а сам текст
 * покрывается контрольной суммой батча.
 */
export type NormalizedDocument = {
  legacyId: string;
  purchaseLegacyId: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  sha256: string;
  pageCount: null;
  ocr: boolean;
  readError: string | null;
};

/** Нормализованный образец. Текст — только в контрольной сумме (этап S6). */
export type NormalizedSample = {
  legacyId: string;
  kinds: string[];
  about: string;
  textChecksum: string;
  /** Поля `MyDocument` без целевых колонок (`name`, `addedAt`, `scan`, `map`): зафиксированная потеря. */
  dropped: string[];
};

/** Нормализованный факт — все поля ложатся в колонки `Fact` один к одному. */
export type NormalizedFact = {
  legacyId: string;
  kind: string;
  title: string;
  fields: Record<string, string>;
  measures: unknown[];
  validity: Record<string, unknown>;
  source: unknown;
  origin: string;
  confirmed: boolean;
  answers: string[] | null;
};

/**
 * Нормализованный профиль. Разделение — по контракту (data-model.md §4.1):
 * 15 корпоративных ключей → `OrganizationProfile.fields`, 5 персональных →
 * `UserProfile.fields`. Неизвестные ключи никуда не попадают и перечисляются
 * в `unknownKeys` для отчёта.
 */
export type NormalizedProfiles = {
  orgFields: Record<string, string>;
  orgVersion: number;
  userFields: Record<string, string>;
  userVersion: number;
  filledOrg: number;
  filledUser: number;
  unknownKeys: string[];
  /** Нет ни одного заполненного поля — импортировать нечего. */
  empty: boolean;
};

/** Агрегаты сверки (migration-and-rollback.md §7): считаются и по источнику, и по цели. */
export type Aggregates = {
  /** Сумма `tpPrice` по закупкам. */
  tpPriceSum: number;
  /** Число закупок с непустым `tp`. */
  purchasesWithTp: number;
  /** Число подтверждённых фактов. */
  confirmedFacts: number;
  /** Число фактов со сроком (`validity.until` непуст). */
  factsWithTerm: number;
  /** Число закупок с непустым `unreadable`. */
  purchasesWithUnreadable: number;
};

/** План по одной сущности (этап S3.4, он же основа `--dry-run`). */
export type EntityPlan = {
  entity: BackupEntity;
  source: number;
  exists: number;
  toCreate: number;
  conflicts: number;
  unimportable: number;
  conflictLegacyIds: string[];
  unimportableList: UnimportableRecord[];
};

/** План всего импорта до первой записи (этап S3.4). */
export type ImportPlan = {
  batchKey: string;
  backupHash: string;
  backupFormatVersion: number;
  organizationId: string;
  entities: EntityPlan[];
  /** Сущности, по которым есть что создавать. */
  affected: BackupEntity[];
};

/** Итог записи одной сущности (этап S3.5). */
export type EntityImportResult = {
  entity: BackupEntity;
  created: number;
  skippedExists: number;
  conflicts: string[];
};

/** Сверка одной сущности источника с целью (этап S3.6). */
export type EntityVerification = {
  entity: BackupEntity;
  sourceCount: number;
  targetCount: number;
  sourceChecksum: string;
  targetChecksum: string;
  checksumMatch: boolean;
  missing: string[];
  duplicates: string[];
};

/** Финальная сверка (этап S3.7). */
export type Reconciliation = {
  batchKey: string;
  backupHash: string;
  backupFormatVersion: number;
  organizationId: string;
  dryRun: boolean;
  resumed: boolean;
  counts: Record<BackupEntity, { source: number; target: number; created: number; exists: number; conflicts: number; unimportable: number }>;
  checksums: Record<BackupEntity, { source: string; target: string | null; match: boolean | null }>;
  aggregateChecksum: { source: string; target: string | null; match: boolean | null };
  aggregates: { source: Aggregates; target: Aggregates | null; match: boolean | null };
  profiles: { orgFields: number; userFields: number; unknownKeys: string[] };
  malformed: MalformedRecord[];
  missing: Partial<Record<BackupEntity, string[]>>;
  duplicates: Partial<Record<BackupEntity, string[]>>;
  verdict: "match" | "mismatch" | "dry-run" | "already-imported" | "failed";
  /** Человекочитаемая сводка без содержимого документов и значений реквизитов. */
  summary: string;
};

/** Ошибка конвейера с машиночитаемым кодом (сериализуется в отчёты и CLI). */
export class ImportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`ImportError(${code}): ${message}`);
    this.name = "ImportError";
    this.code = code;
  }
}
