/**
 * Регистрация обработчиков у pg-boss worker-процесса.
 *
 * Воркер запускается отдельным процессом (scripts/jobs-worker.ts). Ниже —
 * общая регистрация: на каждую очередь из реестра ставится обработчик с
 * `perJobResults: true`, что позволяет различать три исхода:
 * - `completed` — задача успешно выполнена;
 * - `failed` — повторяемая ошибка, pg-boss повторит с backoff;
 * - `deadletter` — терминальный отказ, повторов не будет.
 */

import type { JobResult, PgBoss } from "pg-boss";

import type { JobOutcome } from "./handlers.ts";
import { JOB_HANDLERS } from "./handlers.ts";
import type { QueueName } from "./queues.ts";
import { getQueueDefinition, isRetryable } from "./queues.ts";

type AnyHandler = (job: { id: string; data: unknown }) => Promise<JobOutcome>;

/** Переопределения политики для тестов (production берёт значения из реестра). */
export type WorkPolicyOverrides = {
  retryLimit?: number;
  retryDelay?: number;
  retryDelayMax?: number;
  pollingIntervalSeconds?: number;
};

function log(event: string, data: Record<string, unknown>): void {
  console.info(JSON.stringify({ event, ...data }));
}

/** Регистрирует один обработчик на очередь. */
export async function registerJobHandler(
  boss: PgBoss,
  queue: QueueName,
  handler: AnyHandler,
  overrides: WorkPolicyOverrides = {},
): Promise<void> {
  const def = getQueueDefinition(queue);

  await boss.work(
    queue,
    {
      batchSize: 1,
      pollingIntervalSeconds: overrides.pollingIntervalSeconds ?? Math.ceil(def.pollIntervalMs / 1000),
      retryLimit: overrides.retryLimit ?? def.retryPolicy.maxRetries,
      retryDelay: overrides.retryDelay ?? def.retryPolicy.backoffSeconds,
      retryDelayMax: overrides.retryDelayMax ?? def.retryPolicy.backoffMaxSeconds,
      retryBackoff: true,
      expireInSeconds: def.timeoutSeconds,
      concurrency: def.concurrency,
      perJobResults: true,
    },
    async (jobs) => {
      const results: JobResult[] = [];
      for (const job of jobs) {
        const startedAt = Date.now();
        try {
          const outcome = await handler(job as { id: string; data: unknown });
          if (outcome.status === "completed") {
            log("jobs.job.completed", { queue, jobId: job.id, durationMs: Date.now() - startedAt });
            results.push({ id: job.id, status: "completed", output: outcome.output ?? {} });
          } else {
            log("jobs.job.permanent", { queue, jobId: job.id, error: outcome.error });
            results.push({ id: job.id, status: "deadletter", output: { error: outcome.error } });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (isRetryable(error)) {
            log("jobs.job.retry", { queue, jobId: job.id, error: message });
            results.push({ id: job.id, status: "failed", output: { error: message } });
          } else {
            log("jobs.job.permanent", { queue, jobId: job.id, error: message });
            results.push({ id: job.id, status: "deadletter", output: { error: message } });
          }
        }
      }
      return results;
    },
  );
}

/** Регистрирует все обработчики реестра. */
export async function registerAllHandlers(boss: PgBoss): Promise<void> {
  for (const [queue, handler] of Object.entries(JOB_HANDLERS) as [QueueName, AnyHandler][]) {
    await registerJobHandler(boss, queue, handler);
    log("jobs.worker.registered", { queue });
  }
}
