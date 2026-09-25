import { STORES, transaction } from "@/lib/db";
import {
  clipForSort,
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

export async function getProfile(): Promise<Profile> {
  const stored = await transaction<Partial<Profile> | undefined>([STORES.settings], "readonly", (tx) =>
    tx.objectStore(STORES.settings).get(PROFILE_KEY)
  );
  return { ...EMPTY_PROFILE, ...stored };
}

export async function getProfileMeta(): Promise<ProfileMeta> {
  const stored = await transaction<Partial<ProfileMeta> | undefined>([STORES.settings], "readonly", (tx) =>
    tx.objectStore(STORES.settings).get(META_KEY)
  );
  return { ...EMPTY_META, ...stored };
}

export const saveProfile = (profile: Profile, meta?: ProfileMeta) =>
  transaction<void>([STORES.settings], "readwrite", (tx) => {
    tx.objectStore(STORES.settings).put(profile, PROFILE_KEY);
    if (meta) tx.objectStore(STORES.settings).put(meta, META_KEY);
  });

// До «Документов компании» здесь лежали только образцы ТП — без видов.
const upgrade = (doc: Omit<MyDocument, "kinds" | "about"> & Partial<MyDocument>): MyDocument => ({
  ...doc,
  kinds: doc.kinds?.length ? doc.kinds : ["tp"],
  about: doc.about ?? "",
});

export const listMyDocuments = async () =>
  (await transaction<MyDocument[]>([STORES.samples], "readonly", (tx) => tx.objectStore(STORES.samples).getAll()))
    .map(upgrade)
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt));

// Сайдбару нужно только число: тексты документов, иногда многостраничные сканы, он не читает.
export const countMyDocuments = () =>
  transaction<number>([STORES.samples], "readonly", (tx) => tx.objectStore(STORES.samples).count());

export const saveMyDocuments = (docs: MyDocument[]) =>
  transaction<void>([STORES.samples], "readwrite", (tx) => {
    for (const doc of docs) tx.objectStore(STORES.samples).put(doc);
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

// Раскладка по видам. Если ИИ недоступен, раскладываем по названиям файлов и говорим почему.
export async function sortDocuments(docs: SentDocument[]): Promise<{ sorted: SortedDoc[]; error?: string }> {
  try {
    const sorted: SortedDoc[] = [];
    for (let i = 0; i < docs.length; i += SORT_BATCH) {
      const res = await fetch("/api/my-docs/sort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documents: docs.slice(i, i + SORT_BATCH).map((d) => ({ name: d.name, text: clipForSort(d.text) })) }),
      });
      if (!res.ok) throw new Error((await res.text()) || "Не удалось разложить документы.");
      sorted.push(...((await res.json()) as { documents: SortedDoc[] }).documents);
    }
    return { sorted };
  } catch (e) {
    return { sorted: docs.map((d) => ({ kinds: guessKinds(d.name, d.text), about: "" })), error: (e as Error).message };
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

// Реквизиты из документов участника: анкет, карточки предприятия, писем, ценовых предложений.
export async function fillProfileFromDocuments(docs: MyDocument[]): Promise<{ filled: ProfileKey[]; suggestions: number }> {
  const sources = docs.filter((d) => d.kinds.some((k) => REQUISITE_KINDS.includes(k)));
  if (sources.length === 0) return { filled: [], suggestions: 0 };
  const res = await fetch("/api/my-docs/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documents: sources.map(({ name, text }) => ({ name, text })) }),
  });
  if (!res.ok) throw new Error((await res.text()) || "Не удалось заполнить реквизиты.");
  const found: ProfileFound = await res.json();
  const [profile, meta] = await Promise.all([getProfile(), getProfileMeta()]);
  const merged = mergeFound(profile, meta, found);
  await saveProfile(merged.profile, merged.meta);
  return { filled: merged.filled, suggestions: merged.meta.suggestions.length };
}
