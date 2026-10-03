/**
 * Server-side запись бизнес-данных в PostgreSQL (этап S5).
 *
 * Сервисы слоя 3 (architecture.md): вызываются только из route handlers,
 * tenant isolation проверяется внутри каждого сервиса, а не только в route.
 *
 * Контракт записи (parity с IndexedDB, `*_store.ts` + `backup.ts`):
 * - POST коллекции = только создание; существующий `legacyId` — 409, дублей нет;
 * - PUT по id = upsert, как legacy `put`: создать при отсутствии, заменить при
 *   наличии; ответ содержит `created`, чтобы стабилизация видела разницу;
 * - DELETE отсутствующего — 404, состояние не меняется;
 * - identity: id клиента становится `legacyId` (ключ идемпотентности ВНУТРИ
 *   скоупа вызывающего, а не доказательство владения); id строки генерирует БД;
 * - сервер определяет сам: `organizationId` (скоуп), `createdByUserId` (сессия,
 *   на создании), `storageKey`/`textKey` (`null` до S6); версии формата —
 *   текущие на создании (`originalFormatVersion`, версии профилей),
 *   сохраняются при обновлении;
 * - от клиента не принимаются: `organizationId`, `userId`, `createdByUserId`,
 *   `storageKey`, `textKey`, внутренний id — присутствие отклоняется, а не
 *   отбрасывается молча (как `rejectOrgOverride` в S1);
 * - документы пишутся только в составе операций закупки (как в legacy:
 *   `savePurchaseWithDocuments` заменяет массив целиком); отдельных
 *   document-endpoints нет, потому что их нет и в браузере;
 * - тексты документов/образцов не persist-ятся (нет колонок до S6):
 *   метаданные пишутся, тексты покрываются сверкой, а не базой;
 * - штампы объекта из тела сохраняются как есть (parity с `put`); сервер
 *   добавляет штампы только при их отсутствии;
 * - все операции выполняются внутри `run()` — мультистрочные мутации атомарны.
 */

import { formatOf } from "@/lib/data-format";
import type { DocMap } from "@/lib/doc-source";

import type { TransactionRunner } from "../auth/transaction.ts";
import { auditEvent } from "../audit/service.ts";
import { sha256Hex } from "../import/canonical.ts";
import type { DbClient } from "../db/db-client.ts";
import { InvalidArgumentError, NotFoundInScopeError } from "../db/errors.ts";
import type { OrgScope } from "../db/org-scope.ts";
import { findMembership, orgRepositories } from "../db/repositories/index.ts";
import type { Membership } from "../db/repositories/index.ts";
import {
  mapDocument,
  mapFact,
  mapPurchase,
  mapSample,
  splitProfile,
  type UnreadableEntry,
} from "../import/mapping.ts";
import { DuplicateLegacyIdError } from "../read/services.ts";
import { putObjectJson, putObjectText } from "../storage/content.ts";
import { documentObjectKey, sampleObjectKey } from "../storage/keys.ts";
import type { StorageAdapter } from "../storage/types.ts";

/**
 * Контекст записи: клиент, граница транзакции, скоуп и пользователь — только из сессии.
 *
 * `storage` необязателен: без S6 сохраняются только метаданные, а `textKey`/`mapKey`
 * остаются пустыми. С подключённым S6 те же сервисы кладут текст и карту в хранилище
 * в одной транзакции с метаданными (S11-R0), не создавая второй storage.
 */
export type WriteContext = {
  db: DbClient;
  run: TransactionRunner;
  scope: OrgScope;
  userId: string;
  storage?: StorageAdapter;
};

type Row = Record<string, unknown>;

/** Поля, которые клиент задавать не вправе: отклоняются до валидации домена. */
const FORBIDDEN_BODY_KEYS = ["organizationId", "userId", "createdByUserId", "storageKey", "textKey"] as const;

