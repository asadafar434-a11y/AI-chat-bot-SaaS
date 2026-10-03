/**
 * Import pipeline S3: копия `tender-lawyer-backup` v1 → PostgreSQL.
 *
 * Этапы: S3.1 parse → S3.2 validate → S3.3 normalize → S3.4 plan → S3.5 import →
 * S3.6 verify → S3.7 reconciliation. Этапы явно разделены функциями: план можно
 * показать и проверить до первой записи (`--dry-run` вообще ничего не пишет).
 *
 * Гарантии:
 * - идемпотентность: существующая строка с тем же `legacyId` и тем же содержимым
 *   пропускается; повтор того же файла находит завершённый `LegacyImportBatch`
 *   по `(backupHash, organizationId)` и не пишет ничего;
 * - никакого молчаливого перезаписывания: расхождение содержимого — `conflict`,
 *   запись пропускается;
 * - возобновляемость: незавершённый батч продолжается следующим запуском, а не
 *   начинается заново; ошибка посреди батча фиксирует `failed`, и повтор доводит
 *   работу до конца без дублей;
 * - tenant-изоляция: все чтения и записи идут через скоуп-репозитории S1 и
 *   `organizationId` из скоупа; `userId` обязан иметь членство в организации;
 * - в отчётах нет содержимого документов и значений реквизитов.
 *
 * Транзакции — через внедрённый `TransactionRunner` (как `acceptInvitation` в S2):
 * этап записи выполняется в одной транзакции, поэтому падение посреди батча
 * откатывает именно этот запуск. Модуль не импортирует Prisma.
 */

import { BACKUP_VERSION, parseBackup, type Dump } from "@/lib/backup-format";

import type { TransactionRunner } from "../auth/transaction.ts";
import type { DbClient } from "../db/db-client.ts";
import { withOrgScope, type OrgScope } from "../db/org-scope.ts";
import {
  findImportBatchByKey,
  findMembership,
  finishImportBatch,
  orgRepositories,
  startImportBatch,
} from "../db/repositories/index.ts";
import { recordChecksum, setChecksum, sha256Hex, stableStringify } from "./canonical.ts";
import {
  computeAggregates,
  mapDocument,
  mapFact,
  mapPurchase,
  mapSample,
  splitProfile,
  type UnreadableEntry,
} from "./mapping.ts";
import type {
  Aggregates,
  BackupEntity,
  BackupSection,
  EntityImportResult,
  EntityPlan,
  EntityVerification,
  ImportPlan,
  MalformedRecord,
  NormalizedDocument,
  NormalizedFact,
  NormalizedProfiles,
  NormalizedPurchase,
  NormalizedSample,
  Reconciliation,
  UnimportableRecord,
} from "./types.ts";
import { BACKUP_ENTITIES, ImportError } from "./types.ts";

// ─────────────────────────────────────────────────────────────────────────────
// S3.1 parse
// ─────────────────────────────────────────────────────────────────────────────

export type ParsedBackup = {
  dump: Dump;
  backupHash: string;
  backupFormatVersion: number;
  malformed: MalformedRecord[];
};

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * Отброшенные `parseBackup` элементы — по ссылке: фильтр сохраняет те же объекты,
 * поэтому отсутствующие в разобранном результате и есть отброшенные.
 * Предикаты причин зеркалят проверки `backup-format.ts:38-55`, авторитет — сам
 * `parseBackup`, здесь только подпись причины для отчёта.
 */
function droppedItems(rawList: unknown, kept: readonly unknown[]): { index: number; item: unknown }[] {
  if (!Array.isArray(rawList)) {
    return [];
  }
  const seen = new Set<unknown>(kept);
  const out: { index: number; item: unknown }[] = [];
  rawList.forEach((item, index) => {
    if (!seen.has(item)) {
      out.push({ index, item });
    }
  });
  return out;
}

function idReason(item: unknown): string {
  if (!isObject(item)) {
    return "not-object";
  }
  if (typeof item.id !== "string") {
    return "missing-id";
  }
  return "empty-id";
}

function collectMalformed(raw: Record<string, unknown>, dump: Dump): MalformedRecord[] {
  const out: MalformedRecord[] = [];
  const idSections: BackupSection[] = ["purchases", "samples", "facts"];
  for (const section of idSections) {
    const kept = dump[section] as readonly { id: string }[];
    for (const { index, item } of droppedItems(raw[section], kept)) {
      out.push({ section, index, reason: idReason(item) });
    }
  }
  for (const { index, item } of droppedItems(raw.documents, dump.documents)) {
    if (!Array.isArray(item)) {
      out.push({ section: "documents", index, reason: "not-pair" });
    } else {
      out.push({
        section: "documents",
        index,
        key: typeof item[0] === "string" ? item[0] : undefined,
        reason: typeof item[0] !== "string" ? "bad-key" : "bad-docs",
      });
    }
  }
  for (const { index, item } of droppedItems(raw.settings, dump.settings)) {
    if (!Array.isArray(item)) {
      out.push({ section: "settings", index, reason: "not-pair" });
    } else if (typeof item[0] !== "string") {
      out.push({ section: "settings", index, reason: "bad-key" });
    } else if (item[0] !== "profile" && item[0] !== "profile-meta") {
      out.push({ section: "settings", index, key: item[0], reason: "unknown-setting" });
    } else {
      out.push({ section: "settings", index, key: item[0], reason: "non-object-setting" });
    }
  }
  return out;
}

/**
 * S3.1: сырая строка копии → проверенный `Dump`. Формат, версия и правило
 * «не новее приложения» проверяет существующий `parseBackup` — здесь его вызов,
 * а не новая логика. `backupHash` — sha256 байтов файла (тот же файл — тот же хеш).
 */
export function parseBackupStage(raw: string): ParsedBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ImportError("parse-failed", "файл копии не является JSON");
  }
  const backupHash = sha256Hex(raw);
  const result = parseBackup(parsed);
  if (!result.ok) {
    const reason = result.reason;
    const code = /нет данных/.test(reason)
      ? "empty-backup"
      : /более новая версия/.test(reason)
        ? "newer-format"
        : /другой версией/.test(reason)
          ? "unsupported-version"
          : "not-a-backup";
    throw new ImportError(code, reason);
  }
  const malformed = isObject(parsed) ? collectMalformed(parsed, result.dump) : [];
  return { dump: result.dump, backupHash, backupFormatVersion: BACKUP_VERSION, malformed };
}

