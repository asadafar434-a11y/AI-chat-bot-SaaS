import { cleanQuery } from "@/lib/web-search";

// Запрос «найти закупочные цены в интернете по позициям закупки» (/api/prices): на сервер уходят только название, единица, регион и количество — документы и реквизиты не уходят.
// Поисковые запросы строятся из тех же слов и проходят ту же очистку, что и в остальном поиске (lib/web-search.ts: cleanQuery): ни почты, ни телефонов, ни длинных чисел.

export const MAX_PRICE_POSITIONS = 4;
const MAX_NAME = 200;

export type PricePosition = { key: string; name: string; unit: string; quantity: number | null; region: string | null };
export type PricesRequest = { positions: PricePosition[] };

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Запросы в поиск по одной позиции: цена за единицу оптом и «купить оптом» (с регионом, если он назван). Запрос, не прошедший очистку, отбрасывается. */
export function searchQueriesFor(p: Pick<PricePosition, "name" | "unit" | "region">): string[] {
  const unit = p.unit ? ` за ${p.unit}` : "";
  const raw = [`${p.name} цена${unit} оптом`, `купить ${p.name} оптом${p.region ? ` ${p.region}` : ""}`];
  return raw.flatMap((q) => {
    const checked = cleanQuery(q);
    return checked.ok ? [checked.query] : [];
  });
}

export function parsePricesRequest(body: unknown): { ok: true; value: PricesRequest } | { ok: false; error: string } {
  const input = (body ?? {}) as { positions?: unknown };
  if (!Array.isArray(input.positions) || input.positions.length === 0) return { ok: false, error: "Нет позиций: нужно название и единица каждой." };
  if (input.positions.length > MAX_PRICE_POSITIONS) return { ok: false, error: `Позиций слишком много: не больше ${MAX_PRICE_POSITIONS} за раз.` };
  const positions: PricePosition[] = [];
  const seen = new Set<string>();
  for (const raw of input.positions) {
    const p = (raw ?? {}) as { key?: unknown; name?: unknown; unit?: unknown; quantity?: unknown; region?: unknown };
    const name = text(p.name, MAX_NAME);
    const key = text(p.key, 100) || String(positions.length);
    if (name.length < 2) return { ok: false, error: "У позиции нет названия." };
    if (seen.has(key)) return { ok: false, error: `Ключ позиции повторяется: ${key}.` };
    seen.add(key);
    const quantity = typeof p.quantity === "number" && Number.isFinite(p.quantity) && p.quantity > 0 ? p.quantity : null;
    positions.push({ key, name, unit: text(p.unit, 40), quantity, region: text(p.region, 120) || null });
  }
  return { ok: true, value: { positions } };
}