function rejectServerFields(value: unknown, operation: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidArgumentError(`${operation} — тело обязано быть объектом`);
  }
  for (const key of FORBIDDEN_BODY_KEYS) {
    if (Object.hasOwn(value, key)) {
      throw new InvalidArgumentError(`${operation} — поле ${key} определяет сервер`);
    }
  }
}

/**
 * Запись с таким `legacyId` уже есть: повторный create не создаёт дубль.
 * Отдельный тип (а не `InvalidArgumentError`), чтобы маршрут отвечал 409.
 */
export class AlreadyExistsError extends Error {
  readonly operation: string;
  readonly legacyId: string;

  constructor(operation: string, legacyId: string) {
    super(`AlreadyExistsError: ${operation} — запись ${JSON.stringify(legacyId)} уже существует`);
    this.name = "AlreadyExistsError";
    this.operation = operation;
    this.legacyId = legacyId;
  }
}

/** Членство вызывающего: без него запись не выполняется. */
async function requireMember(db: DbClient, scope: OrgScope, userId: string): Promise<Membership> {
  const membership = await findMembership(db, scope, userId);
  if (!membership) {
    throw new NotFoundInScopeError("write.requireMember");
  }
  return membership;
}

/**
 * Удаляет объекты S6, привязанные к строке (исходник, текст, карта), best-effort.
 * Нужно перед удалением/заменой строк: иначе объекты становятся сиротами и
 * ломают сверку S8 и валидацию backup S9. Вызывается только там, где строка
 * действительно уходит.
 */
async function deleteRowObjects(ctx: WriteContext, row: Row): Promise<void> {
  if (!ctx.storage) {
    return;
  }
  for (const key of [row.storageKey, row.textKey, row.mapKey]) {
    if (typeof key === "string" && key) {
      await ctx.storage.deleteObject(key);
    }
  }
}

function unreadableOf(payload: Record<string, unknown>): UnreadableEntry[] {
  const list = payload.unreadable;
  if (!Array.isArray(list)) {
    return [];
  }
  return list
    .filter((u): u is Record<string, unknown> => u !== null && typeof u === "object" && !Array.isArray(u))
    .filter((u) => typeof u.name === "string" && typeof u.reason === "string")
    .map((u) => ({ name: u.name as string, reason: u.reason as string }));
}

export type WriteResult = { id: string; legacyId: string; created: boolean };

/**
 * Создание закупки. Тело — полный доменный объект (как `savePurchase`):
 * `id` тела становится `legacyId`, повтор с тем же id — 409.
 */
export async function createPurchase(
  ctx: WriteContext,
  raw: unknown,
): Promise<WriteResult> {
  rejectServerFields(raw, "write.createPurchase");
  const id = (raw as { id?: unknown }).id;
  if (typeof id !== "string" || id.length === 0 || id.length > 200) {
    throw new InvalidArgumentError("write.createPurchase — нужен непустой строковый id");
  }
  return ctx.run(async (db) => {
    await requireMember(db, ctx.scope, ctx.userId);
    const repos = orgRepositories(db, ctx.scope);
    const existing = (await repos.purchase.list({ where: { legacyId: id } })) as unknown as Row[];
    if (existing.length > 1) {
      throw new DuplicateLegacyIdError("write.createPurchase", id);
    }
    if (existing.length === 1) {
      throw new AlreadyExistsError("write.createPurchase", id);
    }
    const mapped = mapPurchase(raw);
    if (!mapped.ok) {
      throw new InvalidArgumentError(`write.createPurchase — ${mapped.reason}`);
    }
    const created = (await repos.purchase.create({
      legacyId: mapped.record.legacyId,
      originalFormatVersion: formatOf("purchase"),
      status: mapped.record.status,
      payload: mapped.record.payload,
      createdByUserId: ctx.userId,
    })) as unknown as Row;
    await auditEvent(db, ctx.scope, {
      actorUserId: ctx.userId,
      action: "purchase.created",
      entityType: "purchase",
      entityId: created.id as string,
      metadata: { legacyId: mapped.record.legacyId },
    });
    return { id: created.id as string, legacyId: mapped.record.legacyId, created: true };
  });
}

