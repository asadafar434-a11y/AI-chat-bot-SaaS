/**
 * Тестовый фейк клиента БД: записывает вызовы и отдаёт заранее заданные ответы.
 *
 * Нужен, чтобы проверять две вещи, которые иначе проверять нечем:
 * - что `organizationId` действительно попадает в условие каждого запроса;
 * - что изменение и удаление выполняются `updateMany`/`deleteMany` с этим условием,
 *   а не `update`/`delete` по одному лишь `id`.
 *
 * Фейк намеренно не реализует `findUnique`, `update` и `delete`: если бы репозиторий
 * попытался использовать их, тест упал бы с «не является функцией» вместо тихой
 * потери проверки арендатора.
 */

import type { DbClient, ModelDelegate, QueryArgs } from "../db-client.ts";
import { DB_DELEGATES } from "../db-client.ts";

export type RecordedCall = { delegate: string; method: string; args: QueryArgs | undefined };

export type FakeDb = DbClient & {
  /** Все вызовы в порядке выполнения. */
  readonly calls: RecordedCall[];
  /** Ответ, который вернёт ближайший вызов `findMany`/`findFirst`/`updateMany`. */
  rows: unknown[];
  /** Значение `count`, возвращаемое `updateMany`/`deleteMany`. */
  affected: number;
  /** Только вызовы одного делегата. */
  callsTo(delegate: string): RecordedCall[];
  /** Первый вызов данного метода, или `undefined`. */
  firstCall(method: string): RecordedCall | undefined;
};

function makeDelegate(fake: FakeDb, name: string): ModelDelegate {
  const record = (method: string, args: QueryArgs | undefined) => {
    fake.calls.push({ delegate: name, method, args });
  };

  const nextRow = (): unknown => (fake.rows.length > 0 ? fake.rows.shift() : null);

  return {
    async findMany(args) {
      record("findMany", args);
      return (fake.rows.length > 0 ? fake.rows.splice(0, fake.rows.length) : []) as unknown[];
    },
    async findFirst(args) {
      record("findFirst", args);
      return nextRow();
    },
    async create(args) {
      record("create", args);
      return nextRow();
    },
    async updateMany(args) {
      record("updateMany", args);
      return { count: fake.affected };
    },
    async deleteMany(args) {
      record("deleteMany", args);
      return { count: fake.affected };
    },
    async count(args) {
      record("count", args);
      return fake.rows.length;
    },
  };
}

export function createFakeDb(): FakeDb {
  const calls: RecordedCall[] = [];

  const fake = {
    calls,
    rows: [] as unknown[],
    affected: 1,
    callsTo(delegate: string) {
      return calls.filter((call) => call.delegate === delegate);
    },
    firstCall(method: string) {
      return calls.find((call) => call.method === method);
    },
  } as FakeDb;

  for (const name of DB_DELEGATES) {
    (fake as unknown as Record<string, unknown>)[name] = makeDelegate(fake, name);
  }

  return fake;
}

/** Извлекает `where` из аргументов вызова. */
export function whereOf(call: RecordedCall | undefined): QueryArgs | undefined {
  return call?.args?.where as QueryArgs | undefined;
}

/** Извлекает `data` из аргументов вызова. */
export function dataOf(call: RecordedCall | undefined): QueryArgs | undefined {
  return call?.args?.data as QueryArgs | undefined;
}
