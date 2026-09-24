import * as z from "zod/v4";

export const TpDraftSchema = z.object({
  subject: z.string().describe("Предмет закупки из ТЗ одной строкой; пустая строка, если не указан"),
  items: z.array(
    z.object({
      clause: z.string().describe("Номер пункта ТЗ, как в документе, например «2.1»; пустая строка, если номера нет"),
      topic: z.string().describe("Короткое название требования, 1–3 слова"),
      requirement: z.string().describe("Суть требования заказчика своими словами, коротко"),
      quote: z.string().describe("Дословная цитата из ТЗ, на которой основан пункт"),
      offer: z.string().describe("Текст предложения участника; неизвестные данные участника — в квадратных скобках с подсказкой"),
    })
  ),
});

export type TpDraft = z.infer<typeof TpDraftSchema>;
export type TpItem = TpDraft["items"][number] & { verified: boolean };

export type TpResponse = {
  mode: "ai" | "demo";
  notice?: string;
  subject: string;
  items: TpItem[];
};

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»“”„"]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[­​]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Цитата засчитывается, только если каждый её фрагмент (между многоточиями) есть в тексте документов:
// так модель не может выдать пересказ или выдумку за слова заказчика.
export function quoteFound(quote: string, documents: string[]): boolean {
  const fragments = quote
    .split(/\.{3}|…/)
    .map(normalize)
    .filter((f) => f.length >= 8);
  if (fragments.length === 0) return false;
  const texts = documents.map(normalize);
  return fragments.every((f) => texts.some((t) => t.includes(f)));
}
