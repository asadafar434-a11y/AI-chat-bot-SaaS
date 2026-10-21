import "server-only";
import { duckDuckGoUrl, parseDuckDuckGoHtml, PROVIDER_NAMES, type ProviderId, type SearchHit } from "@/lib/web-search";

// Запрос в поисковый сервис от имени сервера: участник видит только результаты, а сервис — только ключевые слова (lib/web-search.ts: cleanQuery). Пробный бесплатный поиск (DuckDuckGo) — временный:
// у него нет ключа и договора, он может отказать или попросить подтвердить, что запрос делает человек. Боевой — российский сервис по ключу (SEARCH_PROVIDER, решение владельца: серверы и сервисы в РФ).
// Одинаковый запрос в течение часа берётся из памяти, частота ограничена, пустой ответ в память не кладётся (его причиной может быть временный отказ).

export class SearchError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type SearchOutcome = { provider: ProviderId; providerName: string; hits: SearchHit[]; cached: boolean; at: string };

export type SearcherOptions = {
  fetcher?: typeof fetch;
  now?: () => number;
  provider?: string;
  ttlMs?: number;
  perMinute?: number;
  timeoutMs?: number;
};

const MAX_CACHE = 200;

export function createSearcher(options: SearcherOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const ttl = options.ttlMs ?? 60 * 60 * 1000;
  const perMinute = options.perMinute ?? 20;
  const timeout = options.timeoutMs ?? 8000;
  const cache = new Map<string, { at: number; outcome: SearchOutcome }>();
  const stamps: number[] = [];

  return async function search(query: string): Promise<SearchOutcome> {
    const provider = options.provider ?? process.env.SEARCH_PROVIDER ?? "duckduckgo";
    if (provider !== "duckduckgo") {
      throw new SearchError(`Поисковый сервис «${provider}» на этом сервере ещё не подключён. Пока работает только пробный бесплатный поиск.`, 503);
    }
    const key = query.toLowerCase();
    const saved = cache.get(key);
    if (saved && now() - saved.at < ttl) return { ...saved.outcome, cached: true };

    const t = now();
    while (stamps.length > 0 && t - stamps[0] > 60_000) stamps.shift();
    if (stamps.length >= perMinute) throw new SearchError("Слишком много поисковых запросов подряд — подождите минуту и повторите.", 429);
    stamps.push(t);

    let response: Response;
    try {
      response = await fetcher(duckDuckGoUrl(query), {
        headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", "Accept-Language": "ru-RU,ru;q=0.9", Accept: "text/html" },
        signal: AbortSignal.timeout(timeout),
        redirect: "follow",
      });
    } catch {
      throw new SearchError("Поиск не ответил вовремя. Повторите позже.", 504);
    }
    // 202 — так бесплатный поиск отвечает, когда просит подтвердить, что запрос делает человек.
    if (response.status === 202 || response.status === 403 || response.status === 429) {
      throw new SearchError("Бесплатный поиск временно не отвечает на запросы с сервера (просит подтвердить, что вы человек). Повторите позже.", 503);
    }
    if (!response.ok) throw new SearchError("Поиск сейчас недоступен. Повторите позже.", 502);

    const hits = parseDuckDuckGoHtml(await response.text());
    const outcome: SearchOutcome = { provider: "duckduckgo", providerName: PROVIDER_NAMES.duckduckgo, hits, cached: false, at: new Date(now()).toISOString() };
    if (hits.length > 0) {
      if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
      cache.set(key, { at: now(), outcome });
    }
    return outcome;
  };
}
