import * as z from "zod/v4";
import { createLocator, describeSource, type LocatableDoc } from "@/lib/doc-locate";
import { docsKeyOfDocuments } from "@/lib/check";
import { plural } from "@/lib/plural";

// Противоречия внутри документов заказчика (пункт 52 списка «Чего продукт пока не умеет») — повод для запроса разъяснений или жалобы.
// Ищет ИИ (платно, по кнопке), а код проверяет каждую цитату: найдена ли она в документах и где именно стоит. Выдуманная цитата помечается.

const FindingSchema = z.object({
  kind: z
    .enum(["conflict", "unclear"])
    .describe("conflict — два места документов прямо противоречат друг другу; unclear — условие неясное, пропущено или может толковаться двояко"),
  what: z.string().describe("В чём противоречие, одной-двумя фразами простыми словами, с числами и номерами пунктов из документов"),
  firstQuote: z.string().describe("Дословная цитата первого места из документов закупки"),
  firstSource: z.string().describe("Где оно, коротко: «Договор, п. 10.2», «ТЗ, раздел 3»"),
  secondQuote: z.string().describe("Дословная цитата второго места, которое ему противоречит; пустая строка, если это неясность в одном месте"),
  secondSource: z.string().describe("Где второе место, коротко; пустая строка, если его нет"),
  ask: z.string().describe("Вопрос заказчику для запроса разъяснений — одной фразой, готовой к отправке"),
});

export const ContradictionsSchema = z.object({
  findings: z.array(FindingSchema).describe("Противоречия и неясности, сначала прямые противоречия; пустой список, если ничего не найдено"),
});

// Найдена ли цитата в документах (verified*) и где она стоит (…At: файл, страница, таблица, пункт).
export type ContradictionFinding = z.infer<typeof FindingSchema> & {
  firstVerified: boolean;
  secondVerified: boolean;
  firstAt?: string;
  secondAt?: string;
};

export type ContradictionsResponse = { findings: ContradictionFinding[] };

// docsKey — по каким документам проверено: документы заменили — результат устарел, и кнопка предлагает проверить заново.
export type ContradictionsResult = ContradictionsResponse & { docsKey: string; checkedAt: string };

export const contradictionsKey = docsKeyOfDocuments;

export const contradictionsStale = (result: ContradictionsResult, documents: { name: string; text: string }[]) =>
  result.docsKey !== contradictionsKey(documents);

// Места цитат в файлах закупки — по тексту документов, который есть и у сервера, и у экрана.
export function withPlaces(response: ContradictionsResponse, documents: LocatableDoc[]): ContradictionsResponse {
  const locator = createLocator(documents);
  const placeOf = (quote: string) => {
    const found = quote ? locator.locate(quote) : null;
    return found ? describeSource(found) : undefined;
  };
  return {
    findings: response.findings.map((f) => {
      const firstAt = placeOf(f.firstQuote);
      const secondAt = placeOf(f.secondQuote);
      return { ...f, ...(firstAt && { firstAt }), ...(secondAt && { secondAt }) };
    }),
  };
}

// Итог одной строкой для карточки: «Найдено: 2 противоречия, 1 неясность» / «Противоречий не найдено».
export function contradictionsSummary(result: ContradictionsResult): string {
  const conflicts = result.findings.filter((f) => f.kind === "conflict").length;
  const unclear = result.findings.length - conflicts;
  if (result.findings.length === 0) return "Противоречий не найдено";
  const parts = [
    conflicts > 0 && `${conflicts} ${plural(conflicts, "противоречие", "противоречия", "противоречий")}`,
    unclear > 0 && `${unclear} ${plural(unclear, "неясность", "неясности", "неясностей")}`,
  ].filter(Boolean);
  return `Найдено: ${parts.join(", ")}`;
}

export const CONTRADICTIONS_LIMIT_NOTE = "Документы слишком большие для этой проверки — уберите лишнее и повторите.";
