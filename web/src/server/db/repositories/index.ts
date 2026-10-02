/**
 * Репозитории S1-таблиц.
 *
 * Каждая функция возвращает набор операций, уже привязанный к `OrgScope`. Скоуп
 * обязателен: он передаётся один раз при создании набора, и у вызывающего кода нет
 * способа выполнить запрос к арендаторным данным, не указав организацию.
 *
 * `User` и `UserProfile` — единственные таблицы без `organizationId`. Причина в модели
 * данных: пользователь может состоять в нескольких организациях, поэтому его данные не
 * принадлежат одной. Связь с организацией идёт через `Membership`, и доступ к
 * пользователю в контексте организации проходит только через организацию и её роли —
 * см. `requireOrganizationAccess`.
 */

import type { DbClient, QueryArgs } from "../db-client.ts";
import { InvalidArgumentError, NotFoundInScopeError } from "../errors.ts";
import type { OrgScope } from "../org-scope.ts";
import { orgScope, rejectOrgOverride, requireOrgId, withOrgScope, withOrgScopeData } from "../org-scope.ts";
import type { ScopedRepo } from "./scoped.ts";
import { scopedRepository } from "./scoped.ts";

export type Org = { id: string; name: string; createdAt: Date; updatedAt: Date; deletedAt: Date | null };
export type Purchase = { id: string; organizationId: string; status: string; payload: unknown };
export type DocumentRow = {
  id: string;
  organizationId: string;
  purchaseId: string | null;
  storageKey: string | null;
};
export type Fact = { id: string; organizationId: string; kind: string; confirmed: boolean };
export type Sample = { id: string; organizationId: string };
export type AuditEventRow = { id: string; organizationId: string; action: string; entityType: string };
export type ImportBatchRow = {
  id: string;
  organizationId: string;
  batchKey: string;
  backupHash: string;
  status: string;
};
export type User = { id: string; email: string; name: string | null };
export type Membership = { id: string; organizationId: string; userId: string; role: "owner" | "member" };
export type InvitationRow = {
  id: string;
  organizationId: string;
  email: string;
  role: "owner" | "member";
  expiresAt: Date;
  acceptedAt: Date | null;
};

/** Операции над таблицами с `organizationId`. Скоуп обязателен.
 *
 * `Organization` сюда не входит сознательно: у таблицы нет колонки `organizationId`,
 * поэтому generic-фабрика, подмешивающая её в `where`/`data`, для организации
 * неприменима. Организация обслуживается отдельным `organizationRepository`.
 */
export type OrgRepos = {
  membership: ScopedRepo<Membership>;
  organizationProfile: ScopedRepo<unknown>;
  purchase: ScopedRepo<Purchase>;
  document: ScopedRepo<DocumentRow>;
  fact: ScopedRepo<Fact>;
  sample: ScopedRepo<Sample>;
  auditEvent: ScopedRepo<AuditEventRow>;
  legacyImportBatch: ScopedRepo<ImportBatchRow>;
  invitation: ScopedRepo<InvitationRow>;
};

/**
 * Создаёт репозитории для организации.
 */
export function orgRepositories(db: DbClient, scope: OrgScope): OrgRepos {
  return {
    membership: scopedRepository<Membership>(db, "membership", scope, "membership"),
    organizationProfile: scopedRepository(db, "organizationProfile", scope, "organizationProfile"),
    purchase: scopedRepository<Purchase>(db, "purchase", scope, "purchase"),
    document: scopedRepository<DocumentRow>(db, "document", scope, "document"),
    fact: scopedRepository<Fact>(db, "fact", scope, "fact"),
    sample: scopedRepository<Sample>(db, "sample", scope, "sample"),
    auditEvent: scopedRepository<AuditEventRow>(db, "auditEvent", scope, "auditEvent"),
    legacyImportBatch: scopedRepository<ImportBatchRow>(db, "legacyImportBatch", scope, "legacyImportBatch"),
    invitation: scopedRepository<InvitationRow>(db, "invitation", scope, "invitation"),
  };
}

