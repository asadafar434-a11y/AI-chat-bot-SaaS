/**
 * Тестовые хелперы S8: реальный pg-boss на TEST PostgreSQL.
 *
 * Каждый тест получает свою схему (`test_jobs_<random>`), чтобы прогоны не
 * конфликтовали. Схему удаляет сам тест после остановки boss.
 */

import { randomBytes } from "node:crypto";
import { PgBoss } from "pg-boss";

import { ensureQueues } from "../boss.ts";

export function testDatabaseUrl(): string | null {
  return process.env.TEST_DATABASE_URL ?? null;
}

export async function startTestBoss(databaseUrl: string): Promise<{ boss: PgBoss; schema: string }> {
  const schema = `test_jobs_${randomBytes(6).toString("hex")}`;
  const boss = new PgBoss({ connectionString: databaseUrl, schema });
  await boss.start();
  await ensureQueues(boss);
  return { boss, schema };
}

/** Поднять boss на существующей схеме (сценарий перезапуска/durability). */
export async function startTestBossWithSchema(databaseUrl: string, schema: string): Promise<{ boss: PgBoss; schema: string }> {
  const boss = new PgBoss({ connectionString: databaseUrl, schema });
  await boss.start();
  await ensureQueues(boss);
  return { boss, schema };
}

/** Ждёт выполнения условия; иначе — ошибка по таймауту. */
export async function waitFor(
  condition: () => Promise<boolean> | boolean,
  timeoutMs = 30_000,
  intervalMs = 150,
): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (await condition()) {
      return;
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`waitFor: условие не выполнено за ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