/**
 * Замена закупки целиком (parity с `savePurchase`: `put` заменяет).
 * Создаёт при отсутствии (с `legacyId` из пути), иначе заменяет колонки,
 * сохраняя автора и исходную версию формата.
 */
export async function replacePurchase(
  ctx: WriteContext,
  id: string,
  raw: unknown,
): Promise<WriteResult> {
  rejectServerFields(raw, "write.replacePurchase");
  if (typeof id !== "string" || id.length === 0 || id.length > 200) {
    throw new InvalidArgumentError("write.replacePurchase — некорректный id пути");
  }
  const body = raw as Record<string, unknown>;
  if (body.id !== undefined && body.id !== id) {
    throw new InvalidArgumentError("write.replacePurchase — id тела не совпадает с id пути");
  }
  return ctx.run(async (db) => {
    await requireMember(db, ctx.scope, ctx.userId);
    const repos = orgRepositories(db, ctx.scope);
    const existing = (await repos.purchase.list({ where: { legacyId: id } })) as unknown as Row[];
    if (existing.length > 1) {
      throw new DuplicateLegacyIdError("write.replacePurchase", id);
    }
    const mapped = mapPurchase({ ...body, id });
    if (!mapped.ok) {
      throw new InvalidArgumentError(`write.replacePurchase — ${mapped.reason}`);
    }
    if (existing.length === 0) {
      const created = (await repos.purchase.create({
        legacyId: mapped.record.legacyId,
        originalFormatVersion: formatOf("purchase"),
        status: mapped.record.status,
        payload: mapped.record.payload,
        createdByUserId: ctx.userId,
      })) as unknown as Row;
      await auditEvent(db, ctx.scope, {
        actorUserId: ctx.userId,
        action: "purchase.created",
        entityType: "purchase",
        entityId: created.id as string,
        metadata: { legacyId: mapped.record.legacyId },
      });
      return { id: created.id as string, legacyId: mapped.record.legacyId, created: true };
    }
    await repos.purchase.update(existing[0].id as string, {
      status: mapped.record.status,
      payload: mapped.record.payload,
    });
    await auditEvent(db, ctx.scope, {
      actorUserId: ctx.userId,
      action: "purchase.updated",
      entityType: "purchase",
      entityId: existing[0].id as string,
      metadata: { legacyId: id },
    });
    return { id: existing[0].id as string, legacyId: id, created: false };
  });
}

/**
 * Удаление закупки с каскадом документов (parity с `deletePurchase`).
 * Отсутствующая — 404 через `remove` репозитория.
 */
export async function deletePurchase(ctx: WriteContext, id: string): Promise<{ documents: number }> {
  if (typeof id !== "string" || id.length === 0 || id.length > 200) {
    throw new InvalidArgumentError("write.deletePurchase — некорректный id");
  }
  return ctx.run(async (db) => {
    await requireMember(db, ctx.scope, ctx.userId);
    const repos = orgRepositories(db, ctx.scope);
    const existing = (await repos.purchase.list({ where: { legacyId: id } })) as unknown as Row[];
    if (existing.length > 1) {
      throw new DuplicateLegacyIdError("write.deletePurchase", id);
    }
    const target = existing[0] ?? ((await repos.purchase.getById(id)) as unknown as Row | null);
    if (!target) {
      throw new NotFoundInScopeError("write.deletePurchase");
    }
    const docs = (await repos.document.list({ where: { purchaseId: target.id } })) as unknown as Row[];
    let removed = 0;
    for (const doc of docs) {
      await deleteRowObjects(ctx, doc);
      removed += await repos.document.remove(doc.id as string);
    }
    await repos.purchase.remove(target.id as string);
    await auditEvent(db, ctx.scope, {
      actorUserId: ctx.userId,
      action: "purchase.deleted",
      entityType: "purchase",
      entityId: target.id as string,
      metadata: { legacyId: id, documents: removed },
    });
    return { documents: removed };
  });
}