/**
 * Отдельный репозиторий организации.
 *
 * Организация — корень скоупа, а не его содержимое: у неё нет `organizationId`, и
 * generic-фабрика для неё неприменима. Здесь каждая операция построена вручную:
 *
 * - чтение по умолчанию видит только неудалённые записи (`deletedAt IS NULL`);
 * - `data` создания и изменения не может содержать `organizationId` — такого поля нет,
 *   а его появление означает баг вызывающего кода и отклоняется явно, а не ошибкой
 *   Prisma глубоко внутри;
 * - физического удаления нет: пока на организацию ссылаются данные, его всё равно
 *   заблокирует `ON DELETE RESTRICT`, а без данных удаление организации — отдельная
 *   серверная процедура, а не метод репозитория.
 */
export type OrganizationRepo = {
  readonly operation: "organization";
  list(args?: QueryArgs): Promise<Org[]>;
  getById(id: string): Promise<Org | null>;
  create(data: QueryArgs): Promise<Org>;
  update(id: string, data: QueryArgs): Promise<Org>;
  softRemove(id: string, now: Date): Promise<number>;
};

export function organizationRepository(db: DbClient): OrganizationRepo {
  const delegate = db.organization;

  const liveOnly = (where: QueryArgs | undefined, operation: string): QueryArgs => {
    if (where && Object.hasOwn(where, "deletedAt")) {
      throw new InvalidArgumentError(
        `${operation} — фильтр по deletedAt задаёт репозиторий; вызывающий его не переопределяет`,
      );
    }
    return { ...(where ?? {}), deletedAt: null };
  };

  const noOrgField = (data: QueryArgs, operation: string): void => {
    if (Object.hasOwn(data, "organizationId")) {
      throw new InvalidArgumentError(
        `${operation} — у Organization нет поля organizationId; его присутствие в данных — ошибка вызывающего кода`,
      );
    }
  };

  const list = async (args?: QueryArgs): Promise<Org[]> =>
    (await delegate.findMany({
      ...args,
      where: liveOnly(args?.where as QueryArgs | undefined, "organization.list"),
    })) as Org[];

  const getById = async (id: string): Promise<Org | null> => {
    if (typeof id !== "string" || id.length === 0) {
      throw new InvalidArgumentError(`organization.getById: некорректный id ${JSON.stringify(id)}`);
    }
    return (await delegate.findFirst({ where: { id, deletedAt: null } })) as Org | null;
  };

  const create = async (data: QueryArgs): Promise<Org> => {
    noOrgField(data, "organization.create");
    return (await delegate.create({ data })) as Org;
  };

  const update = async (id: string, data: QueryArgs): Promise<Org> => {
    noOrgField(data, "organization.update");
    const result = await delegate.updateMany({ where: { id, deletedAt: null }, data });
    if (result.count === 0) {
      throw new NotFoundInScopeError("organization.update");
    }
    return (await delegate.findFirst({ where: { id, deletedAt: null } })) as Org;
  };

  const softRemove = async (id: string, now: Date): Promise<number> => {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new InvalidArgumentError("organization.softRemove: некорректная дата удаления");
    }
    const result = await delegate.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: now },
    });
    if (result.count === 0) {
      throw new NotFoundInScopeError("organization.softRemove");
    }
    return result.count;
  };

  return { operation: "organization", list, getById, create, update, softRemove };
}

/**
 * Точечное чтение организации.
 *
 * Единственное место, где строка `Organization` выбирается по идентификатору. Условие —
 * точное равенство переданному значению плюс признак того, что запись не удалена;
 * вызывающий не может добавить к нему другие условия.
 */
export function findOrganizationById(db: DbClient, id: string) {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidArgumentError(`findOrganizationById: некорректный id ${JSON.stringify(id)}`);
  }
  return db.organization.findFirst({ where: { id, deletedAt: null } });
}

/**
 * Организации, в которых состоит пользователь.
 *
 * `userId` обязан прийти из серверней сессии. Функция не принимает скоуп: состав
 * организаций — это и есть ответ на вопрос «кому вообще доступно», то есть она
 * предшествует выбору скоупа, а не следует за ним.
 */
