import { fromStore, toStore } from "@/lib/data-format";
import { STORES, transaction } from "@/lib/db";
import { cleanAnswers, FACT_KINDS, type Fact } from "@/lib/evidence-base";

// База доказательств лежит в IndexedDB этого браузера, как и всё остальное: сервер её не хранит. Записи читаются и пишутся через
// data-format.ts: старые догоняют текущий формат при чтении. Что считать подходящим фактом — в evidence-match.ts, здесь — хранение.

// Факт из базы в текущем виде: недостающее заполняется «по умолчанию», запись с неизвестным видом (её записала более новая версия
// приложения) не читается и не теряется — она остаётся в базе.
export function readFact(raw: unknown): Fact | null {
  const f = fromStore<Partial<Fact>>("fact", raw);
  if (!f.id || typeof f.title !== "string" || !f.kind || !(f.kind in FACT_KINDS)) return null;
  const origin = f.origin === "ai" ? "ai" : "human";
  const answers = cleanAnswers(f.answers);
  return {
    id: f.id,
    kind: f.kind,
    title: f.title,
    fields: f.fields && typeof f.fields === "object" ? f.fields : {},
    measures: Array.isArray(f.measures) ? f.measures : [],
    validity: f.validity && typeof f.validity === "object" ? f.validity : {},
    source: f.source && typeof f.source === "object" ? f.source : { type: "manual" },
    origin,
    // Вписанное человеком подтверждено по определению; найденное ИИ — только если его подтвердили.
    confirmed: origin === "human" ? true : Boolean(f.confirmed),
    createdAt: f.createdAt ?? "",
    updatedAt: f.updatedAt ?? f.createdAt ?? "",
    ...(answers.length > 0 && { answers }),
  };
}

export const listFacts = async (): Promise<Fact[]> =>
  (await transaction<unknown[]>([STORES.facts], "readonly", (tx) => tx.objectStore(STORES.facts).getAll()))
    .map(readFact)
    .filter((f): f is Fact => f !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export const saveFacts = (facts: Fact[]) =>
  transaction<void>([STORES.facts], "readwrite", (tx) => {
    for (const fact of facts) tx.objectStore(STORES.facts).put(toStore("fact", fact));
  });

export const deleteFact = (id: string) =>
  transaction<void>([STORES.facts], "readwrite", (tx) => {
    tx.objectStore(STORES.facts).delete(id);
  });

// ———— Один и тот же факт ————

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, "");

// Номер документа или договора, если он есть: по нему один и тот же документ узнаётся, как бы ни назвали его в разных файлах.
const numberOf = (f: Pick<Fact, "fields">) => norm(f.fields.number ?? f.fields.contractNo ?? "");

// Это тот же самый факт: вид тот же и номер тот же, а без номера — то же название.
export const sameFact = (a: Fact, b: Fact): boolean => {
  if (a.kind !== b.kind) return false;
  const na = numberOf(a);
  const nb = numberOf(b);
  if (na && nb) return na === nb;
  return norm(a.title) === norm(b.title);
};

// Найденное ИИ добавляется к базе, только если такого факта в ней ещё нет: второй разбор тех же документов не плодит копий,
// а то, что человек уже подтвердил или поправил, не затирается.
export function mergeNewFacts(existing: Fact[], found: Fact[]): { add: Fact[]; skipped: number } {
  const add: Fact[] = [];
  for (const fact of found) {
    if (existing.some((e) => sameFact(e, fact)) || add.some((e) => sameFact(e, fact))) continue;
    add.push(fact);
  }
  return { add, skipped: found.length - add.length };
}