export type PurchaseDocumentsInput = {
  purchase?: unknown;
  documents: unknown;
};

/**
 * Замена закупки вместе с документами (parity с `savePurchaseWithDocuments`:
 * закупка заменяется, массив документов — целиком). Атомарно в одной транзакции.
 */
export async function replacePurchaseDocuments(
  ctx: WriteContext,
  id: string,
  input: PurchaseDocumentsInput,
): Promise<WriteResult & { documents: number }> {
  if (typeof id !== "string" || id.length === 0 || id.length > 200) {
    throw new InvalidArgumentError("write.replacePurchaseDocuments — некорректный id");
  }
  if (!Array.isArray(input.documents)) {
    throw new InvalidArgumentError("write.replacePurchaseDocuments — documents обязан быть массивом");
  }
  const documents = input.documents as unknown[];
  if (input.purchase !== undefined) {
    rejectServerFields(input.purchase, "write.replacePurchaseDocuments.purchase");
    const body = input.purchase as Record<string, unknown>;
    if (body.id !== undefined && body.id !== id) {
      throw new InvalidArgumentError("write.replacePurchaseDocuments — id тела не совпадает с id пути");
    }
  }
  for (const doc of documents) {
    rejectServerFields(doc, "write.replacePurchaseDocuments.documents");
  }
  return ctx.run(async (db) => {
    await requireMember(db, ctx.scope, ctx.userId);
    const repos = orgRepositories(db, ctx.scope);
    const existing = (await repos.purchase.list({ where: { legacyId: id } })) as unknown as Row[];
    if (existing.length > 1) {
      throw new DuplicateLegacyIdError("write.replacePurchaseDocuments", id);
    }
    let rowId: string;
    let created = false;
    if (existing.length === 0) {
      if (input.purchase === undefined) {
        throw new NotFoundInScopeError("write.replacePurchaseDocuments");
      }
      const mapped = mapPurchase({ ...(input.purchase as Record<string, unknown>), id });
      if (!mapped.ok) {
        throw new InvalidArgumentError(`write.replacePurchaseDocuments — ${mapped.reason}`);
      }
      const createdRow = (await repos.purchase.create({
        legacyId: mapped.record.legacyId,
        originalFormatVersion: formatOf("purchase"),
        status: mapped.record.status,
        payload: mapped.record.payload,
        createdByUserId: ctx.userId,
      })) as unknown as Row;
      rowId = createdRow.id as string;
      created = true;
    } else {
      rowId = existing[0].id as string;
      if (input.purchase !== undefined) {
        const mapped = mapPurchase({ ...(input.purchase as Record<string, unknown>), id });
        if (!mapped.ok) {
          throw new InvalidArgumentError(`write.replacePurchaseDocuments — ${mapped.reason}`);
        }
        await repos.purchase.update(rowId, { status: mapped.record.status, payload: mapped.record.payload });
      }
    }
    const previous = (await repos.document.list({ where: { purchaseId: rowId } })) as unknown as Row[];
    for (const doc of previous) {
      await deleteRowObjects(ctx, doc);
      await repos.document.remove(doc.id as string);
    }
    // readError подтягивается из unreadable закупки — присланной либо уже
    // хранимой (как в S3-mapping). Тексты при этом никуда не persist-ятся.
    let unreadable: UnreadableEntry[] = [];
    if (input.purchase !== undefined) {
      const purchaseMapped = mapPurchase({ ...(input.purchase as Record<string, unknown>), id });
      if (purchaseMapped.ok) {
        unreadable = unreadableOf(purchaseMapped.record.payload);
      }
    } else if (existing.length === 1) {
      unreadable = unreadableOf((existing[0].payload ?? {}) as Record<string, unknown>);
    }
    let count = 0;
    for (let index = 0; index < documents.length; index += 1) {
      const mapped = mapDocument(documents[index], id, index, unreadable, sha256Hex);
      if (!mapped.ok) {
        throw new InvalidArgumentError(`write.replacePurchaseDocuments — документ ${index}: ${mapped.reason}`);
      }
      const r = mapped.record;
      const docRow = (await repos.document.create({
        legacyId: r.legacyId,
        purchaseId: rowId,
        fileName: r.fileName,
        mimeType: r.mimeType,
        sizeBytes: r.sizeBytes,
        sha256: r.sha256,
        storageKey: null,
        textKey: null,
        mapKey: null,
        pageCount: null,
        ocr: r.ocr,
        readError: r.readError,
      })) as unknown as Row;
      // Текст и карта — в S6, ключи — в строку (как в S8 documentExtractHandler).
      // Без хранилища содержимое не сохраняется: молча класть его в PostgreSQL нельзя.
      if (ctx.storage) {
        const docId = docRow.id as string;
        const textKey = documentObjectKey(ctx.scope.organizationId, docId);
        await putObjectText(ctx.storage, textKey, r.text);
        const patch: Row = { textKey };
        if (r.map) {
          const mapKey = documentObjectKey(ctx.scope.organizationId, docId);
          await putObjectJson(ctx.storage, mapKey, r.map);
          patch.mapKey = mapKey;
        }
        await repos.document.update(docId, patch);
      }
      count += 1;
    }
    await auditEvent(db, ctx.scope, {
      actorUserId: ctx.userId,
      action: "purchase.documents.replaced",
      entityType: "purchase",
      entityId: rowId,
      metadata: { legacyId: id, documents: count },
    });
    return { id: rowId, legacyId: id, created, documents: count };
  });
}

