/**
 * Структурный тип клиента БД, который используют репозитории.
 *
 * Отдельный файл и отдельный тип — чтобы репозитории можно было тестировать без живой
 * БД и без импорта `@prisma/client` в тесты. Репозитории не знают про Prisma: они
 * знают про делегаты с этими методами. Настоящий `PrismaClient` подставляется в
 * `client.ts` — единственном месте, где есть импорт рантайма.
 *
 * Набор методов выбран намеренно минимальным. В частности, `findUnique`, `update` и
 * `delete` на `where` в Prisma требуют уникальности, а `where` с `organizationId` таковым
 * не является. Поэтому для чтения используется `findFirst`, а для изменения и удаления —
 * `updateMany`/`deleteMany`: они принимают произвольное условие, выполняют его в одном
 * SQL-выражении с самой мутацией и не создают окна между проверкой и изменением.
 */

/** Аргументы запроса. Намеренно непрозрачный тип: репозиторий не интерпретирует их. */
export type QueryArgs = Record<string, unknown>;

/** Результат массового изменения или удаления. */
export type BatchResult = { count: number };

/** Делегат модели — минимальная поверхность, нужная репозиториям. */
export type ModelDelegate = {
  findMany(args?: QueryArgs): Promise<unknown[]>;
  findFirst(args?: QueryArgs): Promise<unknown | null>;
  create(args: QueryArgs): Promise<unknown>;
  updateMany(args: QueryArgs): Promise<BatchResult>;
  deleteMany(args: QueryArgs): Promise<BatchResult>;
  count(args?: QueryArgs): Promise<number>;
};

/** Клиент БД: по одному делегату на модель. */
export type DbClient = {
  organization: ModelDelegate;
  user: ModelDelegate;
  membership: ModelDelegate;
  organizationProfile: ModelDelegate;
  userProfile: ModelDelegate;
  purchase: ModelDelegate;
  document: ModelDelegate;
  fact: ModelDelegate;
  sample: ModelDelegate;
  auditEvent: ModelDelegate;
  legacyImportBatch: ModelDelegate;
  // S2: аутентификация и приглашения. Делегаты входят в тот же структурный клиент,
  // чтобы сессии и приглашения проверялись теми же средствами, что и бизнес-таблицы.
  account: ModelDelegate;
  session: ModelDelegate;
  verificationToken: ModelDelegate;
  invitation: ModelDelegate;
  // S12: база знаний. Владелец — общая база или организация; таблицы несут ownerKey, а не organizationId.
  knowledgeDocument: ModelDelegate;
  knowledgeChunk: ModelDelegate;
};

/** Имена делегатов, которые обязаны присутствовать в клиенте. */
export const DB_DELEGATES = [
  "organization",
  "user",
  "membership",
  "organizationProfile",
  "userProfile",
  "purchase",
  "document",
  "fact",
  "sample",
  "auditEvent",
  "legacyImportBatch",
  "account",
  "session",
  "verificationToken",
  "invitation",
  "knowledgeDocument",
  "knowledgeChunk",
] as const satisfies readonly (keyof DbClient)[];

export type DbDelegateName = (typeof DB_DELEGATES)[number];

/**
 * Проверяет, что переданный объект пригоден в качестве клиента: в нём есть все
 * делегаты и у каждого есть нужные методы. Используется на границе внедрения и в
 * тестах, чтобы отсутствие делегата обнаруживалось при подключении, а не при первом
 * запросе к конкретной таблице.
 */
export function assertDbClient(value: unknown): asserts value is DbClient {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("DbClient: передан не объект");
  }
  const client = value as Record<string, unknown>;
  const required = ["findMany", "findFirst", "create", "updateMany", "deleteMany", "count"];
  const missing: string[] = [];

  for (const name of DB_DELEGATES) {
    const delegate = client[name];
    if (typeof delegate !== "object" || delegate === null) {
      missing.push(`${name} (делегат отсутствует)`);
      continue;
    }
    for (const method of required) {
      if (typeof (delegate as Record<string, unknown>)[method] !== "function") {
        missing.push(`${name}.${method}`);
      }
    }
  }

  if (missing.length > 0) {
    throw new TypeError(`DbClient: не хватает методов: ${missing.join(", ")}`);
  }
}
