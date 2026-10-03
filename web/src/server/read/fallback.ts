/**
 * Контролируемый fallback чтения (этап S4, контракт для будущего переключения UI).
 *
 * Правила:
 * - отсутствие серверных данных — не ошибка автоматически: вызывается legacy-путь;
 * - fallback всегда явный: результат тегирован источником, причина — в `note`;
 * - смешивание источников запрещено: возвращается либо сервер, либо legacy, никогда их смесь;
 * - каждое срабатывание логируется одной JSON-строкой без персональных данных
 *   (только событие, источник и счётчики).
 *
 * Потребителя в production пока нет: legacy-пути не тронуты, флаг выключен.
 * Модуль зафиксирован тестами как контракт переключения.
 */

export type ReadSource = "postgres" | "indexeddb" | "none";

export type Sourced<T> = {
  source: ReadSource;
  data: T | null;
  note: string;
};

export type FallbackLog = (line: string) => void;

const defaultLog: FallbackLog = (line) => {
  console.info(line);
};

function logged(log: FallbackLog, event: string, detail: Record<string, unknown>): void {
  log(JSON.stringify({ event, ...detail }));
}

/**
 * Чтение с явным fallback. Пустота сервера — это `null` или пустой массив;
 * исключение сервера — тоже fallback, а не падение (сервер мог быть недоступен,
 * а данные в браузере целы). Смесь источников не возвращается никогда.
 */
export async function withFallback<T>(args: {
  server: () => Promise<T | null>;
  legacy: () => Promise<T | null>;
  isEmpty: (data: T) => boolean;
  describe: (data: T) => Record<string, unknown>;
  log?: FallbackLog;
}): Promise<Sourced<T>> {
  const log = args.log ?? defaultLog;
  let serverData: T | null = null;
  let serverFailed = false;
  try {
    serverData = await args.server();
  } catch (error) {
    serverFailed = true;
    logged(log, "read-fallback", {
      source: "postgres",
      outcome: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (!serverFailed && serverData !== null && !args.isEmpty(serverData)) {
    return { source: "postgres", data: serverData, note: "postgres" };
  }
  if (!serverFailed) {
    logged(log, "read-fallback", { source: "postgres", outcome: "empty" });
  }
  const legacyData = await args.legacy();
  if (legacyData !== null && !args.isEmpty(legacyData)) {
    logged(log, "read-fallback", { source: "indexeddb", outcome: "used", ...args.describe(legacyData) });
    return { source: "indexeddb", data: legacyData, note: serverFailed ? "postgres-error" : "postgres-empty" };
  }
  return { source: "none", data: null, note: "both-empty" };
}