/**
 * Создание образца. Тело — полный `MyDocument` (как `saveMyDocuments`):
 * хранятся `kinds`/`about`, текст — только в сверке (нет колонки до S6).
 * Повтор с тем же id — 409.
 */
export async function createSample(ctx: WriteContext, raw: unknown): Promise<WriteResult> {
  rejectServerFields(raw, "write.createSample");
  const id = (raw as { id?: unknown }).id;
  if (typeof id !== "string" || id.length === 0 || id.length > 200) {
    throw new InvalidArgumentError("write.createSample — нужен непустой строковый id");
  }
  return ctx.run(async (db) => {
    await requireMember(db, ctx.scope, ctx.userId);
    const repos = orgRepositories(db, ctx.scope);
    const existing = (await repos.sample.list({ where: { legacyId: id } })) as unknown as Row[];
    if (existing.length > 1) {
      throw new DuplicateLegacyIdError("write.createSample", id);
    }
    if (existing.length === 1) {
      throw new AlreadyExistsError("write.createSample", id);
    }
    const mapped = mapSample(raw, sha256Hex);
    if (!mapped.ok) {
      throw new InvalidArgumentError(`write.createSample — ${mapped.reason}`);
    }
    const r = mapped.record;
    const created = (await repos.sample.create({
      legacyId: r.legacyId,
      name: r.name,
      kinds: r.kinds,
      about: r.about,
      addedAt: r.addedAt ? new Date(r.addedAt) : null,
      scan: r.scan,
      textKey: null,
      mapKey: null,
    })) as unknown as Row;
    if (ctx.storage) {
      await repos.sample.update(created.id as string, await sampleContentPatch(ctx, created.id as string, r));
    }
    await auditEvent(db, ctx.scope, {
      actorUserId: ctx.userId,
      action: "sample.created",
      entityType: "sample",
      entityId: created.id as string,
      metadata: { legacyId: r.legacyId },
    });
    return { id: created.id as string, legacyId: r.legacyId, created: true };
  });
}

/**
 * Кладёт текст и карту образца в S6 и возвращает патч колонок. Без хранилища
 * содержимое не сохраняется: молча класть крупный текст в PostgreSQL нельзя.
 * Замена целиком: карты нет — `mapKey` обнуляется, старая карта остаётся
 * сиротой до сборки мусора (S8), а не указывает на устаревшие данные.
 */
