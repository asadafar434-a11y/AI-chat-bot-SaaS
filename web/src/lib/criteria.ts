import * as z from "zod/v4";
import { plural } from "@/lib/plural";

// Критерии оценки заявок. В конкурсе и запросе предложений побеждает не меньшая цена, а больше баллов:
// цена — один критерий из нескольких, остальное дают опыт, специалисты, качество предложения.
// Критерии и их значимость заказчик указывает в извещении (ч. 4 ст. 32 44-ФЗ), порядок оценки — по постановлению
// Правительства № 2604 от 31.12.2021: критерий → показатели → детализирующие показатели, у каждого значимость в %
// и шкала или формула баллов. Модель выписывает строку на каждый пункт, за который начисляют баллы, а итоговую долю
// считает код: так цифры не зависят от арифметики модели.

const ScoreRowSchema = z.object({
  criterion: z.string().describe("Критерий, как в документе: «Цена контракта», «Квалификация участников закупки»"),
  criterionWeight: z.string().describe("Значимость критерия, как в документе, например «60 %»; пустая строка, если не указана"),
  indicator: z
    .string()
    .describe("Показатель критерия, как в документе, например «Наличие у участников закупки опыта оказания услуги»; пустая строка, если показателей нет"),
  indicatorWeight: z.string().describe("Значимость показателя внутри критерия, например «50 %»; пустая строка, если не указана или показателя нет"),
  detail: z.string().describe("Детализирующий показатель, например «Общая цена исполненных договоров»; пустая строка, если его нет"),
  detailWeight: z.string().describe("Значимость детализирующего показателя внутри показателя; пустая строка, если не указана или его нет"),
  scoring: z
    .string()
    .describe("Как начисляют баллы — простыми словами, с числами из документа: шкала или формула, предельное значение, что засчитывают и что нет"),
  proof: z.string().describe("Какие документы приложить к заявке, чтобы баллы засчитали; пустая строка, если не сказано"),
  form: z.string().describe("Форма заказчика, по которой подаются сведения, например «Приложение 1 к порядку оценки»; пустая строка, если формы нет"),
  source: z.string().describe("Где это написано, коротко: «Порядок оценки, п. 2.1»"),
  quote: z.string().describe("Дословная цитата из документа, на которой основана строка"),
});

export const CriteriaSchema = z.object({
  howWins: z
    .enum(["points", "price", "unknown"])
    .describe(
      "points — заявки оцениваются баллами по критериям (конкурс, запрос предложений); price — побеждает наименьшая цена (аукцион, запрос котировок); unknown — в документах этого нет"
    ),
  rows: z.array(ScoreRowSchema).describe("Строка на каждый пункт, за который начисляют баллы, в порядке документа"),
});

export type ScoreRow = z.infer<typeof ScoreRowSchema> & { verified: boolean };
export type Criteria = { howWins: z.infer<typeof CriteriaSchema>["howWins"]; rows: ScoreRow[] };

export const NO_CRITERIA: Criteria = { howWins: "unknown", rows: [] };

// «60 %», «60%», «60 процентов», «0,6» → 60. Не понять — null: долю тогда не считаем, показываем как в документе.
export function percentOf(text: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(%|процент)?/i.exec(text);
  if (!m) return null;
  let value = Number(m[1].replace(",", "."));
  if (!m[2] && value > 0 && value <= 1 && /[.,]/.test(m[1])) value *= 100;
  return value >= 0 && value <= 100 ? value : null;
}

// Строка оценки с долей в итоговой сотне баллов: 30 % критерия × 50 % показателя × 100 % детализирующего = 15 баллов.
// share — null, если чьей-то значимости не хватает: тогда показываем только то, что написано в документе.
export type ScoredRow = ScoreRow & { share: number | null };
export type CriterionGroup = { name: string; weight: number | null; weightText: string; rows: ScoredRow[] };

const key = (s: string) => s.trim().toLowerCase();

// Значимость уровня: как в документе, а если она не указана и на уровне один пункт — весь уровень целиком.
// Несколько пунктов без значимости делить поровну нельзя — это была бы догадка.
const levelWeight = (text: string, alone: boolean) => percentOf(text) ?? (alone ? 100 : null);

// Строки — по критериям, в порядке документа. Значимость критерия — из первой строки, где она указана.
export function groupCriteria(rows: ScoreRow[]): CriterionGroup[] {
  const groups: (CriterionGroup & { raw: ScoreRow[] })[] = [];
  for (const row of rows) {
    const name = row.criterion.trim() || "Критерий без названия";
    let group = groups.find((g) => key(g.name) === key(name));
    if (!group) {
      group = { name, weight: null, weightText: "", rows: [], raw: [] };
      groups.push(group);
    }
    if (group.weight === null && row.criterionWeight.trim()) {
      group.weight = percentOf(row.criterionWeight);
      group.weightText = row.criterionWeight.trim();
    }
    group.raw.push(row);
  }
  return groups.map(({ raw, ...group }) => {
    const indicators = new Set(raw.filter((r) => r.indicator.trim()).map((r) => key(r.indicator)));
    const rows = raw.map((row): ScoredRow => {
      const siblings = raw.filter((r) => key(r.indicator) === key(row.indicator) && r.detail.trim());
      const indicator = row.indicator.trim() ? levelWeight(row.indicatorWeight, indicators.size === 1) : 100;
      const detail = row.detail.trim() ? levelWeight(row.detailWeight, siblings.length === 1) : 100;
      const share =
        group.weight === null || indicator === null || detail === null ? null : (group.weight * indicator * detail) / 10_000;
      return { ...row, share };
    });
    return { ...group, rows };
  });
}

// Значимости критериев в сумме — 100 % (ч. 5 ст. 32 44-ФЗ). Не сходится — что-то выписано неверно или не всё.
export function weightsAddUp(groups: CriterionGroup[]): boolean {
  if (groups.length === 0 || groups.some((g) => g.weight === null)) return false;
  return Math.abs(groups.reduce((sum, g) => sum + (g.weight ?? 0), 0) - 100) < 0.5;
}

// «15 баллов», «21 балл», «7,5 балла» — сколько из итоговой сотни даёт строка или критерий.
export function pointsText(share: number): string {
  const rounded = Math.round(share * 10) / 10;
  const word = Number.isInteger(rounded) ? plural(rounded, "балл", "балла", "баллов") : "балла";
  return `${rounded.toLocaleString("ru-RU")} ${word}`;
}

// Цена — отдельно от остального: сколько из сотни решает цена, а сколько — всё остальное.
export const isPrice = (name: string) => /цен/i.test(name) && !/квалификац|характеристик|качеств/i.test(name);
