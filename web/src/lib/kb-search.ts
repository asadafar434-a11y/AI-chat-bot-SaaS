import "server-only";
import { orgScope } from "../server/db/org-scope.ts";
import { cosine, tokensOf, type Embedder } from "./kb-embed.ts";
import type { KbStore } from "./kb-store.ts";
import { AUTHORITY_RANK, authorityOf, KbError, type Authority, type KbFilter, type KbMeta } from "./kb-types.ts";

// Поиск по базе знаний: два способа, результаты сливаются. Векторный (косинус) находит похожее по смыслу
// и с другими окончаниями. Ключевой (BM25 по основам слов) находит точные номера и названия: «ст. 12», «44-ФЗ».
// Слияние — по позициям в каждом списке (Reciprocal Rank Fusion), без подбора весов.
//
// Видимость обязательна: без неё поиск не запускается. Глобальная база видна всем, документы организации —
// только ей. Никакого «искать везде» по умолчанию быть не может.

export const MIN_SIMILARITY = 0.1;
const RRF_K = 60;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
export const TOP_K_DEFAULT = 5;
// Не больше двух фрагментов одного документа в выдаче: иначе одна статья заняла бы весь контекст.
export const PER_DOCUMENT_MAX = 2;
export const TOP_K_MAX = 20;

export type Visibility = { organizationId: string | null };

export type SearchInput = {
  query: string;
  visibility: Visibility;
  filter?: KbFilter;
  topK?: number;
};

export type Hit = {
  chunkId: string;
  documentId: string;
  documentName: string;
  sourceKey: string;
  version: number;
  heading: string | null;
  text: string;
  meta: KbMeta;
  authority: Authority;
  /** Место источника по приоритету: меньше — важнее (см. AUTHORITY_RANK). */
  authorityRank: number;
  /** Косинусное сходство, 0..1 (для локального эмбеддера — лексически-морфологическое). */
  similarity: number;
  /** Оценка BM25 по ключевым словам; 0 — слов запроса во фрагменте нет. */
  keywordScore: number;
  /** Итог слияния двух списков. Сравнивать можно только внутри одного ответа. */
  score: number;
};

export function visibleOwnerKeys(visibility: Visibility): string[] {
  if (!visibility || typeof visibility !== "object" || !("organizationId" in visibility)) {
    throw new KbError("invalid_scope", "видимость не задана: укажите организацию или null");
  }
  if (visibility.organizationId === null) return ["global"];
  try {
    return ["global", `org:${orgScope(visibility.organizationId).organizationId}`];
  } catch {
    throw new KbError("invalid_scope", "организация задана некорректно");
  }
}

// Строгое совпадение: если фильтр задан, документ без такого значения не проходит.
export function matchesFilter(meta: KbMeta, filter: KbFilter = {}): boolean {
  return (Object.keys(filter) as (keyof KbFilter)[]).every((key) => filter[key] === undefined || meta[key] === filter[key]);
}

type Candidate = Awaited<ReturnType<KbStore["searchable"]>>[number];

function bm25(queryTokens: string[], docs: string[][]): number[] {
  const n = docs.length;
  const avg = docs.reduce((s, d) => s + d.length, 0) / Math.max(1, n);
  const df = new Map<string, number>();
  for (const q of queryTokens) df.set(q, docs.filter((d) => d.includes(q)).length);
  return docs.map((doc) => {
    let score = 0;
    for (const q of queryTokens) {
      const tf = doc.filter((t) => t === q).length;
      if (!tf) continue;
      const idf = Math.log(1 + (n - df.get(q)! + 0.5) / (df.get(q)! + 0.5));
      score += idf * ((tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + (BM25_B * doc.length) / (avg || 1))));
    }
    return score;
  });
}

/** Поиск фрагментов. Возвращает не больше topK, по убыванию итоговой оценки. Пустой запрос — пустой ответ. */
export async function searchKnowledge(store: KbStore, embedder: Embedder, input: SearchInput): Promise<Hit[]> {
  const ownerKeys = visibleOwnerKeys(input.visibility);
  const topK = Math.min(TOP_K_MAX, Math.max(1, Math.floor(input.topK ?? TOP_K_DEFAULT)));
  const queryTokens = [...new Set(tokensOf(input.query))];
  if (queryTokens.length === 0) return [];

  const candidates: Candidate[] = (await store.searchable(ownerKeys)).filter(
    (c) => matchesFilter(c.document.meta, input.filter) && c.chunk.embeddingModel === embedder.id,
  );
  if (candidates.length === 0) return [];

  const [queryVector] = await embedder.embed([input.query]);
  const similarity = candidates.map((c) => cosine(queryVector, c.chunk.embedding));
  const keyword = bm25(
    queryTokens,
    candidates.map((c) => tokensOf(c.chunk.heading ? `${c.chunk.heading}\n${c.chunk.text}` : c.chunk.text)),
  );

  const byVector = candidates
    .map((_, i) => i)
    .filter((i) => similarity[i] >= MIN_SIMILARITY)
    .sort((a, b) => similarity[b] - similarity[a]);
  const byKeyword = candidates
    .map((_, i) => i)
    .filter((i) => keyword[i] > 0)
    .sort((a, b) => keyword[b] - keyword[a]);

  const fused = new Map<number, number>();
  for (const list of [byVector, byKeyword]) {
    list.forEach((i, rank) => fused.set(i, (fused.get(i) ?? 0) + 1 / (RRF_K + rank + 1)));
  }

  const ranked = [...fused.entries()].sort((a, b) => b[1] - a[1] || similarity[b[0]] - similarity[a[0]]);
  const perDocument = new Map<string, number>();
  const picked: [number, number][] = [];
  for (const [i, score] of ranked) {
    const docId = candidates[i].document.id;
    const count = perDocument.get(docId) ?? 0;
    if (count >= PER_DOCUMENT_MAX) continue;
    perDocument.set(docId, count + 1);
    picked.push([i, score]);
    if (picked.length === topK) break;
  }

  return picked.map(([i, score]) => {
    const { document: doc, chunk } = candidates[i];
    const authority = authorityOf(doc.meta.documentType);
    return {
      chunkId: chunk.id,
      documentId: doc.id,
      documentName: doc.name,
      sourceKey: doc.sourceKey,
      version: doc.version,
      heading: chunk.heading,
      text: chunk.text,
      meta: doc.meta,
      authority,
      authorityRank: AUTHORITY_RANK[authority],
      similarity: similarity[i],
      keywordScore: keyword[i],
      score,
    };
  });
}