async function sampleContentPatch(
  ctx: WriteContext,
  rowId: string,
  r: { text: string; map: DocMap | null },
): Promise<Row> {
  if (!ctx.storage) {
    return {};
  }
  const textKey = sampleObjectKey(ctx.scope.organizationId, rowId);
  await putObjectText(ctx.storage, textKey, r.text);
  const patch: Row = { textKey, mapKey: null };
  if (r.map) {
    const mapKey = sampleObjectKey(ctx.scope.organizationId, rowId);
    await putObjectJson(ctx.storage, mapKey, r.map);
    patch.mapKey = mapKey;
  }
  return patch;
}

/**
 * Замена образца целиком (parity с `put` в `saveMyDocuments`).
 * Создаёт при отсутствии, иначе заменяет поля `MyDocument`.
 */
export async function replaceSample(ctx: WriteContext, id: string, raw: unknown): Promise<WriteResult> {
  rejectServerFields(raw, "write.replaceSample");
  if (typeof id !== "string" || id.length === 0 || id.length > 200) {
    throw new InvalidArgumentError("write.replaceSample — некорректный id пути");
  }
  const body = raw as Record<string, unknown>;
  if (body.id !== undefined && body.id !== id) {
    throw new InvalidArgumentError("write.replaceSample — id тела не совпадает с id пути");
  }
  return ctx.run(async (db) => {
    await requireMember(db, ctx.scope, ctx.userId);
    const repos = orgRepositories(db, ctx.scope);
    const existing = (await repos.sample.list({ where: { legacyId: id } })) as unknown as Row[];
    if (existing.length > 1) {
      throw new DuplicateLegacyIdError("write.replaceSample", id);
    }
    const mapped = mapSample({ ...body, id }, sha256Hex);
    if (!mapped.ok) {
      throw new InvalidArgumentError(`write.replaceSample — ${mapped.reason}`);
    }
    const r = mapped.record;
    const fields = {
      name: r.name,
      kinds: r.kinds,
      about: r.about,
      addedAt: r.addedAt ? new Date(r.addedAt) : null,
      scan: r.scan,
    };
    if (existing.length === 0) {
      const created = (await repos.sample.create({
        legacyId: r.legacyId,
        ...fields,
        textKey: null,
        mapKey: null,
      })) as unknown as Row;
      if (ctx.storage) {
        await repos.sample.update(created.id as string, await sampleContentPatch(ctx, created.id as string, r));
      }
      await auditEvent(db, ctx.scope, {
        actorUserId: ctx.userId,
        action: "sample.created",
        entityType: "sample",
        entityId: created.id as string,
        metadata: { legacyId: r.legacyId },
      });
      return { id: created.id as string, legacyId: r.legacyId, created: true };
    }
    const patch: Row = { ...fields };
    if (ctx.storage) {
      // Старые объекты строки убираются до записи новых: иначе текст и карта
      // копятся сиротами при каждом сохранении.
      await deleteRowObjects(ctx, existing[0]);
      Object.assign(patch, await sampleContentPatch(ctx, existing[0].id as string, r));
    }
    await repos.sample.update(existing[0].id as string, patch);
    await auditEvent(db, ctx.scope, {
      actorUserId: ctx.userId,
      action: "sample.updated",
      entityType: "sample",
      entityId: existing[0].id as string,
      metadata: { legacyId: id },
    });
    return { id: existing[0].id as string, legacyId: id, created: false };
  });
}

