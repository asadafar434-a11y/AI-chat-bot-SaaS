/**
 * Постановка задач в pg-boss.
 *
 * Два режима:
 * - `enqueue` — вне транзакции (best-effort: если фоновые задачи выключены,
 *   возвращает `null` и ничего не делает);
 * - `enqueueInTx` — внутри уже открытой Prisma-транзакции через `fromPrisma(tx)`:
 *   задача коммитится вместе с доменной мутацией. Если транзакция откатывается,
 *   задача не появляется — нет ситуации «мутация закоммичена, а job потерян».
 *
 * Оба режима сначала валидируют payload по схеме очереди (лишние поля и
 * секреты отклоняются) и только потом обращаются к pg-boss.
 */

import { fromPrisma } from "pg-boss";
import type { PgBoss } from "pg-boss";

import type { QueueName } from "./queues.ts";
import { getQueueDefinition, validatePayload } from "./queues.ts";
import { ensureBossStarted } from "./boss.ts";

/** Структурный тип транзакционного клиента Prisma, нужный адаптеру pg-boss. */
export type TransactionalClient = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

export type EnqueueOptions = {
  startAfterSeconds?: number;
  priority?: number;
  /** Ключ-«singleton»: не даёт плодить одинаковые задачи в окне антидубля. */
  singletonKey?: string;
};

function policyOptions(name: QueueName, options: EnqueueOptions) {
  const def = getQueueDefinition(name);
  return {
    retryLimit: def.retryPolicy.maxRetries,
    retryDelay: def.retryPolicy.backoffSeconds,
    retryDelayMax: def.retryPolicy.backoffMaxSeconds,
    retryBackoff: true,
    expireInSeconds: def.timeoutSeconds,
    ...(options.startAfterSeconds !== undefined ? { startAfter: options.startAfterSeconds } : {}),
    ...(options.priority !== undefined ? { priority: options.priority } : {}),
    ...(options.singletonKey !== undefined ? { singletonKey: options.singletonKey } : {}),
  };
}

/**
 * Поставить задачу вне транзакции. Возвращает id задачи или `null`,
 * если фоновые задачи выключены.
 */
export async function enqueue(
  name: QueueName,
  payload: unknown,
  options: EnqueueOptions = {},
): Promise<string | null> {
  const validated = validatePayload(name, payload);
  if (!validated.ok) {
    throw new Error(`jobs.enqueue: ${validated.error}`);
  }
  const boss = await ensureBossStarted();
  if (!boss) {
    return null;
  }
  return boss.send(name, validated.data as object, policyOptions(name, options));
}

/**
 * Поставить задачу внутри открытой транзакции. Boss должен быть уже запущен
 * (`ensureBossStarted()` до открытия транзакции): pg-boss нельзя запускать
 * внутри доменной транзакции, он выполняет миграции схемы.
 */
export async function enqueueInTx(
  boss: PgBoss,
  tx: TransactionalClient,
  name: QueueName,
  payload: unknown,
  options: EnqueueOptions = {},
): Promise<string | null> {
  const validated = validatePayload(name, payload);
  if (!validated.ok) {
    throw new Error(`jobs.enqueueInTx: ${validated.error}`);
  }
  return boss.send(name, validated.data as object, {
    ...policyOptions(name, options),
    db: fromPrisma(tx),
  });
}
