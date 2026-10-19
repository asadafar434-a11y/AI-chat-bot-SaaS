// Хранилище лимитов частоты запросов и бюджета ИИ в PostgreSQL — общий счёт для нескольких серверов (включается SHARED_LIMITS=db).
// Таблицы RateHit и AiSpend — prisma/migrations/20261019120000_s14_shared_limits. Логика окон — та же, что в памяти (rate-limit.ts, waitFor).
//
// Проверено тестом с подставным клиентом (порядок запросов, блокировка по ключу, запись только когда можно): живую базу из этого окружения не поднять.
// При выкладке с несколькими серверами — проверить на настоящей базе (docs/stage-11, раздел о лимитах).

import type { HitStore, SpendStore } from "../../lib/shared-limits.ts";
import { waitFor, type Window } from "../../lib/rate-limit.ts";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// Самое длинное окно лимитов — сутки. Строки старше уходят, даже если с этого ключа больше не заходили.
const KEEP_MS = DAY + HOUR;
const SWEEP_EVERY = 500;
// Бюджет заявки, по которой давно не было запросов, забываем — как в памяти (ai-meter.ts, 30 суток: interval '30 days' в запросах ниже).

// Только то, что нужно от клиента Prisma: тестам достаточно подставного.
export type RawTx = {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
};
export type RawClient = RawTx & { $transaction<T>(fn: (tx: RawTx) => Promise<T>): Promise<T> };

export function prismaHitStore(client: RawClient): HitStore {
  let calls = 0;
  return {
    async take(bucket: string, key: string, windows: Window[], cost: number, now: number): Promise<number> {
      const longest = Math.max(...windows.map((w) => w.ms));
      const wait = await client.$transaction(async (tx) => {
        // Один ключ — по одному запросу за раз: блокировка до конца транзакции, иначе два сервера одновременно увидят свободное место.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${bucket}:${key}`}, 0))`;
        await tx.$executeRaw`DELETE FROM "RateHit" WHERE "bucket" = ${bucket} AND "key" = ${key} AND "at" <= ${new Date(now - longest)}`;
        const rows = await tx.$queryRaw<{ at: Date }[]>`SELECT "at" FROM "RateHit" WHERE "bucket" = ${bucket} AND "key" = ${key} ORDER BY "at"`;
        const need = waitFor(
          rows.map((r) => new Date(r.at).getTime()),
          windows,
          cost,
          now,
        );
        if (need > 0) return need;
        await tx.$executeRaw`INSERT INTO "RateHit" ("bucket", "key", "at") SELECT ${bucket}, ${key}, ${new Date(now)} FROM generate_series(1, ${cost}::int)`;
        return 0;
      });
      // Раз в SWEEP_EVERY запросов убираем строки, которые уже никому не нужны.
      if (++calls % SWEEP_EVERY === 0) {
        await client.$executeRaw`DELETE FROM "RateHit" WHERE "at" < ${new Date(now - KEEP_MS)}`;
      }
      return wait;
    },
  };
}

export function prismaSpendStore(client: RawClient): SpendStore {
  let calls = 0;
  return {
    async spent(appId: string): Promise<number> {
      const rows = await client.$queryRaw<{ usd: number }[]>`SELECT "usd" FROM "AiSpend" WHERE "appId" = ${appId} AND "updatedAt" > now() - interval '30 days'`;
      return rows[0] ? Number(rows[0].usd) : 0;
    },
    async charge(appId: string, usd: number): Promise<void> {
      // Прибавляем в самой базе (а не «прочитал, сложил, записал»): два сервера не затрут друг друга. Давно забытую заявку начинаем с нуля.
      await client.$executeRaw`INSERT INTO "AiSpend" ("appId", "usd", "updatedAt") VALUES (${appId}, ${usd}, now())
        ON CONFLICT ("appId") DO UPDATE SET
          "usd" = (CASE WHEN "AiSpend"."updatedAt" > now() - interval '30 days' THEN "AiSpend"."usd" ELSE 0 END) + EXCLUDED."usd",
          "updatedAt" = now()`;
      if (++calls % SWEEP_EVERY === 0) {
        await client.$executeRaw`DELETE FROM "AiSpend" WHERE "updatedAt" < now() - interval '30 days'`;
      }
    },
  };
}
