/**
 * Конфигурация фоновых задач S8 (pg-boss) из окружения.
 *
 * Переменные:
 * - `JOBS_ENABLED` — 1 включает фоновую обработку; по умолчанию выключена,
 *   чтобы новый путь не включился незаметно в production;
 * - `JOBS_DATABASE_URL` — соединение с БД (по умолчанию `DATABASE_URL`);
 * - `JOBS_SCHEMA` — схема pg-boss (по умолчанию `pgboss`);
 * - `JOBS_POLL_INTERVAL_MS` — базовый интервал опроса (по умолчанию 2000);
 * - `JOBS_MAX_RETRIES` — лимит попыток по умолчанию (по умолчанию 3).
 *
 * Модуль чистый: только вычисления, без обращений к pg-boss и БД.
 */

export type JobsConfig = {
  enabled: boolean;
  databaseUrl: string;
  schema: string;
  pollIntervalMs: number;
  maxRetries: number;
};

export const DEFAULT_POLL_INTERVAL_MS = 2000;
export const MIN_POLL_INTERVAL_MS = 500;
export const DEFAULT_MAX_RETRIES = 3;
export const MAX_MAX_RETRIES = 10;

export function jobsConfigFromEnv(env: Record<string, string | undefined> = process.env): JobsConfig {
  const enabled = env.JOBS_ENABLED === "1";
  const databaseUrl = (env.JOBS_DATABASE_URL ?? env.DATABASE_URL ?? "").trim();
  const schema = (env.JOBS_SCHEMA ?? "pgboss").trim() || "pgboss";

  const pollRaw = Number(env.JOBS_POLL_INTERVAL_MS);
  const pollIntervalMs = Number.isFinite(pollRaw)
    ? Math.min(Math.max(MIN_POLL_INTERVAL_MS, Math.floor(pollRaw)), 3_600_000)
    : DEFAULT_POLL_INTERVAL_MS;

  const retriesRaw = Number(env.JOBS_MAX_RETRIES);
  const maxRetries = Number.isFinite(retriesRaw)
    ? Math.min(Math.max(0, Math.floor(retriesRaw)), MAX_MAX_RETRIES)
    : DEFAULT_MAX_RETRIES;

  return { enabled, databaseUrl, schema, pollIntervalMs, maxRetries };
}
