/**
 * Простейшая in-memory реализация `DbClient` для модульных проверок аутентификации.
 *
 * Зачем отдельная память, если в `db/testing/fake-db.ts` уже есть фейк: тот фейк отвечает
 * заранее заданными строками и не хранит состояние. Принятие приглашения и сброс пароля —
 * многошаговые сценарии с условным обновлением (`acceptedAt IS NULL`) и повторным чтением,
 * которые на «очереди ответов» проверяются хрупко. Здесь же таблицы реально хранят строки,
 * поэтому проверяются именно свойства протокола: одноразовость, хеширование токена,
 * изоляция по `organizationId` и «последний владелец».
 *
 * Поддерживаются только те операции и условия, которые встречаются в модулях `auth/`:
 * равенство (включая `null`) и `{ gt }`/`{ lt }` по дате. Этого достаточно для сессий,
 * приглашений и сброса пароля; бизнес-SQL проверяется интеграционным тестом на PostgreSQL.
 */

import type { DbClient, ModelDelegate, QueryArgs } from "../../db/db-client.ts";

type Row = Record<string, unknown>;

const TABLE_NAMES = [
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
] as const;

/** Поля, которые Prisma проставляет по умолчанию и на которые опираются запросы. */
const DEFAULTS: Record<string, () => Row> = {
  user: () => ({ name: null, image: null, passwordHash: null, deletedAt: null, emailVerified: null }),
  organization: () => ({ deletedAt: null, name: "Организация" }),
  invitation: () => ({ acceptedAt: null }),
  userProfile: () => ({ fields: {} }),
};

function matchesValue(actual: unknown, expected: unknown): boolean {
  if (expected !== null && typeof expected === "object" && !(expected instanceof Date)) {
    const condition = expected as Record<string, unknown>;
    if ("gt" in condition) {
      return actual instanceof Date && actual.getTime() > (condition.gt as Date).getTime();
    }
    if ("lt" in condition) {
      return actual instanceof Date && actual.getTime() < (condition.lt as Date).getTime();
    }
    if ("not" in condition) {
      return actual !== condition.not;
    }
  }
  return actual === expected;
}

function matches(row: Row, where: QueryArgs | undefined): boolean {
  if (!where) {
    return true;
  }
  return Object.entries(where).every(([key, value]) => {
    // Связи (`memberships: { some: ... }`) в модулях auth/ не используются.
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const keys = Object.keys(value as Record<string, unknown>);
      if (keys.some((k) => k === "some" || k === "every" || k === "none")) {
        throw new TypeError(`memory-db: фильтр по связи не поддерживается (${key})`);
      }
    }
    return matchesValue(row[key], value);
  });
}

class MemoryTable {
  readonly rows: Row[] = [];
  private counter = 0;
  private readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  insert(data: Row): Row {
    const row: Row = { ...(DEFAULTS[this.name]?.() ?? {}), ...data };
    if (typeof row.id !== "string") {
      this.counter += 1;
      row.id = `${this.name.slice(0, 3)}_${this.counter}` as string;
    }
    this.rows.push(row);
    return row;
  }

  update(where: QueryArgs | undefined, data: Row): number {
    let count = 0;
    for (const row of this.rows) {
      if (matches(row, where)) {
        Object.assign(row, data);
        count += 1;
      }
    }
    return count;
  }

  remove(where: QueryArgs | undefined): number {
    let count = 0;
    for (let i = this.rows.length - 1; i >= 0; i -= 1) {
      if (matches(this.rows[i], where)) {
        this.rows.splice(i, 1);
        count += 1;
      }
    }
    return count;
  }

  find(where: QueryArgs | undefined): Row[] {
    return this.rows.filter((row) => matches(row, where));
  }
}

function makeDelegate(table: MemoryTable): ModelDelegate {
  return {
    async findMany(args) {
      return table.find(args?.where as QueryArgs | undefined);
    },
    async findFirst(args) {
      return table.find(args?.where as QueryArgs | undefined)[0] ?? null;
    },
    async create(args) {
      return table.insert((args.data ?? {}) as Row);
    },
    async updateMany(args) {
      return { count: table.update(args.where as QueryArgs | undefined, (args.data ?? {}) as Row) };
    },
    async deleteMany(args) {
      return { count: table.remove(args.where as QueryArgs | undefined) };
    },
    async count(args) {
      return table.find(args?.where as QueryArgs | undefined).length;
    },
  };
}

export type MemoryDb = {
  readonly db: DbClient;
  /** Все строки таблицы (по ссылке) — для проверок и донастройки. */
  table(name: (typeof TABLE_NAMES)[number]): Row[];
};

export function createMemoryDb(seed: Partial<Record<(typeof TABLE_NAMES)[number], Row[]>> = {}): MemoryDb {
  const tables = new Map<string, MemoryTable>();
  const delegates: Record<string, ModelDelegate> = {};

  for (const name of TABLE_NAMES) {
    const table = new MemoryTable(name);
    tables.set(name, table);
    delegates[name] = makeDelegate(table);
  }

  for (const [name, rows] of Object.entries(seed)) {
    const table = tables.get(name);
    if (!table) {
      throw new TypeError(`memory-db: неизвестная таблица ${name}`);
    }
    for (const row of rows ?? []) {
      table.insert(row);
    }
  }

  return {
    db: delegates as unknown as DbClient,
    table(name) {
      const table = tables.get(name);
      if (!table) {
        throw new TypeError(`memory-db: неизвестная таблица ${name}`);
      }
      return table.rows;
    },
  };
}
