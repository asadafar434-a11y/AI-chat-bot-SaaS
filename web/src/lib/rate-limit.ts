// Лимиты частоты запросов. Счёт — в памяти процесса сервера: на одном сервере (next start) этого хватает,
// после перезапуска счёт начинается заново, а на нескольких серверах у каждого свой.
// Главная защита бюджета — месячный лимит расходов в консоли Anthropic (см. README); эти лимиты — от перебора и случайностей.
// Модуль без зависимостей: его проверяют тесты без сборки (npm test).

export type Window = { max: number; ms: number };

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// Запросы к ИИ с одного адреса: требования, ТП, проверка, вопросы, разбор своих документов.
export const AI_PER_IP: Window[] = [
  { max: 60, ms: 10 * MINUTE },
  { max: 400, ms: DAY },
];
// Запросы к ИИ со всех адресов вместе — если адрес подделывают, чтобы обойти лимит на один адрес.
export const AI_TOTAL: Window[] = [{ max: 2000, ms: DAY }];
// Загрузка файлов с одного адреса: файл — отдельный запрос, за раз — до 20 файлов.
export const FILES_PER_IP: Window[] = [
  { max: 100, ms: 10 * MINUTE },
  { max: 600, ms: DAY },
];
// Страницы сканов и фото на распознавание, на всех за сутки: каждая страница — отдельный запрос к ИИ.
export const OCR_PAGES_TOTAL: Window[] = [{ max: 600, ms: DAY }];

// 0 — можно; иначе — через сколько секунд освободится место. cost — сколько единиц берёт запрос (например, страниц).
export type Take = (key: string, cost?: number) => number;

export function createLimiter(windows: Window[], now: () => number = Date.now): Take {
  const hits = new Map<string, number[]>();
  const longest = Math.max(...windows.map((w) => w.ms));
  let calls = 0;
  return (key, cost = 1) => {
    const t = now();
    // Изредка забываем адреса, с которых давно не заходили, — чтобы память не росла.
    if (++calls % 1000 === 0) {
      for (const [k, list] of hits) if (list[list.length - 1] <= t - longest) hits.delete(k);
    }
    const list = (hits.get(key) ?? []).filter((x) => x > t - longest);
    hits.set(key, list);
    for (const w of windows) {
      const inWindow = list.filter((x) => x > t - w.ms);
      const over = inWindow.length + cost - w.max;
      if (over > 0) {
        // Место освободится, когда из окна выйдет столько самых ранних запросов, сколько не хватает.
        const frees = over <= inWindow.length ? inWindow[over - 1] + w.ms : t + w.ms;
        return Math.max(1, Math.ceil((frees - t) / 1000));
      }
    }
    for (let i = 0; i < cost; i++) list.push(t);
    return 0;
  };
}

// Адрес клиента. Обратный прокси хостинга дописывает адрес, с которого к нему пришли, в конец X-Forwarded-For —
// берём последний: начало списка клиент может вписать сам. Без прокси Next.js подставляет адрес соединения.
export function clientIp(forwardedFor: string | null): string {
  return forwardedFor?.split(",").at(-1)?.trim() || "unknown";
}

// «через минуту», «через 7 мин», «через 5 ч»
export function waitText(seconds: number): string {
  if (seconds <= 60) return "через минуту";
  if (seconds < 3600) return `через ${Math.ceil(seconds / 60)} мин`;
  return `через ${Math.ceil(seconds / 3600)} ч`;
}
