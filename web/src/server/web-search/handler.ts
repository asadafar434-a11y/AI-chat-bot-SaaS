import "server-only";
import { badRequest, readJson } from "@/lib/read-json";
import { cleanQuery } from "@/lib/web-search";
import { SearchError, type SearchOutcome } from "@/server/web-search/search";

// Обработчик «найти в интернете по ключевым словам». Отдельно от файла маршрута, чтобы проверять без сети: доступ и сам поиск подставляются. ИИ не вызывается, деньги не тратятся,
// но вход нужен так же, как у остальных маршрутов: без него адрес был бы открытым прокси в поиск.

export type WebSearchDeps = {
  authorize: (request: Request) => Promise<Response | null>;
  search: (query: string) => Promise<SearchOutcome>;
};

const plain = (message: string, status: number) => new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function handleWebSearch(request: Request, deps: WebSearchDeps): Promise<Response> {
  const denied = await deps.authorize(request);
  if (denied) return denied;
  const body = await readJson(request);
  if (!body) return badRequest();
  const checked = cleanQuery(body.query);
  if (!checked.ok) return plain(checked.reason, 400);
  try {
    const found = await deps.search(checked.query);
    return Response.json({ query: checked.query, provider: found.provider, providerName: found.providerName, hits: found.hits, cached: found.cached, at: found.at });
  } catch (error) {
    if (error instanceof SearchError) return plain(error.message, error.status);
    // В журнал — только причина, без самого запроса.
    console.error("web search failed:", error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : "unknown");
    return plain("Поиск сейчас недоступен. Повторите позже.", 502);
  }
}
