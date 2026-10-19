// Лимиты частоты запросов и бюджет ИИ на заявку, общие для нескольких серверов. Пункт 18 списка «Чего продукт пока не умеет».
//
// По умолчанию ничего не меняется: счёт идёт в памяти сервера (rate-limit.ts, ai-meter.ts), как и раньше — одному серверу этого хватает.
// Когда серверов больше одного, в настройках сервера включают SHARED_LIMITS=db: счёт ведётся в таблицах RateHit и AiSpend базы PostgreSQL,
// и все серверы видят общий. Если база не ответила, запрос не блокируется: сервер считает у себя в памяти и пишет об этом в журнал один раз.
// Модуль без зависимостей от базы и сервера: хранилище подставляют снаружи (server/db/shared-limits-store.ts), тесты — своим.

import { createBudget, type Budget } from "./ai-meter.ts";
import { createLimiter, waitFor, type Take, type Window } from "./rate-limit.ts";

// Атомарно: 0 и запись cost запросов — можно; иначе секунды ожидания, ничего не записано.
export type HitStore = {
  take(bucket: string, key: string, windows: Window[], cost: number, now: number): Promise<number>;
};

export type SpendStore = {
  spent(appId: string): Promise<number>;
  charge(appId: string, usd: number): Promise<void>;
};

export type AsyncTake = (key: string, cost?: number) => Promise<number>;

// Хранилище, которое выдаёт настройка сервера; null — общий счёт не включён, считаем в памяти.
export type StoreSource<T> = () => Promise<T | null>;

// Общий счёт включён настройкой сервера. Всё, кроме «db», — как сегодня, в памяти.
export const sharedLimitsOn = (env: Record<string, string | undefined> = process.env) => env.SHARED_LIMITS === "db";

const reported = new Set<string>();
function reportOnce(what: string, error: unknown, log: (message: string) => void) {
  if (reported.has(what)) return;
  reported.add(what);
  log(`[лимиты] ${what}: база не ответила, считаем в памяти этого сервера (${error instanceof Error ? error.message : String(error)})`);
}

// Хранилище лимитов в памяти: то же правило, что у createLimiter, и тот же интерфейс, что у базы. Нужно тестам и как образец.
export function memoryHitStore(): HitStore {
  const hits = new Map<string, number[]>();
  return {
    async take(bucket, key, windows, cost, now) {
      const id = `${bucket}\u0000${key}`;
      const longest = Math.max(...windows.map((w) => w.ms));
      const list = (hits.get(id) ?? []).filter((x) => x > now - longest);
      const wait = waitFor(list, windows, cost, now);
      if (wait > 0) {
        hits.set(id, list);
        return wait;
      }
      for (let i = 0; i < cost; i++) list.push(now);
      hits.set(id, list);
      return 0;
    },
  };
}

export function sharedLimiter(
  bucket: string,
  windows: Window[],
  source: StoreSource<HitStore>,
  { now = Date.now, log = console.warn }: { now?: () => number; log?: (message: string) => void } = {},
): AsyncTake {
  const local: Take = createLimiter(windows, now);
  return async (key, cost = 1) => {
    let store: HitStore | null = null;
    try {
      store = await source();
    } catch (e) {
      reportOnce(bucket, e, log);
    }
    if (!store) return local(key, cost);
    try {
      return await store.take(bucket, key, windows, cost, now());
    } catch (e) {
      reportOnce(bucket, e, log);
      return local(key, cost);
    }
  };
}

export type AsyncBudget = {
  // Сколько уже потрачено на заявку, в долларах.
  spent: (appId: string) => Promise<number>;
  left: (appId: string) => Promise<number>;
  // Сколько потратил этот сервер, без обращения к базе: для строки журнала.
  spentHere: (appId: string) => number;
  // Записать расход. Общая запись не ждёт ответа базы: не задерживаем ответ участнику, а свой счёт обновляется сразу.
  charge: (appId: string, usd: number) => void;
};

export function sharedBudget(
  limitUsd: number,
  source: StoreSource<SpendStore>,
  { log = console.warn }: { log?: (message: string) => void } = {},
): AsyncBudget {
  const local: Budget = createBudget(limitUsd);
  const spent = async (appId: string): Promise<number> => {
    const mine = local.spent(appId);
    try {
      const store = await source();
      if (!store) return mine;
      // Другой сервер мог потратить больше, чем этот: берём большее — бюджет лучше недорасходовать, чем превысить.
      return Math.max(mine, await store.spent(appId));
    } catch (e) {
      reportOnce("бюджет ИИ", e, log);
      return mine;
    }
  };
  return {
    spent,
    spentHere: (appId) => local.spent(appId),
    left: async (appId) => Math.max(0, limitUsd - (await spent(appId))),
    charge: (appId, usd) => {
      local.charge(appId, usd);
      void (async () => {
        try {
          const store = await source();
          if (store) await store.charge(appId, Math.max(0, usd));
        } catch (e) {
          reportOnce("бюджет ИИ", e, log);
        }
      })();
    },
  };
}
