/**
 * Жизненный цикл pg-boss (синглтон процесса).
 *
 * Разделение обязанностей по процессам (architecture.md):
 * - процесс `app` (Next.js) поднимает boss только чтобы **ставить** задачи;
 * - отдельный процесс `worker` (scripts/jobs-worker.ts) поднимает boss и
 *   регистрирует обработчики.
 *
 * Оба процесса делят одну БД и схему `pgboss`. Boss не стартует из UI и не
 * привязан к HTTP-запросу: `ensureBossStarted()` идемпотентен и стартует один
 * раз на процесс при первом enqueue, только если флаг включён.
 */

import { PgBoss } from "pg-boss";

import type { JobsConfig } from "./config.ts";
import { jobsConfigFromEnv } from "./config.ts";
import { QUEUE_NAMES } from "./queues.ts";

let instance: PgBoss | null = null;
let started = false;

/**
 * Создаёт очереди реестра, если их ещё нет. pg-boss v12 требует существующую
 * очередь до `send`, поэтому это делается при любом старте boss (и producer,
 * и worker). Идемпотентно.
 */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const name of QUEUE_NAMES) {
    const existing = await boss.getQueue(name);
    if (!existing) {
      await boss.createQueue(name);
    }
  }
}

function createBoss(config: JobsConfig): PgBoss {
  const boss = new PgBoss({ connectionString: config.databaseUrl, schema: config.schema });
  boss.on("error", (error: Error) => {
    console.error(JSON.stringify({ event: "jobs.boss.error", message: error.message }));
  });
  return boss;
}

/** Создаёт/возвращает синглтон, не запуская соединение. */
export function getBoss(config?: JobsConfig): PgBoss {
  if (!instance) {
    instance = createBoss(config ?? jobsConfigFromEnv());
  }
  return instance;
}

/**
 * Гарантирует, что boss запущен, если фоновые задачи включены.
 * Возвращает `null`, когда `JOBS_ENABLED` не задан: тогда enqueue — no-op,
 * и новый путь не включается в production незаметно.
 */
export async function ensureBossStarted(config?: JobsConfig): Promise<PgBoss | null> {
  const resolved = config ?? jobsConfigFromEnv();
  if (!resolved.enabled) {
    return null;
  }
  const boss = getBoss(resolved);
  if (!started) {
    await boss.start();
    await ensureQueues(boss);
    started = true;
  }
  return boss;
}

/** Явный старт (worker-процесс и тесты). Возвращает boss независимо от флага. */
export async function startBoss(config?: JobsConfig): Promise<PgBoss> {
  const boss = getBoss(config);
  if (!started) {
    await boss.start();
    await ensureQueues(boss);
    started = true;
  }
  return boss;
}

/** Graceful shutdown: дождаться активных задач и закрыть соединение. */
export async function stopBoss(): Promise<void> {
  if (instance && started) {
    await instance.stop({ graceful: true });
  }
  instance = null;
  started = false;
}

/** Только для тестов: сбросить синглтон между прогонами. */
export function resetBossForTests(): void {
  instance = null;
  started = false;
}
