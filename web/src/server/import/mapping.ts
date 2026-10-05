/**
 * Явное отображение IndexedDB → PostgreSQL (задача S3.F).
 *
 * Источник — записи копии `tender-lawyer-backup` v1 в том виде, в каком их отдаёт
 * `parseBackup`. Нормализация — только существующим кодом (`fromStore` из
 * `data-format.ts`); здесь нет новых миграций формата и новой доменной логики.
 *
 * Таблица отображения:
 *
 * | IndexedDB | PostgreSQL | legacyId |
 * |---|---|---|
 * | `purchases[]` | `Purchase.payload` (тело целиком, без `id`/`v`) + `status` + `originalFormatVersion` | исходный `id` |
 * | `documents` (`[purchaseId, docs[]]`) | `Document`: только метаданные (`fileName`, `mimeType`, `sizeBytes`, `sha256`, `ocr`, `readError`, `purchaseId`); `storageKey`/`textKey` — `null` до S6 | `"{purchaseId}:{index}"` |
 * | `samples[]` (`MyDocument`) | `Sample`: `kinds` (с правилом `readMyDocument`: неизвестный вид → `"other"`), `about`; `textKey` — `null` до S6 | исходный `id` |
 * | `facts[]` | `Fact`: поля один к одному | исходный `id` |
 * | `settings["profile"]` | `OrganizationProfile.fields` (15 ключей) + `UserProfile.fields` (5 ключей) | ключ `"profile"` |
 * | `settings["profile-meta"]` | `OrganizationProfile.version` + `meta` (`sources`/`suggestions`), S11-R0 | — |
 *
 * S11-R0: содержимое больше не теряется. Текст и карта документов/образцов
 * возвращаются в `NormalizedDocument`/`NormalizedSample` и — при переданном
 * `StorageAdapter` — кладутся в S6 (`textKey`/`mapKey`); `Sample.name`/`addedAt`/
 * `scan` и `ProfileMeta.sources`/`suggestions` пишутся в колонки. Без хранилища
 * переносится только метаданные (текст/карта остаются в IndexedDB), а не
 * теряются молча. Ключи профиля вне `PROFILE_KEYS` по-прежнему в `unknownKeys`.
 *
 * Правило отсутствующих/неверных значений: отсутствующее необязательное поле —
 * default домена; присутствующее, но неверного типа — запись в `unimportable`,
 * молчаливое «исправление» запрещено.
 */

import { fromStore } from "@/lib/data-format";
import type { DocMap, DocSpan } from "@/lib/doc-source";
import { cleanAnswers } from "@/lib/evidence-base";
import { DOC_KINDS } from "@/lib/my-docs";
import { EMPTY_PROFILE, PROFILE_KEYS } from "@/lib/profile";

import type {
  Aggregates,
  NormalizedDocument,
  NormalizedFact,
  NormalizedProfiles,
  NormalizedPurchase,
  NormalizedSample,
} from "./types.ts";

/** 15 корпоративных ключей → `OrganizationProfile.fields` (data-model.md §4.1). */
export const ORG_PROFILE_KEYS = [
  "fullName",
  "shortName",
  "inn",
  "kpp",
  "ogrn",
  "okved",
  "smeCategory",
  "taxSystem",
  "vatNote",
  "legalAddress",
  "postalAddress",
  "account",
  "bankName",
  "bik",
  "corrAccount",
] as const;

/** 5 персональных ключей → `UserProfile.fields` (data-model.md §4.1). */
export const PERSONAL_PROFILE_KEYS = ["head", "signer", "contactPerson", "phone", "email"] as const;

type Row = Record<string, unknown>;

const isObject = (x: unknown): x is Row => typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * Номер формата записи (`v`). Правило — из `data-format.ts`: записи без номера —
 * первый формат. Значение уходит в `originalFormatVersion`/`version` для трассировки.
 */
export function versionOfRaw(raw: unknown): number {
  const v = (raw as Row | null)?.v;
  return typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : 1;
}

export type Mapped<T> = { ok: true; record: T } | { ok: false; reason: string };

const nonEmptyString = (x: unknown): x is string => typeof x === "string" && x.length > 0;

