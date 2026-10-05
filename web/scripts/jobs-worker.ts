/**
 * Процесс-воркер S8. Запускается отдельно от Next.js:
 *
 *   npm run jobs:worker
 *
 * Воркер поднимает pg-boss на `JOBS_DATABASE_URL` (или `DATABASE_URL`),
 * регистрирует обработчики и ждёт задачи. По SIGTERM/SIGINT — корректная
 * остановка: pg-boss дожидается активных задач и возвращает взятые, но
 * незавершённые задачи в очередь (at-least-once delivery).
 *
 * Секреты (БД, storage) берутся из окружения и не логируются.
 */

import { startBoss, stopBoss } from "../src/server/jobs/boss.ts";
import { jobsConfigFromEnv } from "../src/server/jobs/config.ts";
import { registerAllHandlers } from "../src/server/jobs/worker.ts";

async function main(): Promise<void> {
  const config = jobsConfigFromEnv();
  if (!config.databaseUrl) {
    throw new Error("jobs: не задан JOBS_DATABASE_URL или DATABASE_URL");
  }

  const boss = await startBoss(config);
  await registerAllHandlers(boss);
  console.info(JSON.stringify({ event: "jobs.worker.ready", schema: config.schema }));

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;
    console.info(JSON.stringify({ event: "jobs.worker.shutdown", signal }));
    await stopBoss();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: "jobs.worker.fatal",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
