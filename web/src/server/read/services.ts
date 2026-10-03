/**
 * Server-side чтение бизнес-данных из PostgreSQL (этап S4).
 *
 * Сервисы слоя 3 (architecture.md): вызываются только из route handlers,
 * в Prisma напрямую не пишут и доменных правил не содержат — только выборка
 * по скоупу и сборка доменной формы из строк.
 *
 * Контракт чтения:
 * - контекст — только серверный: `scope` строится вызывающим кодом из сессии,
 *   `userId` обязан иметь членство (проверяется здесь же, defense in depth);
 *   `organizationId` из запроса не принимается ни в каком виде;
 * - идентичность записей: наружу отдаётся `legacyId`, если он есть, иначе id
 *   строки PG. Так серверное чтение drop-in совместимо с legacy-ссылками вида
 *   `/p/[id]`. Дубли `legacyId` (схема их допускает) — явная аномалия:
 *   чтение по id при дублях отказывает, а не выбирает молча;
 * - тексты и карты документов/образцов читаются из S6 через `StorageAdapter`,
 *   когда заданы `textKey`/`mapKey`; иначе `text: null` и `textStatus: "missing"` —
 *   выдумывать содержимое запрещено;
 * - `Purchase`, `Fact`, `Profile` возвращаются в точной доменной форме
 *   (см. заметки ниже со ссылками на legacy-поведение).
 */

import type { DocMap } from "@/lib/doc-source";
import { cleanAnswers, FACT_KINDS, type Fact } from "@/lib/evidence-base";
import { EMPTY_PROFILE, type Profile } from "@/lib/profile";
import type { Purchase } from "@/lib/purchase";

import type { DbClient } from "../db/db-client.ts";
import { NotFoundInScopeError } from "../db/errors.ts";
import { findMembership } from "../db/repositories/index.ts";
import { orgRepositories } from "../db/repositories/index.ts";
import type { Membership } from "../db/repositories/index.ts";
import type { OrgScope } from "../db/org-scope.ts";
import { readObjectJson, readObjectText } from "../storage/content.ts";
import type { StorageAdapter } from "../storage/types.ts";

/**
 * Контекст чтения: БД + скоуп из сессии + пользователь из сессии.
 *
 * `storage` необязателен: без S6 читаются только метаданные, а `textKey`/`mapKey`
 * в legacy-строках всё равно отсутствуют. Как только S6 подключён, тот же сервис
 * возвращает текст и карту — второй реализации чтения не появляется.
 */
export type ReadContext = {
  db: DbClient;
  scope: OrgScope;
  userId: string;
  storage?: StorageAdapter;
};

/** Метаданные профиля (`ProfileMeta` из me-store.ts, без импорта клиентского модуля). */
export type ProfileMetaShape = {
  sources: Record<string, string>;
  suggestions: { key: string; value: string; source: string }[];
};

export const EMPTY_PROFILE_META: ProfileMetaShape = { sources: {}, suggestions: [] };

/** Дублирующийся legacyId: схема допускает, чтение обязано отказать явно. */
export class DuplicateLegacyIdError extends Error {
  readonly operation: string;
  readonly legacyId: string;

  constructor(operation: string, legacyId: string) {
    super(`DuplicateLegacyIdError: ${operation} — несколько строк с legacyId ${JSON.stringify(legacyId)}`);
    this.name = "DuplicateLegacyIdError";
    this.operation = operation;
    this.legacyId = legacyId;
  }
}

/** Документ закупки: метаданные + (при наличии S6) текст и карта. */
export type DocumentMeta = {
  id: string;
  name: string;
  scan: boolean;
  sizeBytes: number | null;
  sha256: string | null;
  ocr: boolean;
  readError: string | null;
  mimeType: string | null;
  text: string | null;
  map: DocMap | null;
  /** `available` — текст прочитан из S6; `missing` — ключа нет или объект отсутствует. */
  textStatus: "available" | "missing";
};

/** Образец участника: полная форма `MyDocument`, как её знает браузер. */
export type SampleMeta = {
  id: string;
  name: string | null;
  kinds: string[];
  about: string;
  addedAt: string | null;
  scan: boolean;
  text: string | null;
  map: DocMap | null;
  textStatus: "available" | "missing";
};

const dateToIso = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : typeof value === "string" && value ? value : null;

type Row = Record<string, unknown>;

/** Членство вызывающего: без него чтение не выполняется (defense in depth поверх route). */
async function requireMember(ctx: ReadContext): Promise<Membership> {
  const membership = await findMembership(ctx.db, ctx.scope, ctx.userId);
  if (!membership) {
    throw new NotFoundInScopeError("read.requireMember");
  }
  return membership;
}



/** Наружу — legacyId, если есть, иначе id строки. */
function publicId(row: Row): string {
  return typeof row.legacyId === "string" && row.legacyId ? row.legacyId : (row.id as string);
}

/**
 * Закупки организации. Порядок — по созданию (legacy-порядок вставки);
 * сортировку для показа делает UI, как сегодня (`usePurchases`).
 */