// ─────────────────────────────────────────────────────────────────────────────
// S3.2 validate + S3.3 normalize
// ─────────────────────────────────────────────────────────────────────────────

export type NormalizedBackup = {
  purchases: NormalizedPurchase[];
  documents: NormalizedDocument[];
  samples: NormalizedSample[];
  facts: NormalizedFact[];
  /** `null`, если в копии нет настроек профиля вообще. */
  profiles: NormalizedProfiles | null;
  unimportable: UnimportableRecord[];
};

/**
 * S3.2+S3.3: проверка и нормализация существующим `fromStore` (миграции формата
 * `data-format.ts`). Этапы идут вместе, потому что валидация записи — это и есть
 * успешная миграция: отдельная проверка дублировала бы её предикаты.
 */
export function normalizeBackupStage(
  dump: Dump,
  hashText: (text: string) => string = sha256Hex,
): NormalizedBackup {
  const unimportable: UnimportableRecord[] = [];
  const seen = new Map<BackupEntity, Set<string>>();
  const claim = (entity: BackupEntity, legacyId: string): boolean => {
    let set = seen.get(entity);
    if (!set) {
      set = new Set();
      seen.set(entity, set);
    }
    if (set.has(legacyId)) {
      unimportable.push({ entity, legacyId, reason: "duplicate-in-backup" });
      return false;
    }
    set.add(legacyId);
    return true;
  };

  const purchases: NormalizedPurchase[] = [];
  const unreadableByPurchase = new Map<string, UnreadableEntry[]>();
  dump.purchases.forEach((raw, index) => {
    const mapped = mapPurchase(raw);
    if (!mapped.ok) {
      const id = isObject(raw) && typeof raw.id === "string" && raw.id ? raw.id : `#${index}`;
      unimportable.push({ entity: "purchases", legacyId: id, reason: mapped.reason });
      return;
    }
    if (!claim("purchases", mapped.record.legacyId)) {
      return;
    }
    purchases.push(mapped.record);
    const unreadable = mapped.record.payload.unreadable;
    if (Array.isArray(unreadable)) {
      unreadableByPurchase.set(
        mapped.record.legacyId,
        unreadable
          .filter(
            (u): u is { name: unknown; reason: unknown } => isObject(u as Record<string, unknown>),
          )
          .filter((u) => typeof u.name === "string" && typeof u.reason === "string")
          .map((u) => ({ name: u.name as string, reason: u.reason as string })),
      );
    }
  });

  const documents: NormalizedDocument[] = [];
  dump.documents.forEach(([purchaseLegacyId, docs]) => {
    docs.forEach((raw, docIndex) => {
      const legacyId = `${purchaseLegacyId}:${docIndex}`;
      const mapped = mapDocument(raw, purchaseLegacyId, docIndex, unreadableByPurchase.get(purchaseLegacyId) ?? [], hashText);
      if (!mapped.ok) {
        unimportable.push({ entity: "documents", legacyId, reason: mapped.reason });
        return;
      }
      if (!claim("documents", legacyId)) {
        return;
      }
      documents.push(mapped.record);
    });
  });

  const samples: NormalizedSample[] = [];
  dump.samples.forEach((raw, index) => {
    const mapped = mapSample(raw, hashText);
    if (!mapped.ok) {
      const id = isObject(raw) && typeof raw.id === "string" && raw.id ? raw.id : `#${index}`;
      unimportable.push({ entity: "samples", legacyId: id, reason: mapped.reason });
      return;
    }
    if (!claim("samples", mapped.record.legacyId)) {
      return;
    }
    samples.push(mapped.record);
  });

  const facts: NormalizedFact[] = [];
  dump.facts.forEach((raw, index) => {
    const mapped = mapFact(raw);
    if (!mapped.ok) {
      const id = isObject(raw) && typeof raw.id === "string" && raw.id ? raw.id : `#${index}`;
      unimportable.push({ entity: "facts", legacyId: id, reason: mapped.reason });
      return;
    }
    if (!claim("facts", mapped.record.legacyId)) {
      return;
    }
    facts.push(mapped.record);
  });

  let profiles: NormalizedProfiles | null = null;
  let profileRaw: unknown;
  let metaRaw: unknown;
  for (const [key, value] of dump.settings) {
    if (key === "profile") {
      profileRaw = value;
    } else if (key === "profile-meta") {
      metaRaw = value;
    }
  }
  if (profileRaw !== undefined) {
    const mapped = splitProfile(profileRaw, metaRaw);
    if (!mapped.ok) {
      unimportable.push({ entity: "profiles", legacyId: "profile", reason: mapped.reason });
    } else {
      profiles = mapped.record;
    }
  }

  return { purchases, documents, samples, facts, profiles, unimportable };
}

// ─────────────────────────────────────────────────────────────────────────────
// Канонические виды строк для сверки checksum
// ─────────────────────────────────────────────────────────────────────────────

function purchaseView(r: NormalizedPurchase): unknown {
  return { legacyId: r.legacyId, originalFormatVersion: r.originalFormatVersion, status: r.status, payload: r.payload };
}

function documentView(r: NormalizedDocument): unknown {
  return {
    legacyId: r.legacyId,
    purchaseLegacyId: r.purchaseLegacyId,
    fileName: r.fileName,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    sha256: r.sha256,
    pageCount: r.pageCount,
    ocr: r.ocr,
    readError: r.readError,
  };
}

function sampleView(r: NormalizedSample): unknown {
  return { legacyId: r.legacyId, kinds: r.kinds, about: r.about };
}

function factView(r: NormalizedFact): unknown {
  return {
    legacyId: r.legacyId,
    kind: r.kind,
    title: r.title,
    fields: r.fields,
    measures: r.measures,
    validity: r.validity,
    source: r.source,
    origin: r.origin,
    confirmed: r.confirmed,
    answers: r.answers,
  };
}

function profilesView(r: NormalizedProfiles): unknown {
  return { orgFields: r.orgFields, orgVersion: r.orgVersion, userFields: r.userFields, userVersion: r.userVersion };
}

