import { CARD_FIELDS, type CardField, type FieldOrigin, type ProductCard, type Sourced } from "@/lib/product-card";
import { isRegistryKind, type RegistryKind } from "@/lib/registry-types";

// Разбор запроса «найти записи реестра для этих товаров». Всё, что пришло от браузера, — недоверенный ввод:
// длины ограничены, лишние поля отброшены, управляющие символы убраны. Значения никогда не попадают в текст SQL.

export const MAX_ITEMS = 60;
const MAX_TEXT = 500;
const MAX_LONG = 4000;
const ORIGINS: FieldOrigin[] = ["tz", "user", "document", "profile"];

export type SearchRequest = { registry: RegistryKind; asOf: string; cards: ProductCard[] };
export type ParseResult = { ok: true; value: SearchRequest } | { ok: false; error: string };

const text = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

function sourced(value: unknown, max: number): Sourced | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const v = text(raw.value, max);
  if (!v) return null;
  const origin = ORIGINS.includes(raw.origin as FieldOrigin) ? (raw.origin as FieldOrigin) : "user";
  return { value: v, origin, source: text(raw.source, 200) };
}

const validDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  const year = Number(value.slice(0, 4));
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value && year >= 2020 && year <= 2100;
};

export function parseSearchRequest(body: Record<string, unknown>, today: string): ParseResult {
  if (!isRegistryKind(body.registry)) return { ok: false, error: "Не указан реестр или такого реестра нет." };
  const asOf = validDate(body.asOf) ? body.asOf : today;
  if (!Array.isArray(body.items)) return { ok: false, error: "Нет списка товаров." };
  if (body.items.length > MAX_ITEMS) return { ok: false, error: `Товаров слишком много: не больше ${MAX_ITEMS} за раз.` };
  const cards: ProductCard[] = [];
  const keys = new Set<string>();
  for (const item of body.items) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const key = text(raw.key, 100);
    const name = text(raw.name, MAX_TEXT);
    if (!key || !name) return { ok: false, error: "У каждого товара должны быть ключ и наименование." };
    if (keys.has(key)) return { ok: false, error: "Ключи товаров повторяются." };
    keys.add(key);
    const fields: ProductCard["fields"] = {};
    const rawFields = raw.fields && typeof raw.fields === "object" ? (raw.fields as Record<string, unknown>) : {};
    for (const field of CARD_FIELDS) {
      const value = sourced(rawFields[field], field === "characteristics" ? MAX_LONG : MAX_TEXT);
      if (value) fields[field as CardField] = field === "inn" ? { ...value, value: value.value.replace(/\s+/g, "") } : value;
    }
    cards.push({
      key,
      name,
      quantity: text(raw.quantity, 100),
      source: text(raw.source, 200),
      quote: text(raw.quote, MAX_TEXT),
      offeredName: sourced(raw.offeredName, MAX_TEXT),
      fields,
    });
  }
  return { ok: true, value: { registry: body.registry, asOf, cards } };
}
