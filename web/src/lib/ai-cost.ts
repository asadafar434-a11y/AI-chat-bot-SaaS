// Сколько стоит запрос к ИИ и сколько дорогих операций можно на одну заявку.
// Модуль без зависимостей, кроме цен сервиса: его проверяют тесты без сборки (npm test), и он же нужен браузеру —
// показать, сколько пересчётов осталось.
import { RECHECK_PACK } from "@/lib/pricing";

// Цены Anthropic за миллион токенов, в долларах: https://platform.claude.com/docs/en/about-claude/pricing
// Запись в кеш — 1,25 цены входа на 5 минут и 2 цены входа на час. Чтение из кеша у Opus 5.5 и Sonnet 5.5 —
// $0,20, у Fable 5.1 — $0,25, у остальных — десятая часть цены входа.
// Кроме основной модели здесь те, на которые запрос может уйти при отказе основной (fallbacks: "default").
export type Prices = { input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number };

const row = (input: number, output: number, cacheRead: number): Prices => ({
  input,
  output,
  cacheRead,
  cacheWrite5m: input * 1.25,
  cacheWrite1h: input * 2,
});

export const PRICES: Record<string, Prices> = {
  "claude-opus-5-5": row(4, 20, 0.2),
  "claude-opus-5": row(5, 25, 0.5),
  "claude-opus-4-8": row(5, 25, 0.5),
  "claude-sonnet-5-5": row(2, 10, 0.2),
  "claude-fable-5-1": row(10, 50, 0.25),
};

// Модели нет в таблице — считаем по самой дорогой из известных: бюджет лучше переоценить, чем недосчитать.
const PRICIEST = Object.values(PRICES).reduce((a, b) => (b.output > a.output ? b : a));

// Поля usage из ответа модели. input_tokens — только то, что прочитано не из кеша.
export type AiUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null;
};

// Стоимость одного ответа модели в долларах. known — нашлась ли модель в таблице цен.
export function costUsd(model: string, u: AiUsage): { usd: number; known: boolean } {
  const known = model in PRICES;
  const p = known ? PRICES[model] : PRICIEST;
  const written = u.cache_creation_input_tokens ?? 0;
  const w5m = u.cache_creation?.ephemeral_5m_input_tokens ?? 0;
  // Без разбивки по сроку — считаем запись по цене часового кеша: так не недосчитаем.
  const w1h = u.cache_creation ? (u.cache_creation.ephemeral_1h_input_tokens ?? 0) : written;
  const tokens =
    u.input_tokens * p.input +
    u.output_tokens * p.output +
    (u.cache_read_input_tokens ?? 0) * p.cacheRead +
    w5m * p.cacheWrite5m +
    w1h * p.cacheWrite1h;
  return { usd: tokens / 1_000_000, known };
}

// Рубли — по курсу из настроек сервера: курс меняется, в код он не зашит.
export const rubOf = (usd: number, usdRub: number) => Math.round(usd * usdRub * 100) / 100;

export const usdText = (usd: number) => `$${usd.toFixed(usd < 0.01 ? 4 : 2)}`;

// Дорогие операции ИИ на одну заявку. Пересчёт проверки — 3 раза: исправления в документах видны и без него.
// Кончились — можно докупить пакет: ещё 3 за 99 ₽ (packs — сколько пакетов куплено для этой заявки).
// Новая версия документов — 3 раза без вопросов, дальше — только если участник подтвердил, что она нужна.
export const AI_LIMITS = { rechecks: 3, generations: 3 } as const;

export function recheckState(used: number, packs = 0): { left: number; allowed: boolean; total: number } {
  const total = AI_LIMITS.rechecks + Math.max(0, packs) * RECHECK_PACK.count;
  const left = Math.max(0, total - used);
  return { left, allowed: left > 0, total };
}

export const regenerationNeedsConfirm = (done: number) => done >= AI_LIMITS.generations;