/** Закупка целиком уходит в `payload` без изменения формы (D2): убираются только `id` и `v`. */
export function mapPurchase(raw: unknown): Mapped<NormalizedPurchase> {
  if (!isObject(raw) || !nonEmptyString(raw.id)) {
    return { ok: false, reason: "missing-id" };
  }
  let migrated: Row;
  try {
    migrated = fromStore<Row>("purchase", raw);
  } catch {
    return { ok: false, reason: "newer-format" };
  }
  if (!isObject(migrated)) {
    return { ok: false, reason: "not-object" };
  }
  const { id: _id, v: _v, ...payload } = migrated;
  return {
    ok: true,
    record: {
      legacyId: raw.id,
      originalFormatVersion: versionOfRaw(raw),
      status: migrated.submitted === true ? "submitted" : "draft",
      payload: payload as Record<string, unknown>,
    },
  };
}

/** MIME по расширению имени (набор расширений — из `ACCEPTED_FILES` в `read-documents.ts`); неизвестно — `null`. */
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  rtf: "application/rtf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroenabled.12",
  zip: "application/zip",
  txt: "text/plain",
  md: "text/markdown",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

export function mimeByFileName(name: string): string | null {
  const dot = name.toLowerCase().lastIndexOf(".");
  if (dot === -1) {
    return null;
  }
  return MIME_BY_EXTENSION[name.toLowerCase().slice(dot + 1)] ?? null;
}

export type UnreadableEntry = { name: string; reason: string };

/**
 * Документ закупки → только метаданные. Текст не сохраняется: `sizeBytes` и `sha256`
 * считаются по нему, а сам текст покрывается контрольной суммой батча.
 * `readError` подтягивается из `purchase.unreadable` по совпадению имени файла.
 */
export function mapDocument(
  raw: unknown,
  purchaseLegacyId: string,
  index: number,
  unreadable: UnreadableEntry[],
  hashText: (text: string) => string,
): Mapped<NormalizedDocument> {
  if (!isObject(raw)) {
    return { ok: false, reason: "not-object" };
  }
  try {
    fromStore<Row>("document", raw);
  } catch {
    return { ok: false, reason: "newer-format" };
  }
  if (!nonEmptyString(raw.name)) {
    return { ok: false, reason: "missing-name" };
  }
  if (raw.text !== undefined && typeof raw.text !== "string") {
    return { ok: false, reason: "bad-text" };
  }
  if (raw.map !== undefined && normalizeDocMap(raw.map) === null) {
    return { ok: false, reason: "bad-map" };
  }
  const text = typeof raw.text === "string" ? raw.text : "";
  const reason = unreadable.find((u) => u.name === raw.name)?.reason;
  return {
    ok: true,
    record: {
      legacyId: `${purchaseLegacyId}:${index}`,
      purchaseLegacyId,
      fileName: raw.name,
      mimeType: mimeByFileName(raw.name),
      sizeBytes: Buffer.byteLength(text, "utf8"),
      sha256: hashText(text),
      pageCount: null,
      ocr: raw.scan === true,
      readError: typeof reason === "string" ? reason : null,
      text,
      map: normalizeDocMap(raw.map),
    },
  };
}

/**
 * Карта документа из IndexedDB: либо `DocMap`, либо `null`. Битый объект не
 * «исправляется» — он отвергается (`bad-map`), как и остальные неверные значения.
 * Структурная проверка повторяет `DocSpan` (doc-source.ts): диапазоны и поля-метки.
 */
export function normalizeDocMap(value: unknown): DocMap | null {
  if (!isObject(value) || !Array.isArray(value.spans)) {
    return null;
  }
  const spans: DocSpan[] = [];
  for (const item of value.spans) {
    if (!isObject(item) || typeof item.from !== "number" || typeof item.to !== "number") {
      return null;
    }
    spans.push(item as unknown as DocSpan);
  }
  return value.pagesApprox === true ? { spans, pagesApprox: true } : { spans };
}

/**
 * Образец → `Sample`. Нормализация видов — правилом `readMyDocument`
 * (`me-store.ts:76`): неизвестный вид становится `"other"`, файл не пропадает.
 */
