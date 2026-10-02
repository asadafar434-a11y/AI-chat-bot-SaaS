import { fromStore, toStore } from "@/lib/data-format";
import { STORES, transaction } from "@/lib/db";
import { createLocator, describeLocation } from "@/lib/doc-locate";
import type { DocMap } from "@/lib/doc-source";
import { makeFact } from "@/lib/evidence-base";
import type { VerifiedFact } from "@/lib/evidence-extract";
import { listFacts, mergeNewFacts, saveFacts } from "@/lib/evidence-store";
import { errorMessage, errorText, OFFLINE_TEXT } from "@/lib/http-error";
import {
  clipEvidence,
  clipForSort,
  DOC_KINDS,
  EVIDENCE_LIMIT,
  FACT_SOURCE_KINDS,
  guessKinds,
  REQUISITE_KINDS,
  SORT_BATCH,
  type DocKind,
  type FoundField,
  type ProfileFound,
  type SortedDoc,
} from "@/lib/my-docs";
import { EMPTY_PROFILE, type Profile, type ProfileKey } from "@/lib/profile";
import type { SentDocument } from "@/lib/read-documents";
import { SAMPLES_LIMIT } from "@/lib/tp";

// Документ участника: то, что он подавал раньше, или документ его компании. kinds — какие виды
// документов в файле, about — что это, одной строкой.
export type MyDocument = {
  id: string;
  name: string;
  text: string;
  addedAt: string;
  kinds: DocKind[];
  about: string;
  scan?: boolean;
  // Откуда в тексте какой кусок — страница, таблица, лист (doc-source.ts): по ней у факта базы доказательств видно место в файле.
  // У документов, добавленных до карты, её нет.
  map?: DocMap;
};

// Откуда взялись реквизиты. Поле, заполненное из документа, обновляется, когда приходят новые документы;
// вписанное руками не трогаем, а другое значение из документов показываем подсказкой.
export type ProfileMeta = {
  sources: Partial<Record<ProfileKey, string>>;
  suggestions: FoundField[];
};

const PROFILE_KEY = "profile";
const META_KEY = "profile-meta";
const EMPTY_META: ProfileMeta = { sources: {}, suggestions: [] };

// Настройки читаются и пишутся через data-format.ts: старые записи догоняют текущий формат при чтении.
const readSetting = async (key: string) =>
  transaction<unknown>([STORES.settings], "readonly", (tx) => tx.objectStore(STORES.settings).get(key));

export async function getProfile(): Promise<Profile> {
  const stored = await readSetting(PROFILE_KEY);
  return { ...EMPTY_PROFILE, ...(stored === undefined ? {} : fromStore<Partial<Profile>>("profile", stored)) };
}

export async function getProfileMeta(): Promise<ProfileMeta> {
  const stored = await readSetting(META_KEY);
  return { ...EMPTY_META, ...(stored === undefined ? {} : fromStore<Partial<ProfileMeta>>("profileMeta", stored)) };
}

export const saveProfile = (profile: Profile, meta?: ProfileMeta) =>
  transaction<void>([STORES.settings], "readwrite", (tx) => {
    tx.objectStore(STORES.settings).put(toStore("profile", profile), PROFILE_KEY);
    if (meta) tx.objectStore(STORES.settings).put(toStore("profileMeta", meta), META_KEY);
  });

// Документ участника в текущем формате. Вид, которого в приложении уже нет, — «Другое»: файл не пропадает из раздела.
export function readMyDocument(raw: unknown): MyDocument {
  const doc = fromStore<MyDocument>("myDocument", raw);
  return { ...doc, kinds: [...new Set(doc.kinds.map((kind) => (kind in DOC_KINDS ? kind : "other")))] };
}

export const listMyDocuments = async () =>
  (await transaction<unknown[]>([STORES.samples], "readonly", (tx) => tx.objectStore(STORES.samples).getAll()))
    .map(readMyDocument)
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt));

// Сколько документов каждого вида — для острова «Данные компании» на главной. Тексты документов, иногда
// многостраничные сканы, главная в памяти не держит: документы идут по одному и сразу отбрасываются.
// Запись новее приложения считается без вида.
export async function countMyDocumentKinds(): Promise<{ total: number; kinds: Partial<Record<DocKind, number>> }> {
  const kinds: Partial<Record<DocKind, number>> = {};
  let total = 0;
  await transaction<void>([STORES.samples], "readonly", (tx) => {
    const cursor = tx.objectStore(STORES.samples).openCursor();
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) return;
      total++;
      try {
        for (const kind of readMyDocument(current.value).kinds) kinds[kind] = (kinds[kind] ?? 0) + 1;
      } catch {
        // Новее приложения — вид не знаем, но документ есть.
      }
      current.continue();
    };
  });
  return { total, kinds };
}

export const saveMyDocuments = (docs: MyDocument[]) =>
  transaction<void>([STORES.samples], "readwrite", (tx) => {
    for (const doc of docs) tx.objectStore(STORES.samples).put(toStore("myDocument", doc));
  });

export const deleteMyDocument = (id: string) =>
  transaction<void>([STORES.samples], "readwrite", (tx) => {
    tx.objectStore(STORES.samples).delete(id);
  });

// Образцы для запроса: самые свежие документы нужного вида, пока хватает места.
export function samplesOf(docs: MyDocument[], kind: DocKind, limit = SAMPLES_LIMIT): MyDocument[] {
  const picked: MyDocument[] = [];
  let total = 0;
  for (const doc of docs) {
    if (!doc.kinds.includes(kind) || total + doc.text.length > limit) continue;
    picked.push(doc);
    total += doc.text.length;
  }
  return picked;
}

