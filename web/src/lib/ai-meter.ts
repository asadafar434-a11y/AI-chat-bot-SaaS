// Бюджет ИИ на заявку и склейка одинаковых запросов. Счёт — в памяти процесса сервера, как у лимитов частоты
// (rate-limit.ts): после перезапуска он начинается заново, на нескольких серверах у каждого свой.
// Хранятся только номер заявки и потраченная сумма — ни документов, ни ответов: сервер их не сохраняет (политика).
// Модуль без зависимостей: его проверяют тесты без сборки (npm test).

const DAY = 24 * 60 * 60 * 1000;

export type Budget = {
  spent: (id: string) => number;
  left: (id: string) => number;
  charge: (id: string, usd: number) => void;
  size: () => number;
};

// limitUsd — сколько можно потратить на одну заявку. Заявку, по которой давно не было запросов, счётчик забывает.
export function createBudget(limitUsd: number, forgetMs = 30 * DAY, now: () => number = Date.now): Budget {
  const spent = new Map<string, { usd: number; at: number }>();
  const sweep = () => {
    const t = now();
    for (const [id, s] of spent) if (s.at <= t - forgetMs) spent.delete(id);
  };
  // Таймер не держит процесс: сервер и тесты завершаются, как без него.
  const timer = setInterval(sweep, DAY);
  (timer as { unref?: () => void }).unref?.();

  const of = (id: string) => {
    const s = spent.get(id);
    return s && s.at > now() - forgetMs ? s.usd : 0;
  };
  return {
    spent: of,
    left: (id) => Math.max(0, limitUsd - of(id)),
    charge: (id, usd) => spent.set(id, { usd: of(id) + Math.max(0, usd), at: now() }),
    size: () => spent.size,
  };
}

// Одинаковые запросы, пришедшие одновременно, — двойной клик, повтор из скрипта, — ждут один ответ модели:
// второй раз за него не платим. Ответ держится только пока идёт запрос, потом ключ забывается.
export function createDedup() {
  const pending = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, fn: () => Promise<T>): { promise: Promise<T>; shared: boolean } {
      const existing = pending.get(key);
      if (existing) return { promise: existing as Promise<T>, shared: true };
      const promise = fn().finally(() => pending.delete(key));
      pending.set(key, promise);
      return { promise, shared: false };
    },
    size: () => pending.size,
  };
}

// Отпечаток запроса для склейки: одинаковый текст — один отпечаток. Не для защиты — только чтобы узнать повтор.
export function requestKey(value: unknown): string {
  const text = JSON.stringify(value);
  let a = 5381;
  let b = 52711;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = (a * 33) ^ c;
    b = (b * 33) ^ c;
  }
  return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}${text.length.toString(36)}`;
}
