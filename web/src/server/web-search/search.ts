import "server-only";
import { curlFetch } from "@/server/web-search/curl-fetch";
import { braveUrl, duckDuckGoUrl, parseBraveHtml, parseDuckDuckGoHtml, PROVIDER_NAMES, type ProviderId, type SearchHit } from "@/lib/web-search";

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
  /** Запасной запрос после отказа (202, 403, 429); по умолчанию — curl, но только когда запросы идут настоящим fetch. null — без запасного. */
  fallbackFetcher?: ((url: string, init: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>) | null;
  now?: () => number;
  provider?: string;
  ttlMs?: number;
  perMinute?: number;
  timeoutMs?: number;
};

const MAX_CACHE = 200;

// Бесплатные поисковики без ключа: у каждого свой адрес и разбор страницы. По умолчанию («auto») сначала Brave, потом DuckDuckGo: если один просит подтвердить, что запрос делает человек
// (202, 403, 429), или не дал результатов, берётся другой. «brave» или «duckduckgo» в SEARCH_PROVIDER — только он; другое значение — честный отказ.
const ENGINES: Record<ProviderId, { url: (query: string) => string; parse: (html: string) => SearchHit[] }> = {
  brave: { url: braveUrl, parse: parseBraveHtml },
  duckduckgo: { url: duckDuckGoUrl, parse: parseDuckDuckGoHtml },
};
const ORDER: Record<string, ProviderId[]> = { auto: ["brave", "duckduckgo"], brave: ["brave"], duckduckgo: ["duckduckgo"] };

export function createSearcher(options: SearcherOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const fallback = options.fallbackFetcher !== undefined ? options.fallbackFetcher : options.fetcher === undefined && process.env.SEARCH_CURL !== "off" ? curlFetch : null;
  const now = options.now ?? Date.now;
  const ttl = options.ttlMs ?? 60 * 60 * 1000;
  const perMinute = options.perMinute ?? 20;
  const timeout = options.timeoutMs ?? 8000;
  const cache = new Map<string, { at: number; outcome: SearchOutcome }>();
  const stamps: number[] = [];

  return async function search(query: string): Promise<SearchOutcome> {
    const provider = options.provider ?? process.env.SEARCH_PROVIDER ?? "auto";
    const order = ORDER[provider];
    if (!order) {
      throw new SearchError(`Поисковый сервис «${provider}» на этом сервере ещё не подключён. Пока работает только пробный бесплатный поиск.`, 503);
    }
    const key = query.toLowerCase();
    const saved = cache.get(key);
    if (saved && now() - saved.at < ttl) return { ...saved.outcome, cached: true };

    const t = now();
    while (stamps.length > 0 && t - stamps[0] > 60_000) stamps.shift();
    if (stamps.length >= perMinute) throw new SearchError("Слишком много поисковых запросов подряд — подождите минуту и повторите.", 429);
    stamps.push(t);

    let blocked = false;
    let timedOut = false;
    let failed = false;
    let empty: SearchOutcome | null = null;
    for (const engine of order) {
      const url = ENGINES[engine].url(query);
      const headers = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", "Accept-Language": "ru-RU,ru;q=0.9", Accept: "text/html" };
      let response: Response;
      try {
        response = await fetcher(url, { headers, signal: AbortSignal.timeout(timeout), redirect: "follow" });
      } catch {
        timedOut = true;
        continue;
      }
      // 202, 403, 429 — так бесплатный поиск отвечает, когда просит подтвердить, что запрос делает человек. Пробуем запасной путь (curl): некоторые поисковики пускают его, а Node — нет.
      const isBlocked = (r: Response) => r.status === 202 || r.status === 403 || r.status === 429;
      if (isBlocked(response) && fallback) {
        try {
          response = await fallback(url, { headers, signal: AbortSignal.timeout(timeout) });
        } catch {
          // curl нет или он не ответил — остаётся отказ первого запроса
        }
      }
      if (isBlocked(response)) {
        blocked = true;
        continue;
      }
      if (!response.ok) {
        failed = true;
        continue;
      }
      const hits = ENGINES[engine].parse(await response.text());
      const outcome: SearchOutcome = { provider: engine, providerName: PROVIDER_NAMES[engine], hits, cached: false, at: new Date(now()).toISOString() };
      if (hits.length > 0) {
        if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
        cache.set(key, { at: now(), outcome });
        return outcome;
      }
      empty = outcome;
    }
    // Ни один поисковик не дал результатов: пустой ответ отдаём как есть (в память он не попадает), отказы — понятным текстом.
    if (empty) return empty;
    if (blocked) {
      throw new SearchError("Бесплатный поиск временно не отвечает на запросы с сервера (просит подтвердить, что вы человек). Повторите позже или откройте тот же запрос в Яндексе.", 503);
    }
    if (timedOut) throw new SearchError("Поиск не ответил вовремя. Повторите позже.", 504);
    throw new SearchError("Поиск сейчас недоступен. Повторите позже.", 502);
  };
}
