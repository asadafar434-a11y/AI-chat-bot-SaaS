import "server-only";
import { createRostenderClient } from "@/server/rostender/client";
import { createTenderStore, type TenderDb, type TenderStore } from "@/server/rostender/store";
import { syncTenders, type SyncResult } from "@/server/rostender/sync";

// Расписание: сервер сам раз в сутки обновляет закупки. Раз в час проверяется, давно ли было последнее обновление (по самой свежей отметке в базе);
// если прошло больше 20 часов — запускается загрузка. Запуск один на процесс; параллельно две загрузки не идут.

export const SYNC_EVERY_MS = 60 * 60 * 1000;
export const SYNC_STALE_MS = 20 * 60 * 60 * 1000;
const FIRST_DELAY_MS = 20_000;

/** Сегодняшняя дата по Москве, ГГГГ-ММ-ДД. */
export const moscowToday = (now = new Date()): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

export type ScheduleDeps = { run: () => Promise<SyncResult>; store: TenderStore; now?: () => number };

let running = false;
let lastRun = 0;

/** Один проход проверки: обновляет, только если пора. Возвращает результат загрузки или null, если ничего не делали. */
export async function tickTenderSync(deps: ScheduleDeps): Promise<SyncResult | null> {
  if (running) return null;
  const now = (deps.now ?? Date.now)();
  if (lastRun && now - lastRun < SYNC_STALE_MS) return null;
  running = true;
  try {
    const last = await deps.store.lastSyncAt();
    if (last && now - last.getTime() < SYNC_STALE_MS) return null;
    lastRun = now;
    return await deps.run();
  } finally {
    running = false;
  }
}

/** Только для проверок. */
export function resetTenderSyncState() {
  running = false;
  lastRun = 0;
}

const G = globalThis as unknown as { __tenderSyncTimer?: ReturnType<typeof setInterval> };

/** Запуск расписания при старте сервера. Без ключа Ростендера и без базы ничего не делает. */
export async function startTenderSync(): Promise<void> {
  const key = process.env.ROSTENDER_API_KEY?.trim();
  if (!key || !process.env.DATABASE_URL || G.__tenderSyncTimer) return;
  const { getPrismaClient } = await import("@/server/db/client");
  const store = createTenderStore(getPrismaClient() as unknown as TenderDb);
  const client = createRostenderClient({ apiKey: key });
  const tick = () =>
    tickTenderSync({ store, run: () => syncTenders({ client, store, today: moscowToday() }) })
      .then((r) => {
        if (r) console.info(`tenders sync: новых ${r.added}, убрано ${r.removed}, запросов ${r.spent}, остаток ${r.remaining ?? "?"}${r.note ? ` — ${r.note}` : ""}`);
      })
      .catch((error) => console.error("tenders sync failed:", error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : "unknown"));
  setTimeout(tick, FIRST_DELAY_MS).unref?.();
  G.__tenderSyncTimer = setInterval(tick, SYNC_EVERY_MS);
  G.__tenderSyncTimer.unref?.();
}
