import "server-only";
import { badRequest, readJson } from "@/lib/read-json";
import { parseSearchRequest } from "@/lib/registry-request";
import { moscowDay } from "@/lib/registry-types";
import { resolveCard } from "@/lib/registry-service";
import type { RegistryStore } from "@/lib/registry-store";

// Обработчик «найти записи реестра». Отдельно от файла маршрута, чтобы проверять его без сервера и базы:
// хранилище и проверка доступа подставляются. Поиск бесплатный (ИИ не вызывается), данные реестра открыты,
// но входа он требует так же, как остальные маршруты приложения.

export type SearchDeps = {
  authorize: (request: Request) => Promise<Response | null>;
  /** Хранилище реестра; бросает, если базы нет. */
  getStore: () => RegistryStore;
  hasDatabase: () => boolean;
  now?: () => Date;
};

const plain = (message: string, status: number) => new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function handleRegistrySearch(request: Request, deps: SearchDeps): Promise<Response> {
  const denied = await deps.authorize(request);
  if (denied) return denied;
  const body = await readJson(request);
  if (!body) return badRequest();
  const now = deps.now?.() ?? new Date();
  const parsed = parseSearchRequest(body, moscowDay(now.toISOString()));
  if (!parsed.ok) return plain(parsed.error, 400);
  if (!deps.hasDatabase()) return plain("База реестра не подключена на этом сервере — поиск невозможен.", 503);

  const { registry, asOf, cards } = parsed.value;
  try {
    const store = deps.getStore();
    const dataset = await store.latestDataset(registry);
    const limit = cards.length > 20 ? 12 : 30;
    const results = [];
    for (const card of cards) results.push({ key: card.key, decision: await resolveCard(store, card, { registry, asOf, now, dataset, limit }) });
    return Response.json({
      registry,
      asOf,
      dataset: dataset && { id: dataset.id, fileSha256: dataset.fileSha256, formatVersion: dataset.formatVersion, exportedAt: dataset.exportedAt, importedAt: dataset.importedAt },
      results,
    });
  } catch (error) {
    // Причину пишем в журнал сервера без значений запроса; браузеру — только понятный текст.
    console.error("registry search failed:", error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : "unknown");
    return plain("База реестра сейчас недоступна — попробуйте позже.", 503);
  }
}