/** Удаление образца. Отсутствующий — 404. */
export async function deleteSample(ctx: WriteContext, id: string): Promise<{ deleted: boolean }> {
  if (typeof id !== "string" || id.length === 0 || id.length > 200) {
    throw new InvalidArgumentError("write.deleteSample — некорректный id");
  }
  return ctx.run(async (db) => {
    await requireMember(db, ctx.scope, ctx.userId);
    const repos = orgRepositories(db, ctx.scope);
    const existing = (await repos.sample.list({ where: { legacyId: id } })) as unknown as Row[];
    if (existing.length > 1) {
      throw new DuplicateLegacyIdError("write.deleteSample", id);
    }
    const target = existing[0] ?? ((await repos.sample.getById(id)) as unknown as Row | null);
    if (!target) {
      throw new NotFoundInScopeError("write.deleteSample");
    }
    await deleteRowObjects(ctx, target);
    await repos.sample.remove(target.id as string);
    await auditEvent(db, ctx.scope, {
      actorUserId: ctx.userId,
      action: "sample.deleted",
      entityType: "sample",
      entityId: target.id as string,
      metadata: { legacyId: id },
    });
    return { deleted: true };
  });
}

/**
 * Создание факта. Тело — полный `Fact` (как элементы `saveFacts`):
 * валидация и нормализация — существующим `mapFact`, повтор id — 409.
 */
export async function createFact(ctx: WriteContext, raw: unknown): Promise<WriteResult> {
  rejectServerFields(raw, "write.createFact");
  const id = (raw as { id?: unknown }).id;
  if (typeof id !== "string" || id.length === 0 || id.length > 200) {
    throw new InvalidArgumentError("write.createFact — нужен непустой строковый id");
  }
  return ctx.run(async (db) => {
    await requireMember(db, ctx.scope, ctx.userId);
    const repos = orgRepositories(db, ctx.scope);
    const existing = (await repos.fact.list({ where: { legacyId: id } })) as unknown as Row[];
    if (existing.length > 1) {
      throw new DuplicateLegacyIdError("write.createFact", id);
    }
    if (existing.length === 1) {
      throw new AlreadyExistsError("write.createFact", id);
    }
    const mapped = mapFact(raw);
    if (!mapped.ok) {
      throw new InvalidArgumentError(`write.createFact — ${mapped.reason}`);
    }
    const r = mapped.record;
    const created = (await repos.fact.create({
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
    })) as unknown as Row;
    await auditEvent(db, ctx.scope, {
      actorUserId: ctx.userId,
      action: "fact.created",
      entityType: "fact",
      entityId: created.id as string,
      metadata: { legacyId: r.legacyId },
    });
    return { id: created.id as string, legacyId: r.legacyId, created: true };
  });
}

/**
 * Замена факта целиком (parity с `put` в `saveFacts`).
 * Создаёт при отсутствии, иначе заменяет колонки.
 */