export async function listPurchases(ctx: ReadContext): Promise<Purchase[]> {
  await requireMember(ctx);
  const rows = (await orgRepositories(ctx.db, ctx.scope).purchase.list({
    orderBy: { createdAt: "asc" },
  })) as unknown as Row[];
  return rows.map((row) => ({ ...(row.payload as Record<string, unknown>), id: publicId(row) }) as Purchase);
}

/**
 * Одна закупка. Совпадение ищется сначала по legacyId (совместимость с
 * legacy-ссылками), затем по id строки. Дубль legacyId — отказ, а не выбор.
 */
export async function getPurchase(ctx: ReadContext, id: string): Promise<Purchase | null> {
  await requireMember(ctx);
  const repos = orgRepositories(ctx.db, ctx.scope);
  const byLegacy = (await repos.purchase.list({ where: { legacyId: id } })) as unknown as Row[];
  if (byLegacy.length > 1) {
    throw new DuplicateLegacyIdError("read.getPurchase", id);
  }
  const row = byLegacy[0] ?? ((await repos.purchase.getById(id)) as unknown as Row | null);
  if (!row) {
    return null;
  }
  return { ...((row.payload ?? {}) as Record<string, unknown>), id: publicId(row) } as Purchase;
}

/**
 * Документы закупки. Метаданные плюс (когда есть S6 и ключи) текст и карта.
 * `withContent: false` читает только метаданные — для сверок и списков, где
 * крупные тексты не нужны; по умолчанию содержимое читается.
 */
export async function listDocuments(
  ctx: ReadContext,
  purchaseId: string,
  options: { withContent?: boolean } = {},
): Promise<DocumentMeta[]> {
  await requireMember(ctx);
  const withContent = options.withContent !== false;
  // Закупка разрешается в этом же скоупе: чужой purchaseId даёт null и пустой
  // список, а не чужие документы. Дубль legacyId — явный отказ ниже.
  const internalId = await resolveInternalPurchaseId(ctx, purchaseId);
  if (!internalId) {
    return [];
  }
  const rows = ((await orgRepositories(ctx.db, ctx.scope).document.list()) as unknown as Row[]).filter(
    (row) => row.purchaseId === internalId,
  );
  return Promise.all(
    rows.map(async (row) => {
      const textKey = typeof row.textKey === "string" && row.textKey ? row.textKey : null;
      const mapKey = typeof row.mapKey === "string" && row.mapKey ? row.mapKey : null;
      const text = withContent ? await readObjectText(ctx.storage, textKey) : null;
      const map = withContent ? await readObjectJson<DocMap>(ctx.storage, mapKey) : null;
      return {
        id: publicId(row),
        name: row.fileName as string,
        scan: row.ocr === true,
        sizeBytes: (row.sizeBytes as number | null) ?? null,
        sha256: (row.sha256 as string | null) ?? null,
        ocr: row.ocr === true,
        readError: (row.readError as string | null) ?? null,
        mimeType: (row.mimeType as string | null) ?? null,
        text,
        map,
        textStatus: text !== null ? ("available" as const) : ("missing" as const),
      };
    }),
  );
}