export function findOrganizationsForUser(db: DbClient, userId: string) {
  if (typeof userId !== "string" || userId.length === 0) {
    throw new InvalidArgumentError(`findOrganizationsForUser: некорректный userId ${JSON.stringify(userId)}`);
  }
  return db.organization.findMany({
    where: {
      deletedAt: null,
      memberships: { some: { userId } },
    },
  });
}

/**
 * Чтение пользователя в контексте организации.
 *
 * Пользователь не принадлежит организации напрямую, поэтому условие идёт через
 * `Membership`. Это и есть проверка доступа: если членства нет, возвращается `null` и
 * никакие данные пользователя не раскрываются.
 */
export function findUserInOrganization(db: DbClient, scope: OrgScope, userId: string) {
  const organizationId = requireOrgId(scope, "findUserInOrganization");
  return db.user.findFirst({
    where: {
      id: userId,
      deletedAt: null,
      memberships: { some: { organizationId } },
    },
  });
}

/**
 * Проверка членства: возвращает `Membership` либо `null`.
 *
 * Единая точка для авторизации на уровне организации. Роль здесь ещё не проверяется —
 * проверка возможностей (owner/member) выполняется поверх неё отдельно.
 */
export async function findMembership(
  db: DbClient,
  scope: OrgScope,
  userId: string,
): Promise<Membership | null> {
  const organizationId = requireOrgId(scope, "findMembership");
  const row = await db.membership.findFirst({ where: { organizationId, userId } });
  return (row as Membership | null) ?? null;
}

/** Проверка членства, бросающая `NotFoundInScopeError` при его отсутствии. */
export async function requireOrganizationAccess(
  db: DbClient,
  scope: OrgScope,
  userId: string,
): Promise<Membership> {
  const membership = await findMembership(db, scope, userId);
  if (!membership) {
    throw new NotFoundInScopeError("requireOrganizationAccess");
  }
  return membership;
}

/**
 * Запись события аудита.
 *
 * Создаётся, а не обновляется: аудит только дополняется. Метаданные и `ipHash` передаёт
 * вызывающий код, и не класть туда персональные данные — его ответственность.
 * Организация проставляется из скоупа и не может быть подменена аргументом.
 *
 * Функция объявлена `async`, хотя сам запрос создаётся синхронно: отказ отсутствующего
 * скоупа должен приходить как отклонённое обещание, а не как синхронное исключение.
 * Иначе один и тот же вызов в `try/catch` и в `await` вёл бы себя по-разному.
 */
export async function appendAuditEvent(
  db: DbClient,
  scope: OrgScope,
  event: QueryArgs,
): Promise<AuditEventRow> {
  return (await db.auditEvent.create({
    data: withOrgScopeData(event, scope, "auditEvent.append"),
  })) as AuditEventRow;
}

/**
 * Состояния пакета импорта. Зеркалит `enum ImportBatchStatus` в схеме Prisma:
 * ограничение набора значений продублировано в коде, чтобы недопустимый статус
 * отклонялся до обращения к БД с понятным сообщением, а не ошибкой драйвера.
 *
 * - `started` — пакет создан, перенос ещё не начался;
 * - `running` — перенос идёт (состояние для возобновления на этапе S4);
 * - `completed` / `failed` — финальные состояния, ставит только `finishImportBatch`.
 */
export const IMPORT_BATCH_STATUS_VALUES = ["started", "running", "completed", "failed"] as const;

export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUS_VALUES)[number];

const FINISHABLE_BATCH_STATUSES: readonly ImportBatchStatus[] = ["completed", "failed"];

export function assertImportBatchStatus(
  value: unknown,
  operation: string,
  allowed: readonly ImportBatchStatus[] = IMPORT_BATCH_STATUS_VALUES,
): asserts value is ImportBatchStatus {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(
      `${operation} — недопустимый статус пакета импорта ${JSON.stringify(value)}; разрешены: ${allowed.join(", ")}`,
    );
  }
}

