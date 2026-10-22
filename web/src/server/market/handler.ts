import "server-only";
import { analogsFrom, MARKET_METHOD, marketStats, normalizeUnit, tokensOf, type MarketStats } from "@/lib/market-observations";
import type { Analog } from "@/lib/indicative-price";
import { parseMarketRequest } from "@/lib/market-request";
import type { MarketStore } from "@/lib/market-store";
import { badRequest, readJson } from "@/lib/read-json";
import { moscowDay } from "@/lib/registry-types";

// Обработчик «рыночный ориентир по позициям»: из общей базы наблюдений берёт сопоставимые цены и считает среднее, медиану, диапазон, динамику и регионы — только при достаточных данных.
// Отдельно от файла маршрута, чтобы проверять без сервера и базы. Запрос бесплатный (ИИ не вызывается); база открытая, но вход нужен, как у остальных маршрутов.

export type MarketDeps = {
  authorize: (request: Request) => Promise<Response | null>;
  /** Хранилище наблюдений; бросает, если базы нет. */
  getStore: () => MarketStore;
  hasDatabase: () => boolean;
  now?: () => Date;
};

export type MarketResult = { key: string; stats: MarketStats; analogs: Analog[] };

const plain = (message: string, status: number) => new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
const CANDIDATES = 2000;
const DAY = 86_400_000;

export async function handleMarket(request: Request, deps: MarketDeps): Promise<Response> {
  const denied = await deps.authorize(request);
  if (denied) return denied;
  const body = await readJson(request);
  if (!body) return badRequest();
  const parsed = parseMarketRequest(body);
  if (!parsed.ok) return plain(parsed.error, 400);
  if (!deps.hasDatabase()) return plain("База цен не подключена на этом сервере — рыночный ориентир посчитать нельзя.", 503);

  const now = deps.now?.() ?? new Date();
  const onDate = parsed.value.onDate ?? moscowDay(now.toISOString());
  // Динамике нужны цены за полтора года до даты расчёта; остальное считается по окну.
  const since = new Date(Date.parse(`${onDate}T00:00:00Z`) - (MARKET_METHOD.recentDays + MARKET_METHOD.earlierDays) * DAY).toISOString().slice(0, 10);
  try {
    const store = deps.getStore();
    const total = await store.count();
    const results: MarketResult[] = [];
    for (const { key, target } of parsed.value.positions) {
      const found = await store.candidates({ unit: normalizeUnit(target.unit ?? ""), tokens: tokensOf(target.name), since, until: onDate, limit: CANDIDATES });
      let n = 0;
      results.push({ key, stats: marketStats(target, found, onDate), analogs: analogsFrom(target, found, onDate, () => `market-${++n}`) });
    }
    return Response.json({ asOf: onDate, total, results });
  } catch (error) {
    // Причину пишем в журнал сервера без значений запроса; браузеру — только понятный текст.
    console.error("market stats failed:", error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : "unknown");
    return plain("База цен сейчас недоступна — попробуйте позже.", 503);
  }
}
