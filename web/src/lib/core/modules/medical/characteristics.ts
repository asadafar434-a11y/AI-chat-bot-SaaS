export type CharacteristicOperator = "eq" | "gte" | "lte" | "includes";
export type CharacteristicValue = string | number | boolean;

export type Characteristic = {
  name: string;
  value: CharacteristicValue;
  unit?: string;
  op?: CharacteristicOperator;
};

export type CharacteristicMismatchReason = "missing" | "value" | "unit" | "op";

export type CharacteristicMismatch = {
  name: string;
  required: CharacteristicValue;
  offered: CharacteristicValue | null;
  reason: CharacteristicMismatchReason;
};

export type CharacteristicMatchResult = {
  matched: boolean;
  mismatches: CharacteristicMismatch[];
  missing: string[];
};

const normalizeName = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

const normalizeUnit = (value: string | undefined): string => (value ?? "").trim().toLowerCase();

const normalizeText = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

const isCharacteristicValue = (value: unknown): value is CharacteristicValue => {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.trim().length > 0;
  return typeof value === "boolean";
};

const parseCharacteristic = (raw: unknown): Characteristic | null => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (name.length === 0 || !isCharacteristicValue(record.value)) return null;
  const unit = typeof record.unit === "string" && record.unit.trim().length > 0 ? record.unit.trim() : undefined;
  const op =
    record.op === "gte" || record.op === "lte" || record.op === "includes" ? record.op : "eq";
  return { name, value: record.value, unit, op };
};

const parseList = (value: unknown, field: string): { items: Characteristic[]; missing: string[] } => {
  if (!Array.isArray(value) || value.length === 0) return { items: [], missing: [field] };
  const items: Characteristic[] = [];
  for (const raw of value) {
    const item = parseCharacteristic(raw);
    if (!item) return { items: [], missing: [field] };
    items.push(item);
  }
  return { items, missing: [] };
};

const sameValue = (required: CharacteristicValue, offered: CharacteristicValue): boolean => {
  if (typeof required === "number" && typeof offered === "number") return required === offered;
  if (typeof required === "boolean" && typeof offered === "boolean") return required === offered;
  return normalizeText(String(required)) === normalizeText(String(offered));
};

const satisfies = (required: Characteristic, offered: Characteristic): boolean => {
  switch (required.op) {
    case "gte":
      return typeof required.value === "number" && typeof offered.value === "number" && offered.value >= required.value;
    case "lte":
      return typeof required.value === "number" && typeof offered.value === "number" && offered.value <= required.value;
    case "includes":
      return (
        typeof required.value === "string" &&
        typeof offered.value === "string" &&
        normalizeText(offered.value).includes(normalizeText(required.value))
      );
    default:
      return sameValue(required.value, offered.value);
  }
};

export const matchCharacteristics = (requiredInput: unknown, offeredInput: unknown): CharacteristicMatchResult => {
  const required = parseList(requiredInput, "requiredCharacteristics");
  const offered = parseList(offeredInput, "productCharacteristics");
  const missing = [...required.missing, ...offered.missing];
  if (missing.length > 0) return { matched: false, mismatches: [], missing };

  const offeredByName = new Map<string, Characteristic>();
  for (const item of offered.items) {
    const key = normalizeName(item.name);
    if (!offeredByName.has(key)) offeredByName.set(key, item);
  }

  const mismatches: CharacteristicMismatch[] = [];
  for (const item of required.items) {
    const offeredItem = offeredByName.get(normalizeName(item.name));
    if (!offeredItem) {
      mismatches.push({ name: item.name, required: item.value, offered: null, reason: "missing" });
      continue;
    }
    if (item.unit && normalizeUnit(item.unit) !== normalizeUnit(offeredItem.unit)) {
      mismatches.push({ name: item.name, required: item.value, offered: offeredItem.value, reason: "unit" });
      continue;
    }
    if (!satisfies(item, offeredItem)) {
      mismatches.push({
        name: item.name,
        required: item.value,
        offered: offeredItem.value,
        reason: item.op === "eq" ? "value" : "op",
      });
    }
  }

  return { matched: mismatches.length === 0, mismatches, missing: [] };
};