export function mapSample(raw: unknown, hashText: (text: string) => string): Mapped<NormalizedSample> {
  if (!isObject(raw) || !nonEmptyString(raw.id)) {
    return { ok: false, reason: "missing-id" };
  }
  let migrated: Row;
  try {
    migrated = fromStore<Row>("myDocument", raw);
  } catch {
    return { ok: false, reason: "newer-format" };
  }
  if (!isObject(migrated)) {
    return { ok: false, reason: "not-object" };
  }
  const kinds = (Array.isArray(migrated.kinds) ? migrated.kinds : ["tp"])
    .filter((k): k is string => typeof k === "string")
    .map((k) => (k in DOC_KINDS ? k : "other"));
  const unique = [...new Set(kinds.length > 0 ? kinds : ["tp"])];
  if (raw.text !== undefined && typeof raw.text !== "string") {
    return { ok: false, reason: "bad-text" };
  }
  if (migrated.addedAt !== undefined && migrated.addedAt !== null && typeof migrated.addedAt !== "string") {
    return { ok: false, reason: "bad-added-at" };
  }
  if (migrated.scan !== undefined && typeof migrated.scan !== "boolean") {
    return { ok: false, reason: "bad-scan" };
  }
  if (migrated.map !== undefined && normalizeDocMap(migrated.map) === null) {
    return { ok: false, reason: "bad-map" };
  }
  const text = typeof raw.text === "string" ? raw.text : "";
  const addedAt = typeof migrated.addedAt === "string" && migrated.addedAt ? migrated.addedAt : null;
  return {
    ok: true,
    record: {
      legacyId: raw.id,
      name: typeof migrated.name === "string" && migrated.name ? migrated.name : null,
      kinds: unique,
      about: typeof migrated.about === "string" ? migrated.about : "",
      addedAt,
      scan: migrated.scan === true,
      text,
      map: normalizeDocMap(migrated.map),
      textChecksum: hashText(text),
    },
  };
}

const isPlainObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** Факт → колонки `Fact` один к одному; неверные типы — в `unimportable`, а не «исправление». */
export function mapFact(raw: unknown): Mapped<NormalizedFact> {
  if (!isObject(raw) || !nonEmptyString(raw.id)) {
    return { ok: false, reason: "missing-id" };
  }
  let migrated: Row;
  try {
    migrated = fromStore<Row>("fact", raw);
  } catch {
    return { ok: false, reason: "newer-format" };
  }
  if (!isObject(migrated)) {
    return { ok: false, reason: "not-object" };
  }
  if (!nonEmptyString(migrated.kind)) {
    return { ok: false, reason: "missing-kind" };
  }
  if (migrated.kind.length > 60) {
    return { ok: false, reason: "kind-too-long" };
  }
  if (migrated.title !== undefined && typeof migrated.title !== "string") {
    return { ok: false, reason: "bad-title" };
  }
  if (typeof migrated.title === "string" && migrated.title.length > 500) {
    return { ok: false, reason: "title-too-long" };
  }
  if (migrated.fields !== undefined && !isPlainObject(migrated.fields)) {
    return { ok: false, reason: "bad-fields" };
  }
  if (migrated.measures !== undefined && !Array.isArray(migrated.measures)) {
    return { ok: false, reason: "bad-measures" };
  }
  if (migrated.validity !== undefined && !isPlainObject(migrated.validity)) {
    return { ok: false, reason: "bad-validity" };
  }
  if (migrated.source !== undefined && !isPlainObject(migrated.source)) {
    return { ok: false, reason: "bad-source" };
  }
  if (migrated.origin !== undefined && migrated.origin !== "ai" && migrated.origin !== "human") {
    return { ok: false, reason: "bad-origin" };
  }
  if (migrated.confirmed !== undefined && typeof migrated.confirmed !== "boolean") {
    return { ok: false, reason: "bad-confirmed" };
  }
  // Лимиты длины — ограничения схемы PostgreSQL, а не бизнес-правила: переполнение
  // роняло бы транзакцию ошибкой драйвера вместо понятной записи в `unimportable`.
  const stringFields: Record<string, string> = {};
  if (isPlainObject(migrated.fields)) {
    for (const [k, v] of Object.entries(migrated.fields)) {
      if (typeof v === "string") {
        stringFields[k] = v;
      }
    }
  }
  return {
    ok: true,
    record: {
      legacyId: raw.id,
      kind: migrated.kind,
      title: typeof migrated.title === "string" ? migrated.title : "",
      fields: stringFields,
      measures: Array.isArray(migrated.measures) ? migrated.measures : [],
      validity: isPlainObject(migrated.validity) ? migrated.validity : {},
      source: isPlainObject(migrated.source) ? migrated.source : {},
      origin: migrated.origin === "ai" ? "ai" : "human",
      confirmed: migrated.confirmed === true,
      answers: migrated.answers === undefined ? null : cleanAnswers(migrated.answers),
    },
  };
}

/**
 * Разделение профиля (preserved-code.md §4): один объект из 20 полей делится на
 * корпоративные 15 и персональные 5 той же функцией сборки наоборот. Неизвестные
 * ключи и значения неверного типа никуда не попадают и перечисляются в отчёте.
 * `profile-meta` переносится только как `version`: `sources`/`suggestions` —
 * пересчитываемый кеш подсказок, а не данные.
 */
