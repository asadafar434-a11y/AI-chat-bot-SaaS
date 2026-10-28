import * as z from "zod/v4";
import { docsKeyOfDocuments } from "@/lib/check";
import { createLocator, describeSource, type LocatableDoc } from "@/lib/doc-locate";
import { plural } from "@/lib/plural";

// Детектор скрытых требований, неоднозначностей и условий допуска.
// Ищет ИИ (платно, по кнопке), а код проверяет каждую цитату по тексту документов и находит её место:
// файл, страница, таблица, пункт. Выдуманная цитата остаётся, но помечается — как в противоречиях (lib/contradictions.ts).

export const HIDDEN_KINDS = ["direct", "hidden", "ambiguity", "conflict", "missing", "legal", "financial"] as const;
export type HiddenKind = (typeof HIDDEN_KINDS)[number];

export const CRITICALITIES = ["critical", "high", "medium", "low"] as const;
export type Criticality = (typeof CRITICALITIES)[number];

const FindingSchema = z.object({
  kind: z
    .enum(HIDDEN_KINDS)
    .describe(
      "direct — прямое требование, которое легко пропустить; hidden — неочевидное требование из приложения, сноски, таблицы или договора; ambiguity — формулировка допускает несколько трактовок; conflict — документы расходятся между собой; missing — нужной информации в документах нет; legal — вопрос требует правовой проверки; financial — финансовый или исполнительский риск",
    ),
  criticality: z
    .enum(CRITICALITIES)
    .describe(
      "critical — может помешать участию, привести к отклонению заявки или сделать исполнение невозможным; high — значительные расходы, сложность исполнения или серьёзная неопределённость; medium — требует проверки, документов, ресурсов или уточнения; low — требует внимания, но не выглядит существенным препятствием",
    ),
  title: z.string().describe("Короткое название проблемы, до 80 знаков, простыми словами"),
  what: z.string().describe("Что обнаружено: точная формулировка требования или краткое содержание, с числами и номерами пунктов"),
  quote: z.string().describe("Дословная цитата из документов закупки, без пересказа, сокращений и многоточий"),
  source: z.string().describe("Где это написано, коротко: «ТЗ, п. 5.2», «Договор, раздел 3», «Приложение 1, таблица 2»"),
  why: z.string().describe("Почему это важно для участника: последствия требования или неоднозначности"),
  interpretations: z
    .string()
    .describe("Возможные трактовки и чем они отличаются по последствиям; пустая строка, если это не неоднозначность"),
  risk: z.string().describe("Риск для участника: отклонение, расходы, задержка, сложность исполнения. Если риск не подтверждён — пометить как потенциальный"),
  check: z.string().describe("Что проверить или подтвердить до подачи заявки: документы, ресурсы, внешние требования"),
  action: z.string().describe("Конкретный следующий шаг участника"),
  ask: z.string().describe("Готовый нейтральный вопрос заказчику для запроса разъяснений; пустая строка, если уточнение не нужно"),
});

export const HiddenRequirementsSchema = z.object({
  findings: z.array(FindingSchema).describe("Найденные проблемы, самые значимые первыми; пустой список, если ничего не найдено"),
});

// verified — цитата дословно найдена в документах закупки, at — её место (файл, страница, таблица, пункт).
export type HiddenFinding = z.infer<typeof FindingSchema> & { verified: boolean; at?: string };

export type HiddenRequirementsResponse = { findings: HiddenFinding[] };

// docsKey — по каким документам проверено: документы заменили — результат устарел.
export type HiddenRequirementsResult = HiddenRequirementsResponse & { docsKey: string; checkedAt: string };

export const hiddenRequirementsKey = docsKeyOfDocuments;

export const hiddenRequirementsStale = (result: HiddenRequirementsResult, documents: { name: string; text: string }[]) =>
  result.docsKey !== hiddenRequirementsKey(documents);

export const KIND_TEXT: Record<HiddenKind, string> = {
  direct: "Прямое требование",
  hidden: "Скрытое требование",
  ambiguity: "Неоднозначность",
  conflict: "Противоречие",
  missing: "Не хватает данных",
  legal: "Правовой вопрос",
  financial: "Деньги и расходы",
};

export const CRITICALITY_TEXT: Record<Criticality, string> = {
  critical: "Критический",
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
};

const CRITICALITY_ORDER: Record<Criticality, number> = { critical: 0, high: 1, medium: 2, low: 3 };

// Сначала критическое, потом высокое и далее; внутри одной важности порядок модели сохраняется.
export const sortHiddenFindings = <T extends { criticality: Criticality }>(findings: T[]): T[] =>
  [...findings].sort((a, b) => CRITICALITY_ORDER[a.criticality] - CRITICALITY_ORDER[b.criticality]);

// Места цитат в файлах закупки — по тексту документов, который есть и у сервера, и у экрана.
export function withPlaces(response: HiddenRequirementsResponse, documents: LocatableDoc[]): HiddenRequirementsResponse {
  const locator = createLocator(documents);
  return {
    findings: response.findings.map((f) => {
      const found = f.quote ? locator.locate(f.quote) : null;
      return { ...f, ...(found && { at: describeSource(found) }) };
    }),
  };
}

export type HiddenCounts = {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  // Сколько находок требуют вопроса заказчику.
  withQuestion: number;
};

export function hiddenRequirementsCounts(result: HiddenRequirementsResponse): HiddenCounts {
  const counts: HiddenCounts = { total: result.findings.length, critical: 0, high: 0, medium: 0, low: 0, withQuestion: 0 };
  for (const f of result.findings) {
    counts[f.criticality] += 1;
    if (f.ask) counts.withQuestion += 1;
  }
  return counts;
}

// Итог одной строкой для карточки: «Найдено: 3 момента, из них критических — 1, высоких — 2».
export function hiddenRequirementsSummary(result: HiddenRequirementsResponse): string {
  const { total, critical, high } = hiddenRequirementsCounts(result);
  if (total === 0) return "Скрытых требований и неоднозначностей не найдено";
  const main = `Найдено: ${total} ${plural(total, "момент", "момента", "моментов")}`;
  const parts = [critical > 0 && `критических — ${critical}`, high > 0 && `высоких — ${high}`].filter(Boolean);
  return parts.length > 0 ? `${main}, из них ${parts.join(", ")}` : main;
}

export type HiddenFilter = { criticality: Criticality | "all"; kind: HiddenKind | "all" };

export const filterHiddenFindings = <T extends { criticality: Criticality; kind: HiddenKind }>(findings: T[], filter: HiddenFilter): T[] =>
  findings.filter(
    (f) => (filter.criticality === "all" || f.criticality === filter.criticality) && (filter.kind === "all" || f.kind === filter.kind),
  );

export const HIDDEN_REQUIREMENTS_LIMIT_NOTE = "Документы слишком большие для этой проверки — уберите лишнее и повторите.";
