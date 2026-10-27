import type { RateKind } from "@/lib/rate-extract";
import { cleanQuery } from "@/lib/web-search";

// Запрос «найти зарплаты и аренду техники в интернете» (/api/rates): на сервер уходят только должность или название техники и регион — документы и реквизиты не уходят.
// Поисковые запросы строятся из тех же слов и проходят ту же очистку, что и в остальном поиске (lib/web-search.ts: cleanQuery).

// До четырёх позиций за раз: поиск и чтение страниц долгие, а ответ одним запросом не должен висеть минутами; экран шлёт запросы по очереди и сохраняет найденное после каждого.
export const MAX_RATE_ITEMS = 4;
const MAX_SUBJECT = 120;

export type RateItem = { key: string; kind: RateKind; subject: string; region: string | null };
export type RatesRequest = { items: RateItem[] };

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Запросы в поиск по одной позиции. Запрос, не прошедший очистку, отбрасывается. */
export function rateQueries(item: Pick<RateItem, "kind" | "subject" | "region">, year: number): string[] {
  const where = item.region ? ` ${item.region}` : "";
  const raw =
    item.kind === "salary"
      ? [`зарплата ${item.subject}${where} ${year}`, `${item.subject} вакансии${where} зарплата`]
      : [`аренда ${item.subject} цена в месяц${where}`, `аренда ${item.subject} стоимость в сутки`];
  return raw.flatMap((q) => {
    const checked = cleanQuery(q);
    return checked.ok ? [checked.query] : [];
  });
}

export function parseRatesRequest(body: unknown): { ok: true; value: RatesRequest } | { ok: false; error: string } {
  const list = (body as { items?: unknown })?.items;
  if (!Array.isArray(list) || list.length === 0) return { ok: false, error: "Нет позиций для поиска зарплат и аренды." };
  if (list.length > MAX_RATE_ITEMS) return { ok: false, error: `За один запрос — не больше ${MAX_RATE_ITEMS} позиций.` };
  const items: RateItem[] = [];
  for (const raw of list) {
    const o = (raw ?? {}) as Record<string, unknown>;
    const key = text(o.key, 60);
    const subject = text(o.subject, MAX_SUBJECT);
    const kind = o.kind === "salary" || o.kind === "rent" ? o.kind : null;
    if (!key || !kind || subject.length < 3) return { ok: false, error: "Позиция описана неверно: нужны ключ, вид (зарплата или аренда) и название." };
    items.push({ key, kind, subject, region: text(o.region, 120) || null });
  }
  return { ok: true, value: { items } };
}
