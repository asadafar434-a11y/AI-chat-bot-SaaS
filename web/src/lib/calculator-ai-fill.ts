import "server-only";
import * as z from "zod/v4";
import { ANALYSIS_MODEL } from "@/lib/claude";
import { askJson } from "@/lib/claude-request";
import type { SentDocument } from "@/lib/read-documents";
import type { CalculatorFieldSchema } from "@/lib/core/calculators/types";

export type AiFillField = Pick<CalculatorFieldSchema, "key" | "label" | "kind" | "unit">;

export type AiFillResult = {
  values: Record<string, number | string | boolean>;
  note: string;
  hiddenCosts: string[];
};

const ResponseSchema = z.object({
  values: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).default({}),
  note: z.string().default(""),
  hiddenCosts: z.array(z.string()).default([]),
});

function fieldLines(fields: AiFillField[], currentValues: Record<string, unknown>): string {
  return fields
    .map((field) => {
      const current = currentValues[field.key];
      const unit = field.unit ? ` (${field.unit})` : "";
      const has = current === undefined || current === null || current === "" ? "— не заполнено" : `— уже заполнено: ${String(current)}, не меняй`;
      return `- ${field.key}: "${field.label}"${unit}, тип ${field.kind} ${has}`;
    })
    .join("\n");
}

/**
 * Подставляет недостающие значения калькулятора оценкой ИИ. Без документов — по рыночным
 * ориентирам (не факт, оценка). С документами закупки (загруженными или выбранными из уже
 * открытой закупки) — модель сначала ищет цифры и скрытые/неочевидные расходы в самих
 * документах (условия договора, объёмы, требования к персоналу и технике), и только то, чего
 * там нет, оценивает по рынку — это тоже помечено в `note`, не как факт из документа.
 */
export async function fillCalculatorValues(
  sphereLabel: string,
  fields: AiFillField[],
  currentValues: Record<string, unknown>,
  documents: SentDocument[],
  appId: string | null,
): Promise<AiFillResult> {
  const emptyFields = fields.filter((field) => {
    const value = currentValues[field.key];
    return value === undefined || value === null || value === "";
  });
  if (emptyFields.length === 0) return { values: {}, note: "Все поля уже заполнены.", hiddenCosts: [] };

  const hasDocuments = documents.length > 0;
  const task = [
    `Ты оцениваешь цифры в рублях для расчёта по закупке в сфере «${sphereLabel}» (44-ФЗ/223-ФЗ, Россия).`,
    hasDocuments
      ? `В начале запроса — документы этой закупки. Сначала ищи цифры и условия ПРЯМО в документах (объёмы, ставки, сроки, требования к персоналу и технике, условия договора). Если в документах есть расходы, которые легко упустить при оценке цены (штрафы, резервы, обязательные работы после поставки, доп. требования к персоналу/технике, ограничения по срокам, удержания из платежей) — перечисли их в "hiddenCosts" короткими пунктами со ссылкой на условие, даже если они не входят в поля калькулятора ниже.`
      : `Документов закупки нет — используй свои знания о рыночных ориентирах (зарплаты, аренда техники, тарифы) для России. Это оценка, не факт.`,
    `Поля калькулятора:`,
    fieldLines(emptyFields, currentValues),
    ``,
    `Предложи значения ТОЛЬКО для полей без значения, не трогай уже заполненные. Если для поля нет разумной оценки — пропусти его, не выдумывай.`,
    `В "note" — одна-две строки: на основе чего оценил (документы или рыночные ориентиры), с оговоркой, что это не факт.`,
  ].join("\n");

  const result = await askJson({
    label: "calculator.ai_fill",
    documents,
    instructions: task,
    schema: ResponseSchema,
    model: ANALYSIS_MODEL,
    appId,
    cache: false,
  });

  const allowedKeys = new Set(emptyFields.map((field) => field.key));
  const values: Record<string, number | string | boolean> = {};
  for (const [key, value] of Object.entries(result.values)) {
    if (!allowedKeys.has(key)) continue;
    const field = emptyFields.find((item) => item.key === key)!;
    if (field.kind === "number" && typeof value === "number" && Number.isFinite(value)) values[key] = value;
    else if (field.kind === "boolean" && typeof value === "boolean") values[key] = value;
    else if ((field.kind === "string" || field.kind === "date") && typeof value === "string" && value.trim()) values[key] = value.trim();
  }

  return {
    values,
    note: result.note || "Ориентир ИИ — проверьте цифры перед расчётом.",
    hiddenCosts: result.hiddenCosts,
  };
}
