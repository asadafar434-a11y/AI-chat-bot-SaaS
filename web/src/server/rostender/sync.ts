import "server-only";
import type { RostenderShort } from "@/lib/rostender";
import { RostenderError, type RostenderClient } from "@/server/rostender/client";
import type { TenderStore } from "@/server/rostender/store";

// Ежедневная загрузка закупок из Ростендера в общую базу (таблица Tender). Участник ничего не нажимает: сервер сам читает списки всех шаблонов кабинета
// (в том числе «Планируемые закупки»), берёт полные карточки с документами только у новых закупок и убирает закончившиеся по сроку.
// Лимит ключа общий на день (200): страницы списка и каждая карточка списывают по 1, поэтому запросы считаются заранее и часть лимита остаётся в запасе.

export type SyncOptions = {
  client: Pick<RostenderClient, "info" | "templates" | "templatePage" | "card">;
  store: TenderStore;
  /** Сегодня по Москве, ГГГГ-ММ-ДД. */
  today: string;
  /** Сколько запросов оставить в запасе. */
  reserve?: number;
  /** Сколько страниц (по 100) читать у каждого шаблона. */
  pagesPerTemplate?: number;
  /** Сколько новых карточек взять за один запуск, не больше. */
  maxCards?: number;
};

export type SyncResult = {
  ok: boolean;
  /** Почему ничего не сделано или сделано не всё. */
  note: string | null;
  templates: number;
  listed: number;
  added: number;
  failed: number;
  removed: number;
  spent: number;
  remaining: number | null;
};

const CONCURRENCY = 3;
export const SYNC_RESERVE = 10;
export const SYNC_PAGES = 3;

export async function syncTenders(options: SyncOptions): Promise<SyncResult> {
  const { client, store, today } = options;
  const reserve = options.reserve ?? SYNC_RESERVE;
  const pagesPer = Math.max(1, options.pagesPerTemplate ?? SYNC_PAGES);
  const result: SyncResult = { ok: false, note: null, templates: 0, listed: 0, added: 0, failed: 0, removed: 0, spent: 0, remaining: null };

  const status = await client.info();
  let remaining = status.remaining;
  result.remaining = remaining;
  if (remaining !== null && remaining - reserve < 2) {
    result.note = "Дневной лимит Ростендера почти исчерпан — загрузка отложена до обновления лимита (00:00 по Москве).";
    return result;
  }
  const templates = await client.templates();
  result.templates = templates.length;
  if (templates.length === 0) {
    result.note = "В кабинете Ростендера нет шаблонов — загружать нечего.";
    return result;
  }
  const budgetOf = () => (remaining === null ? Infinity : remaining - reserve);

  // 1. Списки: до pagesPer страниц у каждого шаблона, но не больше половины доступных запросов — вторая половина на карточки.
  const pageBudget = Number.isFinite(budgetOf()) ? Math.max(templates.length, Math.floor(budgetOf() / 2)) : templates.length * pagesPer;
  let pagesRead = 0;
  const lists: RostenderShort[][] = [];
  try {
    for (const template of templates) {
      const items: RostenderShort[] = [];
      for (let page = 1; page <= pagesPer && pagesRead < pageBudget; page++) {
        const r = await client.templatePage(template.id, page);
        pagesRead++;
        result.spent++;
        if (r.remaining !== null) remaining = r.remaining;
        items.push(...r.items);
        if (page >= r.pages || r.items.length === 0) break;
      }
      lists.push(items);
    }
  } catch (error) {
    if (!(error instanceof RostenderError) || lists.every((l) => l.length === 0)) throw error;
    result.note = error.message;
  }

  // 2. Что уже есть — отметить, что снова в списках; что с истёкшим сроком — пропустить; новое — в очередь по кругу между шаблонами.
  const known = await store.known();
  const seen = new Set<string>();
  const queue: string[] = [];
  const refresh: string[] = [];
  const touch: string[] = [];
  const depth = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < depth; i++) {
    for (const list of lists) {
      const item = list[i];
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      if (known.fresh.has(item.id)) touch.push(item.id);
      else if (item.deadline && item.deadline < today) continue;
      else if (known.stale.has(item.id)) refresh.push(item.id);
      else queue.push(item.id);
    }
  }
  result.listed = seen.size;
  await store.touch(touch);
  // Новые закупки важнее: карточки, загруженные раньше с меньшим набором полей, обновляются в последнюю очередь.
  queue.push(...refresh);

  // 3. Карточки новых закупок: не больше остатка лимита и не больше maxCards.
  const take = Math.max(0, Math.min(queue.length, options.maxCards ?? Infinity, budgetOf()));
  const picked = queue.slice(0, take);
  let next = 0;
  let stop: RostenderError | null = null;
  const worker = async () => {
    while (!stop) {
      const id = picked[next++];
      if (!id) return;
      try {
        const r = await client.card(id);
        result.spent++;
        if (r.remaining !== null) remaining = r.remaining;
        if (r.listing && (await store.save([r.listing])) > 0) result.added++;
        else result.failed++;
      } catch (error) {
        if (error instanceof RostenderError && (error.status === 429 || error.message.includes("(401)"))) stop = error;
        else result.failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const stopped = stop as RostenderError | null;
  if (stopped) result.note = stopped.message;
  else if (queue.length > picked.length) result.note = `Новых закупок ещё ${queue.length - picked.length} — загрузятся в следующие дни, лимит ключа дневной.`;

  result.removed = await store.expire(today);
  result.remaining = remaining;
  result.ok = true;
  return result;
}
