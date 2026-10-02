// Форма факта: что вписывает человек и как это становится записью базы. Вид формы — на экране (EvidenceBase.tsx); здесь черновик,
// проверка введённого и сборка факта, чтобы их проверяли тесты (npm test). Вписанное человеком подтверждено сразу.
import { createLocator, describeLocation } from "@/lib/doc-locate";
import type { DocMap } from "@/lib/doc-source";
import { dayOf, FACT_KINDS, makeFact, type Fact, type FactKind, type Source, type Validity } from "@/lib/evidence-base";

export type Draft = {
  kind: FactKind;
  title: string;
  fields: Record<string, string>;
  measures: { what: string; value: string; unit: string }[];
  perpetual: boolean;
  from: string;
  until: string;
  // Документ-подтверждение из «Образцов и документов»; пусто — без документа.
  docId: string;
  quote: string;
  note: string;
  // Требования заказчика, под которые добавляется факт («Добавить в базу» у строки «что требуют закупки»): факт отвечает им сразу.
  answers: string[];
};

export const emptyDraft = (kind: FactKind = "license", over: Partial<Draft> = {}): Draft => ({
  kind, title: "", fields: {}, measures: [], perpetual: false, from: "", until: "", docId: "", quote: "", note: "", answers: [], ...over,
});

// Какие числа у каждого вида факта обычно нужны — быстрые подсказки к кнопке «Добавить число».
export const MEASURE_PRESETS: Record<FactKind, { what: string; unit: string }[]> = {
  license: [],
  certificate: [],
  document: [],
  experience: [{ what: "цена договора", unit: "руб." }],
  employee: [{ what: "стаж", unit: "лет" }],
  qualification: [],
  equipment: [{ what: "вместимость", unit: "мест" }, { what: "мощность", unit: "кВт" }, { what: "количество", unit: "шт." }],
  finance: [{ what: "значение", unit: "руб." }],
};

// Факт — в черновик для правки.
export function draftOf(f: Fact): Draft {
  return {
    kind: f.kind,
    title: f.title,
    fields: { ...f.fields },
    measures: f.measures.map((m) => ({ what: m.what, value: String(m.value).replace(".", ","), unit: m.unit })),
    perpetual: Boolean(f.validity.perpetual),
    from: f.validity.from ?? "",
    until: f.validity.until ?? "",
    docId: f.source.type === "document" ? f.source.docId : "",
    quote: f.source.type === "document" ? f.source.quote : "",
    note: f.source.type === "manual" ? (f.source.note ?? "") : "",
    answers: [...(f.answers ?? [])],
  };
}

// Документ из «Образцов и документов». text и map нужны, чтобы назвать место цитаты в файле — страницу, таблицу, пункт.
export type DocRef = { id: string; name: string; text?: string; map?: DocMap };

// Где в файле стоит цитата, словами; пусто, если цитаты нет или её в тексте не нашли.
function placeOf(doc: DocRef, quote: string): string | undefined {
  if (!quote || !doc.text) return undefined;
  const place = createLocator([{ name: doc.name, text: doc.text, map: doc.map }]).locate(quote);
  return (place && describeLocation(place)) || undefined;
}

// Число из поля: «1 200 000», «2,5» → число; не число — NaN.
export const numberOf = (text: string) => Number(text.replace(/\s/g, "").replace(",", "."));

// Черновик → факт. Ошибка — текст для человека. Правка подтверждает факт: человек его проверил.
export function factFromDraft(draft: Draft, docs: DocRef[], existing?: Fact, now: Date = new Date()): { fact: Fact } | { error: string } {
  const title = draft.title.trim();
  if (!title) return { error: "Впишите название: что это за документ или факт." };

  for (const def of FACT_KINDS[draft.kind].fields) {
    const value = (draft.fields[def.key] ?? "").trim();
    if ("date" in def && def.date && value && dayOf(value) === null) return { error: `«${def.label}»: введите дату целиком — день, месяц и год.` };
  }
  const from = draft.from.trim();
  const until = draft.until.trim();
  if ((from && dayOf(from) === null) || (until && dayOf(until) === null)) return { error: "Срок действия: введите дату целиком — день, месяц и год." };
  if (!draft.perpetual && from && until && from > until) return { error: "Срок действия: начало позже конца." };

  const measures = [];
  for (const m of draft.measures) {
    if (!m.what.trim() && !m.value.trim()) continue;
    const value = numberOf(m.value);
    if (!m.what.trim() || !m.value.trim() || !Number.isFinite(value)) return { error: "Число: впишите и название, и значение цифрами." };
    measures.push({ what: m.what.trim(), value, unit: m.unit.trim() });
  }

  const doc = draft.docId ? docs.find((d) => d.id === draft.docId) : undefined;
  const quote = draft.quote.trim();
  // Место в файле: прежнее, если документ и цитата те же; иначе ищем цитату в тексте документа.
  const kept = existing?.source.type === "document" && doc && existing.source.docId === doc.id && existing.source.quote === quote ? existing.source.where : undefined;
  const where = doc ? (kept ?? placeOf(doc, quote)) : undefined;
  const source: Source = doc
    ? { type: "document", docId: doc.id, docName: doc.name, quote, ...(where && { where }) }
    : { type: "manual", ...(draft.note.trim() && { note: draft.note.trim() }) };
  // «Бессрочно» не совмещается с датами.
  const validity: Validity = draft.perpetual ? { perpetual: true } : { ...(from && { from }), ...(until && { until }) };

  const input = { kind: draft.kind, title, fields: draft.fields, measures, validity, source, answers: draft.answers };
  if (existing) {
    const next = makeFact({ ...input, origin: existing.origin }, now, existing.id);
    return { fact: { ...next, createdAt: existing.createdAt, confirmed: true } };
  }
  return { fact: makeFact({ ...input, origin: "human" }, now) };
}

// Подтвердить найденное ИИ: человек проверил, факт больше не ждёт.
export const confirmed = (f: Fact, now: Date = new Date()): Fact => ({ ...f, confirmed: true, updatedAt: now.toISOString() });
