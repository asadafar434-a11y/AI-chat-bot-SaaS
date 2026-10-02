/**
 * Граница транзакции, не зависящая от Prisma.
 *
 * Операции, которые обязаны быть атомарными (принятие приглашения, сброс пароля),
 * принимают `TransactionRunner` параметром. Так доменная логика не импортирует рантайм
 * Prisma и проверяется на фейке, а реальный запуск транзакции остаётся в одном месте —
 * `server/db/client.ts`.
 */

import type { DbClient } from "../db/db-client.ts";

export type TransactionRunner = <T>(fn: (db: DbClient) => Promise<T>) => Promise<T>;

/**
 * Прогон без настоящей транзакции. Используется в тестах и там, где атомарность
 * обеспечивается единственным запросом; продакшн передаёт runner из `client.ts`.
 */
export function withRunner(db: DbClient): TransactionRunner {
  return (fn) => fn(db);
}
