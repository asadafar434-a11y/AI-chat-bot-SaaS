/**
 * Фабрика клиента Prisma. Единственный файл слоя хранения, который импортирует
 * `@prisma/client` в рантайме.
 *
 * Правила, зафиксированные контрактом:
 * - клиент **ленивый**: он не создаётся на импорте модуля. Иначе `next build` и любой
 *   скрипт, импортирующий серверный слой, попытались бы поднять соединение с БД, а
 *   подключение к БД на этапе S1 ещё не существует и в production не появится раньше S2;
 * - соединение не проверяется при создании (`lazyConnect` не используется, соединение
 *   устанавливается первым запросом), поэтому отсутствие БД не роняет процесс импорта;
 * - в development соединение переоткрывается при изменении файлов схемы; в production
 *   этого не требуется, потому что миграции применяются отдельным шагом;
 * - `DATABASE_URL` не подставляется из кода: его читает Prisma из окружения, секрет не
 *   проходит через приложение и не может попасть в бандл.
 *
 * Этап S1: этот модуль нигде не импортируется приложением. Маршруты и страницы
 * продолжают работать с IndexedDB.
 */

import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import type { DbClient } from "./db-client.ts";
import { assertDbClient } from "./db-client.ts";
import type { TransactionRunner } from "../auth/transaction.ts";

/** Тип реального клиента Prisma — тот же, что использует сгенерированный код. */
export type PrismaDbClient = PrismaClient;

let cached: PrismaDbClient | null = null;

/**
 * Создаёт новый экземпляр клиента. Каждый вызов даёт независимое соединение —
 * используется в интеграционных тестах и в скриптах миграции.
 */
export function createPrismaClient(): PrismaDbClient {
  const logLevel = process.env.DATABASE_LOG_LEVEL;
  const log: Prisma.LogLevel[] =
    logLevel === "info" || logLevel === "warn" || logLevel === "error" ? [logLevel] : ["warn"];

  return new PrismaClient({ log });
}

/**
 * Возвращает разделяемый экземпляр клиента, создавая его при первом обращении.
 * В production переиспользование одного клиента обязательно: без него Next.js создавал
 * бы новое пул-соединение на каждый запрос.
 */
export function getPrismaClient(): PrismaDbClient {
  if (!cached) {
    cached = createPrismaClient();
  }
  return cached;
}

/**
 * Отдаёт клиент в виде структурного `DbClient`, который понимают репозитории.
 * Проверка состава выполняется здесь: отсутствие делегата обнаруживается при подключении,
 * а не при первом обращении к конкретной таблице.
 */
export function getDb(): DbClient {
  const client: DbClient = getPrismaClient() as unknown as DbClient;
  assertDbClient(client);
  return client;
}

/** Закрывает соединение разделяемого клиента. Вызывается при завершении процесса и в тестах. */
export async function disconnectPrisma(): Promise<void> {
  if (cached) {
    await cached.$disconnect();
    cached = null;
  }
}

/**
 * Граница интерактивной транзакции для операций, которые обязаны быть атомарными:
 * принятие приглашения и сброс пароля. Клиент передаётся в колбэк уже как `DbClient`,
 * поэтому доменный код не знает про Prisma, а транзакция открывается здесь.
 */
export function getTransactionRunner(): TransactionRunner {
  const prisma = getPrismaClient();
  return <T>(fn: (db: DbClient) => Promise<T>): Promise<T> =>
    prisma.$transaction((tx) => fn(tx as unknown as DbClient));
}