/**
 * Начало пакета импорта.
 *
 * Идемпотентность по `batchKey` обеспечивается уникальным индексом в БД, а не проверкой
 * в приложении: гонка двух параллельных запусков разрешается нарушителем уникальности.
 * Повторный запуск с тем же ключом должен быть отвергнут БД — это ожидаемое поведение,
 * а не ошибка приложения.
 *
 * Идентичность пакета (`id`, `organizationId`) и его состояние (`status`, отметки
 * времени) задаёт функция, а не вызывающий: присутствие этих ключей во входных данных
 * отклоняется, а не перекрывается. Обязательные `batchKey` и `backupHash` проверяются
 * здесь же, чтобы ошибка была понятной, а не падением ограничения БД.
 */
export async function startImportBatch(
  db: DbClient,
  scope: OrgScope,
  batch: QueryArgs,
): Promise<ImportBatchRow> {
  const organizationId = requireOrgId(scope, "legacyImportBatch.start");

  for (const forbidden of ["id", "organizationId", "status", "startedAt", "finishedAt"]) {
    if (Object.hasOwn(batch, forbidden)) {
      throw new InvalidArgumentError(
        `legacyImportBatch.start — поле ${forbidden} задаёт функция, а не вызывающий`,
      );
    }
  }

  if (typeof batch.batchKey !== "string" || batch.batchKey.length === 0) {
    throw new InvalidArgumentError("legacyImportBatch.start — обязателен непустой batchKey");
  }
  if (typeof batch.backupHash !== "string" || batch.backupHash.length === 0) {
    throw new InvalidArgumentError("legacyImportBatch.start — обязателен непустой backupHash");
  }

  return (await db.legacyImportBatch.create({
    data: { ...batch, organizationId, status: "started" satisfies ImportBatchStatus },
  })) as ImportBatchRow;
}

/**
 * Завершение пакета импорта с записью счётчиков и контрольных сумм.
 *
 * Разрешённый набор полей результата — allowlist: `status`, `counts`, `checksums`,
 * `backupFormatVersion`. Всё остальное, и в первую очередь идентичность пакета (`id`,
 * `batchKey`, `backupHash`, `organizationId`) и отметки времени, отклоняется: завершение
 * не может переименовать, переместить или передатировать чужой пакет. Статус обязан быть
 * финальным (`completed` или `failed`); `finishedAt` ставит функция.
 */
export async function finishImportBatch(db: DbClient, scope: OrgScope, batchId: string, result: QueryArgs) {
  const where = withOrgScope({ id: batchId }, scope, "legacyImportBatch.finish");

  // Организация пакета неизменна — единая точка запрета для всех мутаций.
  rejectOrgOverride(result, "legacyImportBatch.finish");
  for (const forbidden of ["id", "batchKey", "backupHash", "startedAt", "finishedAt"]) {
    if (result && Object.hasOwn(result, forbidden)) {
      throw new InvalidArgumentError(
        `legacyImportBatch.finish — поле ${forbidden} менять запрещено`,
      );
    }
  }

  const { status, counts, checksums, backupFormatVersion } = result ?? {};
  assertImportBatchStatus(status, "legacyImportBatch.finish", FINISHABLE_BATCH_STATUSES);

  const data: QueryArgs = { status, finishedAt: new Date() };
  if (counts !== undefined) {
    data.counts = counts;
  }
  if (checksums !== undefined) {
    data.checksums = checksums;
  }
  if (backupFormatVersion !== undefined) {
    data.backupFormatVersion = backupFormatVersion;
  }

  const update = await db.legacyImportBatch.updateMany({ where, data });
  if (update.count === 0) {
    throw new NotFoundInScopeError("legacyImportBatch.finish");
  }
  return update.count;
}

/**
 * Поиск ранее выполненного пакета по ключу: позволяет определить, был ли импорт уже
 * выполнен, до начала переноса данных.
 */
export function findImportBatchByKey(db: DbClient, scope: OrgScope, batchKey: string) {
  return db.legacyImportBatch.findFirst({
    where: withOrgScope({ batchKey }, scope, "legacyImportBatch.findByKey"),
  });
}

export { orgScope };
export type { OrgScope };