export async function replaceFact(ctx: WriteContext, id: string, raw: unknown): Promise<WriteResult> {
  rejectServerFields(raw, "write.replaceFact");
  if (typeof id !== "string" || id.length === 0 || id.length > 200) {
    throw new InvalidArgumentError("write.replaceFact — некорректный id пути");
  }
  const body = raw as Record<string, unknown>;
  if (body.id !== undefined && body.id !== id) {
    throw new InvalidArgumentError("write.replaceFact — id тела не совпадает с id пути");
  }
  return ctx.run(async (db) => {
    await requireMember(db, ctx.scope, ctx.userId);
    const repos = orgRepositories(db, ctx.scope);
    const existing = (await repos.fact.list({ where: { legacyId: id } })) as unknown as Row[];
    if (existing.length > 1) {
      throw new DuplicateLegacyIdError("write.replaceFact", id);
    }
    const mapped = mapFact({ ...body, id });
    if (!mapped.ok) {
      throw new InvalidArgumentError(`write.replaceFact — ${mapped.reason}`);
    }
    const r = mapped.record;
    const data = {
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
    if (existing.length === 0) {
      const created = (await repos.fact.create({ legacyId: r.legacyId, ...data })) as unknown as Row;
      await auditEvent(db, ctx.scope, {
        actorUserId: ctx.userId,
        action: "fact.created",
        entityType: "fact",
        entityId: created.id as string,
        metadata: { legacyId: r.legacyId },
      });
      return { id: created.id as string, legacyId: r.legacyId, created: true };
    }
    await repos.fact.update(existing[0].id as string, data);
    await auditEvent(db, ctx.scope, {
      actorUserId: ctx.userId,
      action: "fact.updated",
      entityType: "fact",
      entityId: existing[0].id as string,
      metadata: { legacyId: id },
    });
    return { id: existing[0].id as string, legacyId: id, created: false };
  });
}

/** Удаление факта. Отсутствующий — 404. */
export async function deleteFact(ctx: WriteContext, id: string): Promise<{ deleted: boolean }> {
  if (typeof id !== "string" || id.length === 0 || id.length > 200) {
    throw new InvalidArgumentError("write.deleteFact — некорректный id");
  }
  return ctx.run(async (db) => {
    await requireMember(db, ctx.scope, ctx.userId);
    const repos = orgRepositories(db, ctx.scope);
    const existing = (await repos.fact.list({ where: { legacyId: id } })) as unknown as Row[];
    if (existing.length > 1) {
      throw new DuplicateLegacyIdError("write.deleteFact", id);
    }
    const target = existing[0] ?? ((await repos.fact.getById(id)) as unknown as Row | null);
    if (!target) {
      throw new NotFoundInScopeError("write.deleteFact");
    }
    await repos.fact.remove(target.id as string);
    await auditEvent(db, ctx.scope, {
      actorUserId: ctx.userId,
      action: "fact.deleted",
      entityType: "fact",
      entityId: target.id as string,
      metadata: { legacyId: id },
    });
    return { deleted: true };
  });
}

/**
 * Замена профиля (parity с `saveProfile`): корпоративная часть — в строку
 * организации, персональная — в строку вызывающего пользователя. Атомарно.
 * Версии: на создании — текущий формат, при обновлении — сохраняются.
 */
export async function saveServerProfile(
  ctx: WriteContext,
  input: { profile: unknown; meta?: unknown },
): Promise<{ organizationId: string; userId: string; created: boolean }> {
  if (input.profile !== undefined) {
    rejectServerFields(input.profile, "write.saveServerProfile.profile");
  }
  return ctx.run(async (db) => {
    await requireMember(db, ctx.scope, ctx.userId);
    const repos = orgRepositories(db, ctx.scope);
    const mapped = splitProfile(input.profile ?? {}, input.meta);
    if (!mapped.ok) {
      throw new InvalidArgumentError(`write.saveServerProfile — ${mapped.reason}`);
    }
    const p = mapped.record;
    if (p.empty) {
      throw new InvalidArgumentError("write.saveServerProfile — профиль пуст, сохранять нечего");
    }
    let created = false;
    let orgProfileId: string;
    const orgRows = (await repos.organizationProfile.list()) as unknown as Row[];
    if (orgRows.length === 0) {
      const createdRow = (await repos.organizationProfile.create({
        fields: p.orgFields,
        version: p.orgVersion,
        meta: p.meta,
      })) as unknown as Row;
      orgProfileId = createdRow.id as string;
      created = true;
    } else if (orgRows.length > 1) {
      throw new DuplicateLegacyIdError("write.saveServerProfile", "profile");
    } else {
      orgProfileId = orgRows[0].id as string;
      await repos.organizationProfile.update(orgProfileId, { fields: p.orgFields, meta: p.meta });
    }
    const userRow = (await db.userProfile.findFirst({ where: { userId: ctx.userId } })) as Row | null;
    if (!userRow) {
      await db.userProfile.create({ data: { userId: ctx.userId, fields: p.userFields, version: p.userVersion } });
      created = true;
    } else {
      await db.userProfile.updateMany({ where: { userId: ctx.userId }, data: { fields: p.userFields } });
    }
    await auditEvent(db, ctx.scope, {
      actorUserId: ctx.userId,
      action: "profile.updated",
      entityType: "profile",
      entityId: orgProfileId,
    });
    return { organizationId: ctx.scope.organizationId, userId: ctx.userId, created };
  });
}

