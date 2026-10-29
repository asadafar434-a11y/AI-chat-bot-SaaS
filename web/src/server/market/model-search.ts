import type { SearchHit } from "./collect.ts";

// Поиск страниц встроенным поиском модели (инструмент web_search): бесплатные поисковики блокируют запросы с сервера («подтвердите, что вы человек»), а этот работает по ключу модели.
// Платно: $0,01 за поисковый запрос плюс токены ответа. Модель здесь только ищет и ничего не пересказывает: страницы потом скачивает и читает наш код, цену проверяет код (lib/price-extract.ts).
// Сам вызов модели подставляется (run): так разбор ответа проверяется тестами без сети и денег.

/** Плата за один поисковый запрос модели, $ (по прайсу Anthropic: $10 за 1000 запросов). */
export const WEB_SEARCH_FEE_USD = 0.01;

export const SEARCH_SYSTEM = "Ты — поисковик. Выполни ровно один веб-поиск по запросу пользователя и ответь одним словом: «готово». Страницы не пересказывай и цены не называй.";

export type ModelSearchRun = (system: string, query: string) => Promise<{ content: unknown[]; usd: number }>;

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** Страницы из блоков ответа: web_search_tool_result → web_search_result (адрес, название). Ошибка поиска приходит блоком с типом ошибки, а не исключением. */
export function hitsFromContent(content: unknown[]): { hits: SearchHit[]; error: string | null } {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  let error: string | null = null;
  for (const raw of content) {
    const block = asRecord(raw);
    if (block.type !== "web_search_tool_result") continue;
    const inner = block.content;
    if (!Array.isArray(inner)) {
      error = String(asRecord(inner).error_code ?? "ошибка поиска");
      continue;
    }
    for (const item of inner) {
      const r = asRecord(item);
      const url = typeof r.url === "string" ? r.url : "";
      let domain: string;
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
        domain = parsed.hostname.replace(/^www\./, "").toLowerCase();
      } catch {
        continue;
      }
      if (seen.has(url)) continue;
      seen.add(url);
      hits.push({ title: typeof r.title === "string" ? r.title : domain, url, domain, snippet: "" });
    }
  }
  return { hits, error: hits.length === 0 ? error : null };
}

/** Поиск для collectPrices: один запрос → страницы. Расход каждого вызова сообщается в onCost (в $). Ошибка поиска без единой страницы — исключение, чтобы сбор записал «поиск не удался». */
export function createModelSearch(run: ModelSearchRun, onCost: (usd: number) => void) {
  return async function search(query: string): Promise<SearchHit[]> {
    const reply = await run(SEARCH_SYSTEM, query);
    onCost(reply.usd);
    const { hits, error } = hitsFromContent(reply.content);
    if (error) throw new Error(`поиск моделью не удался: ${error}`);
    return hits;
  };
}
