import "server-only";
import { cardToListing, parseInfo, parseShortPage, parseTemplates, type RostenderPage, type RostenderStatus, type RostenderTemplate } from "@/lib/rostender";
import type { TenderListing } from "@/lib/tender-search";

// Запросы к Ростендеру (rostender.info/api/tenders/get/, ключ в заголовке X-API-KEY). Ключ живёт только здесь: в ответ участнику и в тексты ошибок он не попадает.
// Лимит ключа общий на день: списываются удачные ответы `{id}`, `eis/{номер}` и `template/{id}` (по 1 за каждый); `info`, список шаблонов и ошибки не списываются.
// Поэтому ежедневная загрузка (sync.ts) считает запросы заранее и не берёт больше, чем осталось.

export class RostenderError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export type RostenderOptions = { apiKey: string; fetcher?: typeof fetch; timeoutMs?: number; baseUrl?: string; now?: () => number; cardTtlMs?: number };

type Reply = { json: unknown; remaining: number | null };

export function createRostenderClient(options: RostenderOptions) {
  const fetcher = options.fetcher ?? fetch;
  const timeout = options.timeoutMs ?? 15_000;
  const base = (options.baseUrl ?? "https://rostender.info/api/tenders/get").replace(/\/+$/, "");
  const apiKey = options.apiKey.trim();

  async function get(path: string, params: Record<string, string | number> = {}): Promise<Reply | null> {
    const url = new URL(`${base}/${path}`);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
    let response: Response;
    try {
      response = await fetcher(url.toString(), { signal: AbortSignal.timeout(timeout), headers: { "X-API-KEY": apiKey, Accept: "application/json" } });
    } catch (error) {
      throw new RostenderError(error instanceof Error && error.name === "TimeoutError" ? "Ростендер не ответил вовремя." : "Ростендер не ответил.", 504);
    }
    if (response.status === 404) return null;
    if (response.status === 401) throw new RostenderError("Ростендер не принял ключ (401). Проверьте строку ROSTENDER_API_KEY в web/.env.local.", 502);
    if (response.status === 403) throw new RostenderError("Ростендер отказал (403): тариф не даёт этот запрос или дневной лимит запросов исчерпан. Лимит обновляется в 00:00 по Москве.", 429);
    if (response.status === 400) throw new RostenderError("Ростендер не принял параметры запроса (400).", 502);
    if (!response.ok) throw new RostenderError(`Ростендер ответил ошибкой ${response.status}.`, 502);
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new RostenderError("Ростендер вернул непонятный ответ.", 502);
    }
    const body = json as { success?: unknown; message?: unknown };
    if (body?.success === false) {
      const message = typeof body.message === "string" ? body.message.split(apiKey).join("***").replace(/\s+/g, " ").slice(0, 160) : "без пояснения";
      throw new RostenderError(`Ростендер: ${message}`, 502);
    }
    const header = Number(response.headers.get("X-RateLimit-Remaining"));
    return { json, remaining: response.headers.get("X-RateLimit-Remaining") !== null && Number.isFinite(header) ? header : null };
  }

  return {
    /** Лимит и остаток ключа — запрос бесплатный. */
    async info(): Promise<RostenderStatus> {
      const r = await get("info");
      return r ? parseInfo(r.json) : { limit: null, used: null, remaining: null, resetsAt: null };
    },
    /** Шаблоны (сохранённые поиски в кабинете Ростендера) — бесплатно. */
    async templates(): Promise<RostenderTemplate[]> {
      const r = await get("templates");
      return r ? parseTemplates(r.json) : [];
    },
    /** Страница шаблона: до 100 кратких записей. Списывает один запрос. */
    async templatePage(id: string, page: number, sort = "new-first"): Promise<RostenderPage & { remaining: number | null }> {
      const r = await get(`template/${encodeURIComponent(id)}`, { page, sort });
      if (!r) throw new RostenderError("Такого шаблона в Ростендере нет.", 404);
      return { ...parseShortPage(r.json), remaining: r.remaining };
    },
    /** Полная карточка по номеру в Ростендере. Списывает один запрос. null — карточки нет. */
    async card(id: string): Promise<{ listing: TenderListing | null; remaining: number | null }> {
      const r = await get(encodeURIComponent(id));
      return r ? { listing: cardToListing(r.json), remaining: r.remaining } : { listing: null, remaining: null };
    },
  };
}

export type RostenderClient = ReturnType<typeof createRostenderClient>;
