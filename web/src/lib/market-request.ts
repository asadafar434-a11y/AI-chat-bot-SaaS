import type { Target } from "@/lib/market-observations";

// Разбор запроса «рыночный ориентир по позициям закупки». Только название, единица, количество и регион закупки: документы, реквизиты и тексты на сервер не уходят.

export const MAX_POSITIONS = 30;
const MAX_NAME = 300;

export type MarketPosition = { key: string; target: Target };
export type MarketRequest = { positions: MarketPosition[]; onDate: string | null };

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export function parseMarketRequest(body: unknown): { ok: true; value: MarketRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Нужен запрос с позициями закупки." };
  const input = body as { positions?: unknown; onDate?: unknown };
  if (!Array.isArray(input.positions) || input.positions.length === 0) return { ok: false, error: "Нет позиций: нужно название и единица каждой." };
  if (input.positions.length > MAX_POSITIONS) return { ok: false, error: `Позиций слишком много: не больше ${MAX_POSITIONS} за раз.` };
  const positions: MarketPosition[] = [];
  const seen = new Set<string>();
  for (const raw of input.positions) {
    const p = (raw ?? {}) as { key?: unknown; name?: unknown; unit?: unknown; quantity?: unknown; region?: unknown };
    const name = text(p.name, MAX_NAME);
    const key = text(p.key, 100) || String(positions.length);
    if (name.length < 2) return { ok: false, error: "У позиции нет названия." };
    if (seen.has(key)) return { ok: false, error: `Ключ позиции повторяется: ${key}.` };
    seen.add(key);
    const quantity = typeof p.quantity === "number" && Number.isFinite(p.quantity) && p.quantity > 0 ? p.quantity : null;
    positions.push({ key, target: { name, unit: text(p.unit, 40), quantity, region: text(p.region, 120) || null } });
  }
  const onDate = typeof input.onDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.onDate) && !Number.isNaN(Date.parse(`${input.onDate}T00:00:00Z`)) ? input.onDate : null;
  return { ok: true, value: { positions, onDate } };
}
