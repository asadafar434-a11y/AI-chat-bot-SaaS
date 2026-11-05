import "server-only";
import { badRequest, readJson } from "@/lib/read-json";
import type { TenderStore } from "@/server/rostender/store";

// Обработчик «Закупки сервера». Отдаёт общий список закупок из базы (его раз в сутки обновляет сервер, sync.ts); сам в Ростендер не ходит и лимит ключа не тратит.
// Вход нужен так же, как у остальных маршрутов.

export type RostenderDeps = {
  authorize: (request: Request) => Promise<Response | null>;
  /** null — базы нет (режим «в браузере»). */
  store: TenderStore | null;
  /** Задан ли ключ Ростендера на сервере: без него список не обновляется. */
  configured: boolean;
  today: () => string;
};

/** Сколько закупок отдаём за раз. */
export const LIST_MAX = 1000;

export async function handleRostender(request: Request, deps: RostenderDeps): Promise<Response> {
  const denied = await deps.authorize(request);
  if (denied) return denied;
  const body = await readJson(request);
  if (!body || body.action !== "list") return badRequest();
  if (!deps.store) return Response.json({ configured: deps.configured, listings: [], total: 0, updatedAt: null });
  try {
    const list = await deps.store.list(deps.today(), LIST_MAX);
    return Response.json({ configured: deps.configured, ...list });
  } catch (error) {
    console.error("tenders list failed:", error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : "unknown");
    return new Response("Не удалось прочитать закупки. Повторите позже.", { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
