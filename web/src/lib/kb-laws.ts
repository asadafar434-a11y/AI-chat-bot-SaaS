import "server-only";
import law44 from "@/data/laws/44-fz.json";
import law223 from "@/data/laws/223-fz.json";
import { ingestDocument, type IngestResult } from "./kb-ingest.ts";
import type { Embedder } from "./kb-embed.ts";
import type { KbStore } from "./kb-store.ts";
import type { KbMeta, LAW_TYPES } from "./kb-types.ts";

// Первое наполнение базы знаний: статьи 44-ФЗ и 223-ФЗ из репозитория (тексты с официального портала pravo.gov.ru,
// обновляются scripts/fetch-laws.mjs). Это нормативный источник: ранг «normative», надёжность «official».
// Одна статья — один документ: поиск по номеру и названию попадает точно, а в ответ уходят только нужные статьи.

type Article = { num: string; title: string; chapter: string; section?: string; text: string };
type Law = {
  name: string;
  title: string;
  edition: { rdk: string; label: string; date: string; by: string };
  source: string;
  repealed: string[];
  articles: Article[];
};

const LAWS: { law: Law; lawType: (typeof LAW_TYPES)[number] }[] = [
  { law: law44 as Law, lawType: "44-FZ" },
  { law: law223 as Law, lawType: "223-FZ" },
];

const repealed = (a: Article) => !a.title && /^\(Статья утратила силу/.test(a.text);

/** Год редакции из даты вида «04.08.2026». */
const yearOf = (date: string): number | null => {
  const year = Number(date.slice(-4));
  return Number.isInteger(year) && year >= 1990 ? year : null;
};

export type SeedSummary = { documents: number; created: number; updated: number; metadataUpdated: number; unchanged: number; embedded: number; reused: number };

/** Загружает или обновляет статьи законов. Повторный запуск без изменений ничего не пересчитывает. */
export async function seedLawsIntoKnowledgeBase(store: KbStore, embedder: Embedder, approvedBy: string, now = new Date()): Promise<SeedSummary> {
  const summary: SeedSummary = { documents: 0, created: 0, updated: 0, metadataUpdated: 0, unchanged: 0, embedded: 0, reused: 0 };
  for (const { law, lawType } of LAWS) {
    for (const article of law.articles) {
      if (repealed(article) || !article.text.trim()) continue;
      const topic = article.chapter.length <= 120 ? article.chapter : null;
      const meta: Partial<KbMeta> & { documentType: "law" } = {
        documentType: "law",
        lawType,
        topic,
        year: yearOf(law.edition.date),
        edition: law.edition.label,
        reliability: "official",
      };
      const heading = article.title ? `Статья ${article.num}. ${article.title}` : `Статья ${article.num}`;
      const result: IngestResult = await ingestDocument(
        store,
        embedder,
        {
          owner: { kind: "global", approvedBy },
          sourceKey: `law:${lawType}:art:${article.num}`,
          name: `${law.name}, ст. ${article.num}${article.title ? `. ${article.title}` : ""}`,
          source: law.source,
          text: `${heading}\n\n${article.text}`,
          meta,
        },
        now,
      );
      summary.documents++;
      summary.embedded += result.embedded;
      summary.reused += result.reused;
      if (result.status === "created") summary.created++;
      else if (result.status === "updated") summary.updated++;
      else if (result.status === "metadata_updated") summary.metadataUpdated++;
      else summary.unchanged++;
    }
  }
  return summary;
}