export function splitProfile(profileRaw: unknown, metaRaw: unknown): Mapped<NormalizedProfiles> {
  if (!isObject(profileRaw)) {
    return { ok: false, reason: "not-object" };
  }
  let migrated: Row;
  try {
    migrated = fromStore<Row>("profile", profileRaw);
  } catch {
    return { ok: false, reason: "newer-format" };
  }
  if (!isObject(migrated)) {
    return { ok: false, reason: "not-object" };
  }
  if (metaRaw !== undefined && metaRaw !== null && !isObject(metaRaw)) {
    return { ok: false, reason: "bad-meta" };
  }
  try {
    if (isObject(metaRaw)) {
      fromStore<Row>("profileMeta", metaRaw);
    }
  } catch {
    return { ok: false, reason: "newer-format" };
  }
  const merged: Row = { ...EMPTY_PROFILE, ...migrated };
  const orgFields: Record<string, string> = {};
  const userFields: Record<string, string> = {};
  const unknownKeys: string[] = [];
  const invalidKeys: string[] = [];
  for (const key of Object.keys(merged)) {
    const value = merged[key];
    if (!(PROFILE_KEYS as readonly string[]).includes(key)) {
      unknownKeys.push(key);
      continue;
    }
    if (typeof value !== "string") {
      invalidKeys.push(key);
      continue;
    }
    if ((ORG_PROFILE_KEYS as readonly string[]).includes(key)) {
      orgFields[key] = value;
    } else {
      userFields[key] = value;
    }
  }
  const filled = (fields: Record<string, string>) =>
    Object.values(fields).filter((v) => v.trim() !== "").length;
  const filledOrg = filled(orgFields);
  const filledUser = filled(userFields);
  return {
    ok: true,
    record: {
      orgFields,
      orgVersion: versionOfRaw(metaRaw ?? profileRaw),
      userFields,
      userVersion: versionOfRaw(metaRaw ?? profileRaw),
      meta: normalizeProfileMeta(metaRaw),
      filledOrg,
      filledUser,
      unknownKeys: [...unknownKeys, ...invalidKeys].sort(),
      empty: filledOrg + filledUser === 0,
    },
  };
}

/**
 * `ProfileMeta` из IndexedDB: `sources`/`suggestions` — часть данных профиля,
 * до S11-R0 не переносилась. Битые элементы отбрасываются по одному, форма
 * сохраняется; значения полей не логируются и в отчёт не попадают.
 */
export function normalizeProfileMeta(value: unknown): {
  sources: Record<string, string>;
  suggestions: { key: string; value: string; source: string }[];
} {
  const record = isObject(value) ? value : {};
  const sources: Record<string, string> = {};
  const rawSources = isObject(record.sources) ? record.sources : {};
  for (const [key, source] of Object.entries(rawSources)) {
    if (typeof source === "string" && source) {
      sources[key] = source;
    }
  }
  const suggestions: { key: string; value: string; source: string }[] = [];
  if (Array.isArray(record.suggestions)) {
    for (const item of record.suggestions) {
      if (!isObject(item)) {
        continue;
      }
      if (typeof item.key === "string" && typeof item.value === "string" && typeof item.source === "string") {
        suggestions.push({ key: item.key, value: item.value, source: item.source });
      }
    }
  }
  return { sources, suggestions };
}

/** Агрегаты сверки — те же пять чисел из сводки контракта (migration-and-rollback.md §7). */
export function computeAggregates(purchases: NormalizedPurchase[], facts: NormalizedFact[]): Aggregates {
  let tpPriceSum = 0;
  let purchasesWithTp = 0;
  let purchasesWithUnreadable = 0;
  for (const p of purchases) {
    const price = p.payload.tpPrice;
    if (typeof price === "number" && Number.isFinite(price)) {
      tpPriceSum += price;
    }
    if (p.payload.tp !== null && p.payload.tp !== undefined) {
      purchasesWithTp += 1;
    }
    if (Array.isArray(p.payload.unreadable) && p.payload.unreadable.length > 0) {
      purchasesWithUnreadable += 1;
    }
  }
  let confirmedFacts = 0;
  let factsWithTerm = 0;
  for (const f of facts) {
    if (f.confirmed) {
      confirmedFacts += 1;
    }
    const until = (f.validity as Record<string, unknown>).until;
    if (typeof until === "string" && until.trim() !== "") {
      factsWithTerm += 1;
    }
  }
  return { tpPriceSum, purchasesWithTp, confirmedFacts, factsWithTerm, purchasesWithUnreadable };
}