async function resolveInternalPurchaseId(ctx: ReadContext, purchaseId: string): Promise<string | null> {
  const repos = orgRepositories(ctx.db, ctx.scope);
  const byLegacy = (await repos.purchase.list({ where: { legacyId: purchaseId } })) as unknown as Row[];
  if (byLegacy.length > 1) {
    throw new DuplicateLegacyIdError("read.listDocuments", purchaseId);
  }
  const row = byLegacy[0] ?? ((await repos.purchase.getById(purchaseId)) as unknown as Row | null);
  return row ? (row.id as string) : null;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/**
 * Факт в форме legacy-чтения (`readFact` из evidence-store.ts:10-30):
 * неизвестный вид не читается, `origin` по умолчанию `human`, вписанное
 * человеком подтверждено по определению, пустые `answers` опускаются.
 * Повторяет поведение, а не код: storage-модуль сюда не импортируется.
 */
export function shapeFact(row: Row): Fact | null {
  const kind = row.kind;
  if (typeof kind !== "string" || !(kind in FACT_KINDS)) {
    return null;
  }
  const origin = row.origin === "ai" ? "ai" : "human";
  const answers = cleanAnswers(row.answers);
  const createdAt = row.createdAt instanceof Date ? row.createdAt.toISOString() : "";
  const updatedAt = row.updatedAt instanceof Date ? row.updatedAt.toISOString() : createdAt;
  return {
    id: publicId(row),
    kind,
    title: typeof row.title === "string" ? row.title : "",
    fields: asRecord(row.fields),
    measures: Array.isArray(row.measures) ? row.measures : [],
    validity: asRecord(row.validity),
    source: asRecord(row.source),
    origin,
    confirmed: origin === "human" ? true : row.confirmed === true,
    createdAt,
    updatedAt,
    ...(answers.length > 0 ? { answers } : {}),
  } as Fact;
}

/** Факты организации, новые сверху — как `listFacts` сегодня. */
export async function listFacts(ctx: ReadContext): Promise<Fact[]> {
  await requireMember(ctx);
  const rows = (await orgRepositories(ctx.db, ctx.scope).fact.list({
    orderBy: { updatedAt: "desc" },
  })) as unknown as Row[];
  const out: Fact[] = [];
  for (const row of rows) {
    const shaped = shapeFact(row);
    if (shaped) {
      out.push(shaped);
    }
  }
  return out;
}

/**
 * Образцы организации. Полная форма `MyDocument`: видов, описание, имя, отметка
 * добавления, признак скана, текст и карта — из PostgreSQL и S6.
 */
export async function listSamples(ctx: ReadContext, options: { withContent?: boolean } = {}): Promise<SampleMeta[]> {
  await requireMember(ctx);
  const withContent = options.withContent !== false;
  const rows = (await orgRepositories(ctx.db, ctx.scope).sample.list({
    orderBy: { createdAt: "desc" },
  })) as unknown as Row[];
  return Promise.all(
    rows.map(async (row) => {
      const textKey = typeof row.textKey === "string" && row.textKey ? row.textKey : null;
      const mapKey = typeof row.mapKey === "string" && row.mapKey ? row.mapKey : null;
      const text = withContent ? await readObjectText(ctx.storage, textKey) : null;
      const map = withContent ? await readObjectJson<DocMap>(ctx.storage, mapKey) : null;
      // `addedAt` — историческая отметка; если её не было, отдаём `createdAt`,
      // чтобы форма `MyDocument` осталась валидной (сортировка UI).
      const addedAt = dateToIso(row.addedAt) ?? dateToIso(row.createdAt);
      return {
        id: publicId(row),
        name: typeof row.name === "string" && row.name ? row.name : null,
        kinds: Array.isArray(row.kinds) ? (row.kinds as string[]) : [],
        about: typeof row.about === "string" ? row.about : "",
        addedAt,
        scan: row.scan === true,
        text,
        map,
        textStatus: text !== null ? ("available" as const) : ("missing" as const),
      };
    }),
  );
}

/**
 * Сборка доменного `Profile` из двух таблиц — единственная точка сборки
 * (preserved-code.md §4). При пересечении ключей приоритет у организации;
 * подмена пишется в диагностический лог без значений.
 */
export function assembleProfile(orgFields: unknown, userFields: unknown): { profile: Profile; substituted: string[] } {
  const org = asRecord(orgFields);
  const user = asRecord(userFields);
  const known = new Set(Object.keys(EMPTY_PROFILE));
  const profile = { ...EMPTY_PROFILE } as Record<string, string>;
  const substituted: string[] = [];
  for (const [key, value] of Object.entries(org)) {
    if (known.has(key) && typeof value === "string") {
      profile[key] = value;
    }
  }
  for (const [key, value] of Object.entries(user)) {
    if (!known.has(key) || typeof value !== "string") {
      continue;
    }
    const current = profile[key] ?? "";
    if (current !== "" && key in org && current !== value) {
      // Пересечение с непустым корпоративным значением: приоритет у организации.
      substituted.push(key);
      continue;
    }
    profile[key] = value;
  }
  if (substituted.length > 0) {
    console.warn(JSON.stringify({ event: "profile-assemble-substituted", keys: substituted }));
  }
  return { profile: profile as Profile, substituted };
}

/** Нормализация `ProfileMeta` из JSONB: неизвестное/битое отбрасывается, форма сохраняется. */
export function normalizeProfileMeta(raw: unknown): ProfileMetaShape {
  const record = asRecord(raw);
  const sources: Record<string, string> = {};
  for (const [key, value] of Object.entries(asRecord(record.sources))) {
    if (typeof value === "string" && value) {
      sources[key] = value;
    }
  }
  const suggestions: { key: string; value: string; source: string }[] = [];
  if (Array.isArray(record.suggestions)) {
    for (const item of record.suggestions) {
      const s = asRecord(item);
      if (typeof s.key === "string" && typeof s.value === "string" && typeof s.source === "string") {
        suggestions.push({ key: s.key, value: s.value, source: s.source });
      }
    }
  }
  return { sources, suggestions };
}

/** Профиль: корпоративная часть организации + персональная часть пользователя. */
export async function readProfile(ctx: ReadContext): Promise<{
  profile: Profile;
  meta: { version: number; sources: Record<string, string>; suggestions: { key: string; value: string; source: string }[] };
  userId: string;
}> {
  await requireMember(ctx);
  const repos = orgRepositories(ctx.db, ctx.scope);
  const orgRows = (await repos.organizationProfile.list()) as unknown as Row[];
  const userRow = (await ctx.db.userProfile.findFirst({ where: { userId: ctx.userId } })) as Row | null;
  const { profile } = assembleProfile(
    orgRows.length > 0 ? orgRows[0].fields : {},
    userRow ? userRow.fields : {},
  );
  const version = orgRows.length > 0 && typeof orgRows[0].version === "number" ? orgRows[0].version : 1;
  const meta = normalizeProfileMeta(orgRows.length > 0 ? orgRows[0].meta : undefined);
  return { profile, meta: { version, ...meta }, userId: ctx.userId };
}