type TargetMaps = {
  purchaseRows: Map<string, { id: string; view: unknown }[]>;
  documentRows: Map<string, { id: string; view: unknown }[]>;
  sampleRows: Map<string, { id: string; view: unknown }[]>;
  factRows: Map<string, { id: string; view: unknown }[]>;
  orgProfile: { fields: unknown; version: unknown } | null;
  orgProfileCount: number;
  userProfile: { fields: unknown; version: unknown } | null;
  purchaseIdToLegacy: Map<string, string>;
};

type DbRow = Record<string, unknown>;

/**
 * Чтение целевого состояния организации: только строки с `legacyId` участвуют
 * в сверке (записи, созданные сервером позже, имеют `legacyId = null` и не
 * принадлежат переносу). `profileUserId` — пользователь, чьи персональные поля
 * переносились: его `UserProfile` сверяется, остальные не трогаются.
 */
export async function readTargetMaps(
  db: DbClient,
  scope: OrgScope,
  profileUserId: string | null,
): Promise<TargetMaps> {
  const repos = orgRepositories(db, scope);
  const purchaseRows = new Map<string, { id: string; view: unknown }[]>();
  const purchaseIdToLegacy = new Map<string, string>();
  for (const row of (await repos.purchase.list()) as DbRow[]) {
    if (typeof row.legacyId !== "string" || !row.legacyId) {
      continue;
    }
    purchaseIdToLegacy.set(row.id as string, row.legacyId);
    const list = purchaseRows.get(row.legacyId) ?? [];
    list.push({
      id: row.id as string,
      view: {
        legacyId: row.legacyId,
        originalFormatVersion: row.originalFormatVersion ?? null,
        status: row.status,
        payload: row.payload,
      },
    });
    purchaseRows.set(row.legacyId, list);
  }

  const group = <T>(rows: T[], keyOf: (r: T) => string | null, viewOf: (r: T) => unknown, idOf: (r: T) => string) => {
    const map = new Map<string, { id: string; view: unknown }[]>();
    for (const row of rows) {
      const key = keyOf(row);
      if (!key) {
        continue;
      }
      const list = map.get(key) ?? [];
      list.push({ id: idOf(row), view: viewOf(row) });
      map.set(key, list);
    }
    return map;
  };

  const documentRows = group<DbRow>(
    (await repos.document.list()) as DbRow[],
    (r) => (typeof r.legacyId === "string" && r.legacyId ? r.legacyId : null),
    (r) => ({
      legacyId: r.legacyId,
      purchaseLegacyId: purchaseIdToLegacy.get(r.purchaseId as string) ?? null,
      fileName: r.fileName,
      mimeType: r.mimeType ?? null,
      sizeBytes: r.sizeBytes,
      sha256: r.sha256,
      pageCount: r.pageCount ?? null,
      ocr: r.ocr ?? false,
      readError: r.readError ?? null,
    }),
    (r) => r.id as string,
  );

  const sampleRows = group<DbRow>(
    (await repos.sample.list()) as DbRow[],
    (r) => (typeof r.legacyId === "string" && r.legacyId ? r.legacyId : null),
    (r) => ({ legacyId: r.legacyId, kinds: r.kinds, about: r.about }),
    (r) => r.id as string,
  );

  const factRows = group<DbRow>(
    (await repos.fact.list()) as DbRow[],
    (r) => (typeof r.legacyId === "string" && r.legacyId ? r.legacyId : null),
    (r) => ({
      legacyId: r.legacyId,
      kind: r.kind,
      title: r.title,
      fields: r.fields,
      measures: r.measures,
      validity: r.validity,
      source: r.source,
      origin: r.origin,
      confirmed: r.confirmed,
      answers: (r.answers as unknown) ?? null,
    }),
    (r) => r.id as string,
  );

  const orgProfileRows = (await repos.organizationProfile.list()) as DbRow[];
  const userProfileRow = profileUserId
    ? ((await db.userProfile.findFirst({ where: { userId: profileUserId } })) as DbRow | null)
    : null;

  return {
    purchaseRows,
    documentRows,
    sampleRows,
    factRows,
    orgProfile: orgProfileRows.length > 0
      ? { fields: orgProfileRows[0].fields, version: orgProfileRows[0].version }
      : null,
    orgProfileCount: orgProfileRows.length,
    userProfile: userProfileRow ? { fields: userProfileRow.fields, version: userProfileRow.version } : null,
    purchaseIdToLegacy,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// S3.4 plan
// ─────────────────────────────────────────────────────────────────────────────

type ExistingView = { checksum: string; rows: { id: string; view: unknown }[] };

function indexExisting(
  targets: TargetMaps,
  entity: BackupEntity,
  normalized: NormalizedBackup,
): { views: Map<string, ExistingView>; sourceViews: Map<string, unknown> } {
  const views = new Map<string, ExistingView>();
  const sourceViews = new Map<string, unknown>();
  const put = (map: Map<string, { id: string; view: unknown }[]>, legacyId: string, sourceView: unknown) => {
    const rows = map.get(legacyId) ?? [];
    views.set(legacyId, { checksum: rows.length > 0 ? recordChecksum(rows[0].view) : "", rows });
    sourceViews.set(legacyId, sourceView);
  };
  if (entity === "purchases") {
    for (const r of normalized.purchases) {
      put(targets.purchaseRows, r.legacyId, purchaseView(r));
    }
  } else if (entity === "documents") {
    for (const r of normalized.documents) {
      put(targets.documentRows, r.legacyId, documentView(r));
    }
  } else if (entity === "samples") {
    for (const r of normalized.samples) {
      put(targets.sampleRows, r.legacyId, sampleView(r));
    }
  } else if (entity === "facts") {
    for (const r of normalized.facts) {
      put(targets.factRows, r.legacyId, factView(r));
    }
  } else if (normalized.profiles && !normalized.profiles.empty) {
    const parts: string[] = [];
    if (targets.orgProfile) {
      parts.push(recordChecksum({ fields: targets.orgProfile.fields, version: targets.orgProfile.version }));
    }
    if (targets.userProfile) {
      parts.push(recordChecksum({ fields: targets.userProfile.fields, version: targets.userProfile.version }));
    }
    const expected = [
      recordChecksum({ fields: normalized.profiles.orgFields, version: normalized.profiles.orgVersion }),
      recordChecksum({ fields: normalized.profiles.userFields, version: normalized.profiles.userVersion }),
    ];
    views.set("profile", { checksum: parts.join("|"), rows: [] });
    sourceViews.set("profile", expected.join("|"));
  }
  return { views, sourceViews };
}

/**
 * S3.4: план до первой записи. Для каждой сущности: сколько записей будет
 * создано, сколько уже существует, сколько конфликтов, сколько нельзя
 * импортировать. Документы, чья закупка ни в копии, ни в цели, — `orphan-documents`:
 * их нельзя привязать, они не импортируются.
 */
export async function planImportStage(
  db: DbClient,
  scope: OrgScope,
  normalized: NormalizedBackup,
  profileUserId: string | null,
  meta: { batchKey: string; backupHash: string; backupFormatVersion: number },
): Promise<{ plan: ImportPlan; orphanDocIds: Set<string> }> {
  const targets = await readTargetMaps(db, scope, profileUserId);
  const orphanDocIds = new Set<string>();
  const entities: EntityPlan[] = [];

  const planEntity = (
    entity: BackupEntity,
    legacyIds: string[],
    unimportable: UnimportableRecord[],
  ): EntityPlan => {
    const { views, sourceViews } = indexExisting(targets, entity, normalized);
    let exists = 0;
    let toCreate = 0;
    let conflicts = 0;
    const conflictLegacyIds: string[] = [];
    for (const legacyId of legacyIds) {
      const found = views.get(legacyId);
      if (!found || found.rows.length === 0) {
        toCreate += 1;
      } else if (found.checksum === recordChecksum(sourceViews.get(legacyId))) {
        exists += 1;
      } else {
        conflicts += 1;
        conflictLegacyIds.push(legacyId);
      }
    }
    return {
      entity,
      source: legacyIds.length,
      exists,
      toCreate,
      conflicts,
      unimportable: unimportable.length,
      conflictLegacyIds,
      unimportableList: unimportable,
    };
  };

  const byEntity = (entity: BackupEntity) => normalized.unimportable.filter((u) => u.entity === entity);

  entities.push(planEntity("purchases", normalized.purchases.map((r) => r.legacyId), byEntity("purchases")));

  const knownPurchases = new Set([
    ...normalized.purchases.map((r) => r.legacyId),
    ...targets.purchaseRows.keys(),
  ]);
  const orphanDocs: UnimportableRecord[] = [];
  const importableDocs = normalized.documents.filter((r) => {
    if (knownPurchases.has(r.purchaseLegacyId)) {
      return true;
    }
    orphanDocIds.add(r.legacyId);
    orphanDocs.push({ entity: "documents", legacyId: r.legacyId, reason: "orphan-documents" });
    return false;
  });
  entities.push(
    planEntity(
      "documents",
      importableDocs.map((r) => r.legacyId),
      [...byEntity("documents"), ...orphanDocs],
    ),
  );

  entities.push(planEntity("samples", normalized.samples.map((r) => r.legacyId), byEntity("samples")));
  entities.push(planEntity("facts", normalized.facts.map((r) => r.legacyId), byEntity("facts")));

  if (normalized.profiles && !normalized.profiles.empty) {
    const { views, sourceViews } = indexExisting(targets, "profiles", normalized);
    const found = views.get("profile");
    const expected = sourceViews.get("profile") as string;
    let exists = 0;
    let toCreate = 0;
    let conflicts = 0;
    const conflictLegacyIds: string[] = [];
    const orgMissing = !targets.orgProfile;
    const userMissing = !targets.userProfile;
    if (!orgMissing && !userMissing && found && found.checksum === expected) {
      exists = 1;
    } else if (!orgMissing && !userMissing) {
      conflicts = 1;
      conflictLegacyIds.push("profile");
    } else {
      toCreate = 1;
    }
    if (targets.orgProfileCount > 1) {
      conflicts = 1;
      conflictLegacyIds.push("profile");
      toCreate = 0;
    }
    entities.push({
      entity: "profiles",
      source: 1,
      exists,
      toCreate,
      conflicts,
      unimportable: byEntity("profiles").length,
      conflictLegacyIds,
      unimportableList: byEntity("profiles"),
    });
  } else {
    entities.push({
      entity: "profiles",
      source: 0,
      exists: 0,
      toCreate: 0,
      conflicts: 0,
      unimportable: byEntity("profiles").length,
      conflictLegacyIds: [],
      unimportableList: byEntity("profiles"),
    });
  }

  return {
    plan: {
      batchKey: meta.batchKey,
      backupHash: meta.backupHash,
      backupFormatVersion: meta.backupFormatVersion,
      organizationId: scope.organizationId,
      entities,
      affected: entities.filter((e) => e.toCreate > 0).map((e) => e.entity),
    },
    orphanDocIds,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// S3.5 import
// ─────────────────────────────────────────────────────────────────────────────

function sameView(a: unknown, b: unknown): boolean {
  return recordChecksum(a) === recordChecksum(b);
}

/**
 * S3.5: запись в одной транзакции вызывающего контекста. Существующие строки
 * перепроверяются внутри транзакции (план мог устареть): совпало — пропуск,
 * разошлось — конфликт без записи. Возобновление после падения опирается на это
 * же свойство: уже записанное пропускается, недостающее создаётся.
 */
export async function importStage(
  txDb: DbClient,
  scope: OrgScope,
  userId: string,
  normalized: NormalizedBackup,
  orphanDocIds: Set<string>,
): Promise<EntityImportResult[]> {
  const repos = orgRepositories(txDb, scope);
  const results: EntityImportResult[] = [];
  const pushResult = (entity: BackupEntity, created: number, skippedExists: number, conflicts: string[]): void => {
    results.push({ entity, created, skippedExists, conflicts });
  };

  const upsert = async (
    sourceView: unknown,
    find: () => Promise<DbRow[]>,
    create: () => Promise<unknown>,
  ): Promise<{ created: boolean; conflict: boolean }> => {
    const rows = await find();
    if (rows.length === 0) {
      await create();
      return { created: true, conflict: false };
    }
    if (rows.length > 1 || !sameView(rows[0], sourceView)) {
      return { created: false, conflict: true };
    }
    return { created: false, conflict: false };
  };

  const findByLegacy = async (delegate: { findMany(args?: unknown): Promise<unknown[]> }, legacyId: string): Promise<DbRow[]> =>
    (await delegate.findMany({ where: { organizationId: scope.organizationId, legacyId } })) as DbRow[];

  // Закупки первыми: документы ссылаются на них через `purchaseId`.
  const purchaseIdByLegacy = new Map<string, string>();
  {
    let created = 0;
    let skippedExists = 0;
    const conflicts: string[] = [];
    for (const r of normalized.purchases) {
      const outcome = await upsert(
        purchaseView(r),
        () => findByLegacy(txDb.purchase, r.legacyId),
        () =>
          repos.purchase.create({
            legacyId: r.legacyId,
            originalFormatVersion: r.originalFormatVersion,
            status: r.status,
            payload: r.payload,
            createdByUserId: null,
          }),
      );
      const row = (await findByLegacy(txDb.purchase, r.legacyId))[0];
      if (row) {
        purchaseIdByLegacy.set(r.legacyId, row.id as string);
      }
      if (outcome.created) {
        created += 1;
      } else if (outcome.conflict) {
        conflicts.push(r.legacyId);
      } else {
        skippedExists += 1;
      }
    }
    pushResult("purchases", created, skippedExists, conflicts);
  }

  {
    let created = 0;
    let skippedExists = 0;
    const conflicts: string[] = [];
    for (const r of normalized.documents) {
      if (orphanDocIds.has(r.legacyId)) {
        continue;
      }
      let purchaseId = purchaseIdByLegacy.get(r.purchaseLegacyId);
      if (!purchaseId) {
        const found = await findByLegacy(txDb.purchase, r.purchaseLegacyId);
        if (found.length === 0) {
          throw new ImportError("orphan-document", `документ ${r.legacyId} остался без закупки ${r.purchaseLegacyId}`);
        }
        purchaseId = found[0].id as string;
        purchaseIdByLegacy.set(r.purchaseLegacyId, purchaseId);
      }
      const outcome = await upsert(
        documentView(r),
        () => findByLegacy(txDb.document, r.legacyId),
        () =>
          repos.document.create({
            legacyId: r.legacyId,
            purchaseId,
            fileName: r.fileName,
            mimeType: r.mimeType,
            sizeBytes: r.sizeBytes,
            sha256: r.sha256,
            storageKey: null,
            textKey: null,
            pageCount: null,
            ocr: r.ocr,
            readError: r.readError,
          }),
      );
      if (outcome.created) {
        created += 1;
      } else if (outcome.conflict) {
        conflicts.push(r.legacyId);
      } else {
        skippedExists += 1;
      }
    }
    pushResult("documents", created, skippedExists, conflicts);
  }

  {
    let created = 0;
    let skippedExists = 0;
    const conflicts: string[] = [];
    for (const r of normalized.facts) {
      const outcome = await upsert(
        factView(r),
        () => findByLegacy(txDb.fact, r.legacyId),
        () =>
          repos.fact.create({
            legacyId: r.legacyId,
            kind: r.kind,
            title: r.title,
            fields: r.fields,
            measures: r.measures,
            validity: r.validity,
            source: r.source,
            origin: r.origin,
            confirmed: r.confirmed,
            answers: r.answers,
          }),
      );
      if (outcome.created) {
        created += 1;
      } else if (outcome.conflict) {
        conflicts.push(r.legacyId);
      } else {
        skippedExists += 1;
      }
    }
    pushResult("facts", created, skippedExists, conflicts);
  }

  {
    let created = 0;
    let skippedExists = 0;
    const conflicts: string[] = [];
    for (const r of normalized.samples) {
      const outcome = await upsert(
        sampleView(r),
        () => findByLegacy(txDb.sample, r.legacyId),
        () =>
          repos.sample.create({
            legacyId: r.legacyId,
            kinds: r.kinds,
            about: r.about,
            textKey: null,
          }),
      );
      if (outcome.created) {
        created += 1;
      } else if (outcome.conflict) {
        conflicts.push(r.legacyId);
      } else {
        skippedExists += 1;
      }
    }
    pushResult("samples", created, skippedExists, conflicts);
  }

  {
    let created = 0;
    let skippedExists = 0;
    const conflicts: string[] = [];
    const profiles = normalized.profiles;
    if (profiles && !profiles.empty) {
      const orgRows = (await repos.organizationProfile.list()) as DbRow[];
      if (orgRows.length === 0) {
        await repos.organizationProfile.create({ fields: profiles.orgFields, version: profiles.orgVersion });
        created += 1;
      } else if (orgRows.length > 1) {
        conflicts.push("profile");
      } else if (
        sameView({ fields: orgRows[0].fields, version: orgRows[0].version }, { fields: profiles.orgFields, version: profiles.orgVersion })
      ) {
        skippedExists += 1;
      } else {
        conflicts.push("profile");
      }
      const userRow = (await txDb.userProfile.findFirst({ where: { userId } })) as DbRow | null;
      if (!userRow) {
        await txDb.userProfile.create({ data: { userId, fields: profiles.userFields, version: profiles.userVersion } });
        created += 1;
      } else if (
        sameView({ fields: userRow.fields, version: userRow.version }, { fields: profiles.userFields, version: profiles.userVersion })
      ) {
        skippedExists += 1;
      } else {
        conflicts.push("profile");
      }
    }
    pushResult("profiles", created, skippedExists, conflicts);
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// S3.6 verify
// ─────────────────────────────────────────────────────────────────────────────

function aggregateTargetViews(maps: TargetMaps): Aggregates {
  const purchases = [...maps.purchaseRows.values()].flat().map((r) => r.view as { payload?: unknown });
  const facts = [...maps.factRows.values()].flat().map((r) => r.view as { confirmed?: unknown; validity?: unknown });
  let tpPriceSum = 0;
  let purchasesWithTp = 0;
  let purchasesWithUnreadable = 0;
  for (const p of purchases) {
    const payload = (p.payload ?? {}) as Record<string, unknown>;
    if (typeof payload.tpPrice === "number" && Number.isFinite(payload.tpPrice)) {
      tpPriceSum += payload.tpPrice;
    }
    if (payload.tp !== null && payload.tp !== undefined) {
      purchasesWithTp += 1;
    }
    if (Array.isArray(payload.unreadable) && payload.unreadable.length > 0) {
      purchasesWithUnreadable += 1;
    }
  }
  let confirmedFacts = 0;
  let factsWithTerm = 0;
  for (const f of facts) {
    if (f.confirmed === true) {
      confirmedFacts += 1;
    }
    const until = (f.validity as Record<string, unknown> | undefined)?.until;
    if (typeof until === "string" && until.trim() !== "") {
      factsWithTerm += 1;
    }
  }
  return { tpPriceSum, purchasesWithTp, confirmedFacts, factsWithTerm, purchasesWithUnreadable };
}

/** S3.6: пересчёт цели из БД и сравнение с источником — счётчики, хеши, missing, дубли. */
export async function verifyStage(
  db: DbClient,
  scope: OrgScope,
  normalized: NormalizedBackup,
  profileUserId: string | null,
): Promise<{ verification: EntityVerification[]; targetAggregates: Aggregates; targetMaps: TargetMaps }> {
  const maps = await readTargetMaps(db, scope, profileUserId);
  const verification: EntityVerification[] = [];

  const verifyEntity = (
    entity: BackupEntity,
    sourceChecksums: string[],
    sourceIds: string[],
    targetMap: Map<string, { id: string; view: unknown }[]>,
  ): void => {
    const targetChecksums: string[] = [];
    const targetIds = new Set<string>();
    const duplicates: string[] = [];
    for (const [legacyId, rows] of targetMap) {
      targetIds.add(legacyId);
      if (rows.length > 1) {
        duplicates.push(legacyId);
      }
      targetChecksums.push(recordChecksum(rows[0].view));
    }
    const missing = sourceIds.filter((id) => !targetIds.has(id));
    const sourceChecksum = setChecksum(sourceChecksums);
    const targetChecksum = setChecksum(targetChecksums);
    verification.push({
      entity,
      sourceCount: sourceIds.length,
      targetCount: [...targetMap.values()].reduce((n, rows) => n + rows.length, 0),
      sourceChecksum,
      targetChecksum,
      checksumMatch: sourceChecksum === targetChecksum,
      missing,
      duplicates,
    });
  };

  verifyEntity(
    "purchases",
    normalized.purchases.map((r) => recordChecksum(purchaseView(r))),
    normalized.purchases.map((r) => r.legacyId),
    maps.purchaseRows,
  );
  verifyEntity(
    "documents",
    normalized.documents.map((r) => recordChecksum(documentView(r))),
    normalized.documents.map((r) => r.legacyId),
    maps.documentRows,
  );
  verifyEntity(
    "samples",
    normalized.samples.map((r) => recordChecksum(sampleView(r))),
    normalized.samples.map((r) => r.legacyId),
    maps.sampleRows,
  );
  verifyEntity(
    "facts",
    normalized.facts.map((r) => recordChecksum(factView(r))),
    normalized.facts.map((r) => r.legacyId),
    maps.factRows,
  );

  if (normalized.profiles && !normalized.profiles.empty) {
    const source = recordChecksum(profilesView(normalized.profiles));
    const target = maps.orgProfile && maps.userProfile
      ? recordChecksum({
        orgFields: maps.orgProfile.fields,
        orgVersion: maps.orgProfile.version,
        userFields: maps.userProfile.fields,
        userVersion: maps.userProfile.version,
      })
      : setChecksum([]);
    const sides = (maps.orgProfile ? 1 : 0) + (maps.userProfile ? 1 : 0);
    verification.push({
      entity: "profiles",
      sourceCount: 1,
      targetCount: sides,
      sourceChecksum: source,
      targetChecksum: target,
      checksumMatch: source === target,
      missing: sides < 2 ? ["profile"] : [],
      duplicates: maps.orgProfileCount > 1 ? ["profile"] : [],
    });
  } else {
    verification.push({
      entity: "profiles",
      sourceCount: 0,
      targetCount: (maps.orgProfile ? 1 : 0) + (maps.userProfile ? 1 : 0),
      sourceChecksum: setChecksum([]),
      targetChecksum: setChecksum([]),
      checksumMatch: (maps.orgProfile ? 1 : 0) + (maps.userProfile ? 1 : 0) === 0,
      missing: [],
      duplicates: maps.orgProfileCount > 1 ? ["profile"] : [],
    });
  }

  return { verification, targetAggregates: aggregateTargetViews(maps), targetMaps: maps };
}

// ─────────────────────────────────────────────────────────────────────────────
// S3.7 reconciliation + оркестрация
// ─────────────────────────────────────────────────────────────────────────────

export type LegacyImportInput = {
  db: DbClient;
  run: TransactionRunner;
  scope: OrgScope;
  /** Пользователь, выполняющий перенос: обязан состоять в организации; ему достаются персональные поля. */
  userId: string;
  /** Сырая строка файла копии — хеш считается по байтам файла. */
  raw: string;
  batchKey?: string;
  dryRun?: boolean;
};

export type LegacyImportRun = {
  batchKey: string;
  backupHash: string;
  resumed: boolean;
  dryRun: boolean;
  plan: ImportPlan;
  result: EntityImportResult[] | null;
  verification: EntityVerification[] | null;
  targetAggregates: Aggregates | null;
  reconciliation: Reconciliation;
};

const BENIGN_MALFORMED = new Set(["unknown-setting"]);

function shortList(ids: readonly string[], limit = 10): string {
  if (ids.length === 0) {
    return "—";
  }
  const shown = ids.slice(0, limit).join(", ");
  return ids.length > limit ? `${shown} … (+${ids.length - limit})` : shown;
}

function buildSummary(args: {
  batchKey: string;
  backupHash: string;
  backupFormatVersion: number;
  organizationId: string;
  dryRun: boolean;
  resumed: boolean;
  plan: ImportPlan;
  result: EntityImportResult[] | null;
  verification: EntityVerification[] | null;
  sourceChecksums: Record<BackupEntity, string>;
  sourceAggregates: Aggregates;
  targetAggregates: Aggregates | null;
  profiles: NormalizedProfiles | null;
  malformed: MalformedRecord[];
  textsCount: number;
  verdict: Reconciliation["verdict"];
}): string {
  const lines = [
    `Импорт tender-lawyer-backup v${args.backupFormatVersion}, batch ${args.batchKey.slice(0, 24)}…, sha ${args.backupHash.slice(0, 12)}…, org ${args.organizationId}`,
  ];
  if (args.dryRun) {
    lines.push("режим dry-run: записей не выполнялось");
  }
  if (args.resumed) {
    lines.push("батч уже завершён ранее: записей не выполнялось");
  }
  for (const e of args.plan.entities) {
    const v = args.verification?.find((x) => x.entity === e.entity);
    const mark = v ? (v.checksumMatch ? "checksum MATCH" : "checksum MISMATCH") : "";
    lines.push(
      `${e.entity}: source=${e.source} target=${v?.targetCount ?? "?"} plan=${e.toCreate} created=${args.result?.find((x) => x.entity === e.entity)?.created ?? 0} exists=${e.exists} conflicts=${e.conflicts} unimportable=${e.unimportable} ${mark}`.trim(),
    );
  }
  const t = args.targetAggregates;
  const a = args.sourceAggregates;
  lines.push(
    `aggregates: tpPrice=${a.tpPriceSum} withTp=${a.purchasesWithTp} confirmed=${a.confirmedFacts} withTerm=${a.factsWithTerm} unreadable=${a.purchasesWithUnreadable}` +
      (t
        ? ` | target tpPrice=${t.tpPriceSum} withTp=${t.purchasesWithTp} confirmed=${t.confirmedFacts} withTerm=${t.factsWithTerm} unreadable=${t.purchasesWithUnreadable}`
        : ""),
  );
  if (args.profiles) {
    lines.push(
      `profiles: orgFields=${args.profiles.filledOrg} userFields=${args.profiles.filledUser} unknown=[${args.profiles.unknownKeys.join(", ")}]`,
    );
  }
  lines.push(`texts: захешировано ${args.textsCount} (sha256 каждого документа и текста — в checksums батча)`);
  lines.push(
    `malformed: ${args.malformed.length === 0 ? "—" : args.malformed.map((m) => `${m.section}#${m.index}:${m.reason}`).join("; ")}`,
  );
  const missing = (args.verification ?? []).flatMap((v) => v.missing);
  const duplicates = (args.verification ?? []).flatMap((v) => v.duplicates);
  const conflicts = args.plan.entities.flatMap((e) => e.conflictLegacyIds);
  lines.push(`missing: ${shortList(missing)}`);
  lines.push(`duplicates: ${shortList(duplicates)}`);
  lines.push(`conflicts: ${shortList(conflicts)}`);
  lines.push(`checksums: ${args.plan.entities.map((e) => `${e.entity}=${args.sourceChecksums[e.entity].slice(0, 12)}…`).join(" ")}`);
  lines.push(`verdict: ${args.verdict.toUpperCase().replace("-", " ")}`);
  return lines.join("\n");
}

/**
 * Полный прогон переноса. Возобновление: завершённый батч с тем же `batchKey`
 * или той же парой `(backupHash, organizationId)` не пишет ничего, а возвращает
 * сохранённый результат со свежей сверкой. `dryRun` не выполняет ни одной записи.
 */
export async function runLegacyImport(input: LegacyImportInput): Promise<LegacyImportRun> {
  const { db, run, scope, userId } = input;
  const dryRun = input.dryRun === true;

  const membership = await findMembership(db, scope, userId);
  if (!membership) {
    throw new ImportError("no-membership", "перенос выполняет только участник организации");
  }

  const parsed = parseBackupStage(input.raw);
  const normalized = normalizeBackupStage(parsed.dump);
  const batchKey = input.batchKey ?? `s3:${scope.organizationId}:${parsed.backupHash.slice(0, 16)}`;

  const textsEntries: Record<string, string> = {};
  for (const d of normalized.documents) {
    textsEntries[`document:${d.legacyId}`] = d.sha256;
  }
  for (const s of normalized.samples) {
    textsEntries[`sample:${s.legacyId}`] = s.textChecksum;
  }

  const sourceAggregates = computeAggregates(normalized.purchases, normalized.facts);
  const { plan, orphanDocIds } = await planImportStage(db, scope, normalized, userId, {
    batchKey,
    backupHash: parsed.backupHash,
    backupFormatVersion: parsed.backupFormatVersion,
  });

  const sourceChecksums = {
    purchases: setChecksum(normalized.purchases.map((r) => recordChecksum(purchaseView(r)))),
    documents: setChecksum(normalized.documents.map((r) => recordChecksum(documentView(r)))),
    samples: setChecksum(normalized.samples.map((r) => recordChecksum(sampleView(r)))),
    facts: setChecksum(normalized.facts.map((r) => recordChecksum(factView(r)))),
    profiles: normalized.profiles && !normalized.profiles.empty
      ? recordChecksum({
        orgFields: normalized.profiles.orgFields,
        orgVersion: normalized.profiles.orgVersion,
        userFields: normalized.profiles.userFields,
        userVersion: normalized.profiles.userVersion,
      })
      : setChecksum([]),
  } as Record<BackupEntity, string>;

  const base = {
    batchKey,
    backupHash: parsed.backupHash,
    backupFormatVersion: parsed.backupFormatVersion,
    organizationId: scope.organizationId,
    dryRun,
    plan,
    sourceChecksums,
    sourceAggregates,
    profiles: normalized.profiles,
    malformed: parsed.malformed,
  };

  const assemble = (
    verification: EntityVerification[] | null,
    targetAggregates: Aggregates | null,
    result: EntityImportResult[] | null,
    resumed: boolean,
    verdict: Reconciliation["verdict"],
  ): Reconciliation => {
    const counts = {} as Reconciliation["counts"];
    for (const e of BACKUP_ENTITIES) {
      const p = plan.entities.find((x) => x.entity === e);
      const v = verification?.find((x) => x.entity === e);
      counts[e] = {
        source: p?.source ?? 0,
        target: v?.targetCount ?? 0,
        created: result?.find((x) => x.entity === e)?.created ?? 0,
        exists: p?.exists ?? 0,
        conflicts: p?.conflicts ?? 0,
        unimportable: p?.unimportable ?? 0,
      };
    }
    const checksums = {} as Reconciliation["checksums"];
    for (const e of BACKUP_ENTITIES) {
      const v = verification?.find((x) => x.entity === e);
      checksums[e] = { source: sourceChecksums[e], target: v?.targetChecksum ?? null, match: v ? v.checksumMatch : null };
    }
    const sourceAggChecksum = sha256Hex(stableStringify(sourceAggregates));
    const targetAggChecksum = targetAggregates ? sha256Hex(stableStringify(targetAggregates)) : null;
    const missing = {} as Partial<Record<BackupEntity, string[]>>;
    const duplicates = {} as Partial<Record<BackupEntity, string[]>>;
    for (const v of verification ?? []) {
      if (v.missing.length > 0) {
        missing[v.entity] = v.missing;
      }
      if (v.duplicates.length > 0) {
        duplicates[v.entity] = v.duplicates;
      }
    }
    const summary = buildSummary({
      ...base,
      verification,
      targetAggregates,
      result,
      resumed,
      textsCount: Object.keys(textsEntries).length,
      verdict,
    });
    return {
      ...base,
      resumed,
      counts,
      checksums,
      aggregateChecksum: { source: sourceAggChecksum, target: targetAggChecksum, match: targetAggChecksum ? sourceAggChecksum === targetAggChecksum : null },
      aggregates: { source: sourceAggregates, target: targetAggregates, match: targetAggregates ? sourceAggChecksum === targetAggChecksum : null },
      profiles: {
        orgFields: normalized.profiles?.filledOrg ?? 0,
        userFields: normalized.profiles?.filledUser ?? 0,
        unknownKeys: normalized.profiles?.unknownKeys ?? [],
      },
      missing,
      duplicates,
      verdict,
      summary,
    };
  };

  // Завершённый батч — повтор того же файла: ничего не пишем.
  const prior =
    (await findImportBatchByKey(db, scope, batchKey)) ??
    (await db.legacyImportBatch.findFirst({
      where: withOrgScope({ backupHash: parsed.backupHash }, scope, "legacyImportBatch.findByHash"),
    }));
  if (prior && (prior as { status?: string }).status === "completed") {
    const { verification, targetAggregates } = await verifyStage(db, scope, normalized, userId);
    const reconciliation = assemble(verification, targetAggregates, null, true, "already-imported");
    return {
      batchKey,
      backupHash: parsed.backupHash,
      resumed: true,
      dryRun,
      plan,
      result: null,
      verification,
      targetAggregates,
      reconciliation,
    };
  }

  if (dryRun) {
    const { verification, targetAggregates } = await verifyStage(db, scope, normalized, userId);
    const reconciliation = assemble(verification, targetAggregates, null, false, "dry-run");
    return {
      batchKey,
      backupHash: parsed.backupHash,
      resumed: false,
      dryRun: true,
      plan,
      result: null,
      verification,
      targetAggregates,
      reconciliation,
    };
  }

  let batchId: string;
  if (prior) {
    batchId = (prior as { id: string }).id;
  } else {
    try {
      const created = await startImportBatch(db, scope, {
        batchKey,
        backupHash: parsed.backupHash,
        backupFormatVersion: parsed.backupFormatVersion,
      });
      batchId = (created as { id: string }).id;
    } catch {
      // Гонка параллельных запусков: кто-то уже создал батч — продолжаем его.
      const raced = (await findImportBatchByKey(db, scope, batchKey)) as { id: string } | null;
      if (!raced) {
        throw new ImportError("batch-start-failed", "не удалось создать пакет импорта");
      }
      batchId = raced.id;
    }
  }

  let result: EntityImportResult[];
  try {
    result = await run((txDb) => importStage(txDb, scope, userId, normalized, orphanDocIds));
  } catch (error) {
    try {
      await finishImportBatch(db, scope, batchId, {
        status: "failed",
        counts: plan.entities.map((e) => ({ entity: e.entity, toCreate: e.toCreate })),
        checksums: { backup: parsed.backupHash },
      });
    } catch {
      // Состояние батча уже зафиксировано как незавершённое чтением по ключу;
      // маскировать исходную ошибку ошибкой отчёта нельзя.
    }
    throw error instanceof ImportError
      ? error
      : new ImportError("import-failed", `импорт прерван: ${error instanceof Error ? error.message : String(error)}`);
  }

  const countsJson: Record<string, unknown> = {};
  for (const e of BACKUP_ENTITIES) {
    const p = plan.entities.find((x) => x.entity === e);
    const r = result.find((x) => x.entity === e);
    countsJson[e] = {
      source: p?.source ?? 0,
      created: r?.created ?? 0,
      exists: p?.exists ?? 0,
      conflicts: p?.conflicts ?? 0,
      unimportable: p?.unimportable ?? 0,
    };
  }
  const textsMap: Record<string, string> = {};
  for (const d of normalized.documents) {
    textsMap[`document:${d.legacyId}`] = d.sha256;
  }
  const sampleTexts = new Map<string, string>();
  for (const s of normalized.samples) {
    sampleTexts.set(`sample:${s.legacyId}`, s.textChecksum);
  }
  for (const [k, v] of sampleTexts) {
    textsMap[k] = v;
  }
  await finishImportBatch(db, scope, batchId, {
    status: "completed",
    counts: countsJson,
    checksums: {
      backup: parsed.backupHash,
      entities: sourceChecksums,
      aggregates: sha256Hex(stableStringify(sourceAggregates)),
      texts: { count: Object.keys(textsMap).length, checksum: setChecksum(Object.entries(textsMap).map(([k, v]) => `${k}:${v}`)), entries: textsMap },
    },
    backupFormatVersion: parsed.backupFormatVersion,
  });

  const { verification, targetAggregates } = await verifyStage(db, scope, normalized, userId);
  const hardMismatch =
    verification.some((v) => !v.checksumMatch || v.missing.length > 0 || v.duplicates.length > 0) ||
    plan.entities.some((e) => e.conflicts > 0 || e.unimportable > 0) ||
    parsed.malformed.some((m) => !BENIGN_MALFORMED.has(m.reason)) ||
    sha256Hex(stableStringify(sourceAggregates)) !== sha256Hex(stableStringify(targetAggregates));
  const reconciliation = assemble(verification, targetAggregates, result, Boolean(prior), hardMismatch ? "mismatch" : "match");
  return {
    batchKey,
    backupHash: parsed.backupHash,
    resumed: Boolean(prior),
    dryRun: false,
    plan,
    result,
    verification,
    targetAggregates,
    reconciliation,
  };
}