// Сведения для перечня опыта или специалистов: документы нужного вида, каждый — началом и концом, пока хватает места.
export function evidenceOf(docs: MyDocument[], kind: DocKind): MyDocument[] {
  const picked: MyDocument[] = [];
  let total = 0;
  for (const doc of docs) {
    if (!doc.kinds.includes(kind)) continue;
    const text = clipEvidence(doc.text);
    if (total + text.length > EVIDENCE_LIMIT) continue;
    picked.push({ ...doc, text });
    total += text.length;
  }
  return picked;
}

// Обрыв связи браузер описывает по-английски («Failed to fetch») — пользователю говорим по-русски (lib/http-error.ts).
export { OFFLINE_TEXT };

async function postJson(url: string, body: unknown): Promise<Response> {
  try {
    return await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error(OFFLINE_TEXT);
  }
}

// Раскладка по видам. Если ИИ недоступен, раскладываем по названиям файлов и говорим почему.
export async function sortDocuments(docs: SentDocument[]): Promise<{ sorted: SortedDoc[]; error?: string }> {
  try {
    const sorted: SortedDoc[] = [];
    for (let i = 0; i < docs.length; i += SORT_BATCH) {
      const res = await postJson("/api/my-docs/sort", {
        documents: docs.slice(i, i + SORT_BATCH).map((d) => ({ name: d.name, text: clipForSort(d.text) })),
      });
      if (!res.ok) throw new Error(await errorText(res, "Не удалось разложить документы."));
      sorted.push(...((await res.json()) as { documents: SortedDoc[] }).documents);
    }
    return { sorted };
  } catch (e) {
    return { sorted: docs.map((d) => ({ kinds: guessKinds(d.name, d.text), about: "" })), error: errorMessage(e) };
  }
}

const same = (a: string, b: string) => {
  const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[\s «»"“”.,]/g, "");
  return norm(a) === norm(b);
};

// Найденное в документах — в реквизиты: пустые поля и поля, заполненные раньше из документов, обновляем,
// вписанные руками оставляем, а другое значение показываем подсказкой.
export function mergeFound(profile: Profile, meta: ProfileMeta, found: ProfileFound) {
  const next = { ...profile };
  const sources = { ...meta.sources };
  const filled: ProfileKey[] = [];
  const candidates: FoundField[] = [...meta.suggestions, ...found.conflicts];

  for (const field of found.fields) {
    const current = next[field.key].trim();
    if (!current || sources[field.key]) {
      if (!same(current, field.value)) filled.push(field.key);
      next[field.key] = field.value;
      sources[field.key] = field.source;
    } else if (!same(current, field.value)) {
      candidates.push(field);
    }
  }

  const suggestions: FoundField[] = [];
  for (const s of candidates) {
    if (same(next[s.key], s.value) || suggestions.some((t) => t.key === s.key && same(t.value, s.value))) continue;
    suggestions.push(s);
  }
  return { profile: next, meta: { sources, suggestions }, filled };
}

// Факты базы доказательств из документов компании: ИИ ищет, сервер проверяет каждый по тексту документа, браузер кладёт новое
// в базу. Всё найденное ждёт подтверждения человека — само по себе оно не доказательство (evidence-match.ts).
const FACTS_BATCH = 15;

export type FactsReport = { added: number; skipped: number; dropped: number; issues: string[]; documents: number };

export async function findFactsInDocuments(docs: MyDocument[]): Promise<FactsReport> {
  const pool = docs.filter((d) => d.kinds.some((k) => FACT_SOURCE_KINDS.includes(k)));
  const report: FactsReport = { added: 0, skipped: 0, dropped: 0, issues: [], documents: pool.length };
  if (pool.length === 0) return report;

  const verified: VerifiedFact[] = [];
  for (let i = 0; i < pool.length; i += FACTS_BATCH) {
    const part = pool.slice(i, i + FACTS_BATCH);
    const res = await postJson("/api/my-docs/facts", { documents: part.map((d) => ({ id: d.id, name: d.name, text: clipEvidence(d.text) })) });
    if (!res.ok) throw new Error(await errorText(res, "Не удалось найти факты в документах."));
    const out: { facts: VerifiedFact[]; dropped: number; issues: string[] } = await res.json();
    verified.push(...out.facts);
    report.dropped += out.dropped;
    report.issues.push(...out.issues);
  }

  // Место цитаты в файле — страница, таблица, пункт; у документов без карты — по меткам страниц и виду строк.
  const locator = createLocator(pool);
  const now = new Date();
  const found = verified.map((v) => {
    const place = locator.locate(v.source.quote);
    const where = place ? describeLocation(place) : "";
    return makeFact({ ...v, origin: "ai", source: { ...v.source, ...(where && { where }) } }, now);
  });
  const { add, skipped } = mergeNewFacts(await listFacts(), found);
  if (add.length) await saveFacts(add);
  return { ...report, added: add.length, skipped };
}

// Реквизиты из документов участника: анкет, карточки предприятия, писем, ценовых предложений.
export async function fillProfileFromDocuments(docs: MyDocument[]): Promise<{ filled: ProfileKey[]; suggestions: number }> {
  const sources = docs.filter((d) => d.kinds.some((k) => REQUISITE_KINDS.includes(k)));
  if (sources.length === 0) return { filled: [], suggestions: 0 };
  const res = await postJson("/api/my-docs/profile", { documents: sources.map(({ name, text }) => ({ name, text })) });
  if (!res.ok) throw new Error(await errorText(res, "Не удалось заполнить реквизиты."));
  const found: ProfileFound = await res.json();
  const [profile, meta] = await Promise.all([getProfile(), getProfileMeta()]);
  const merged = mergeFound(profile, meta, found);
  await saveProfile(merged.profile, merged.meta);
  return { filled: merged.filled, suggestions: merged.meta.suggestions.length };
}
