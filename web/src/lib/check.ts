import * as z from "zod/v4";
import { plural } from "@/lib/plural";

const FindingSchema = z.object({
  kind: z
    .enum(["bad", "warn"])
    .describe("bad — за это заявку могут отклонить или не дать баллы; warn — отклонить не должны, но лучше поправить"),
  what: z.string().describe("Что не так, одной фразой простыми словами, например «Зал на 120 мест, а по ТЗ нужно не меньше 150»"),
  todo: z.string().describe("Что исправить в заявке, одной фразой, например «Укажите зал вместимостью от 150 мест»"),
  source: z.string().describe("Где требование в документах закупки, коротко: «ТЗ, п. 2.1», «Извещение, раздел 5»"),
  quote: z.string().describe("Дословная цитата требования из документов закупки"),
  inApplication: z
    .string()
    .describe("Дословная цитата из заявки, где ошибка; пустая строка, если нужного в заявке нет совсем"),
});

export const CheckSchema = z.object({
  findings: z.array(FindingSchema).describe("Ошибки и замечания, сначала ошибки, в порядке документов закупки"),
  okCount: z.number().int().describe("Сколько проверенных требований заявка выполняет без замечаний"),
});

// verified — цитата требования нашлась в документах закупки, appVerified — цитата заявки нашлась в заявке.
export type CheckFinding = z.infer<typeof FindingSchema> & { verified: boolean; appVerified: boolean };
export type CheckResponse = { findings: CheckFinding[]; okCount: number };

// files — какие файлы заявки проверены; docsKey — какие документы закупки были на момент проверки.
export type CheckResult = CheckResponse & { files: string[]; docsKey: string; checkedAt: string };

export const docsKeyOf = (files: string[]) => files.join("\n");

// Заявка и документы закупки вместе не должны раздуть запрос: заявка обычно в разы короче ТЗ.
export const APPLICATION_LIMIT = 200_000;

export function checkCounts(check: CheckResult) {
  const bad = check.findings.filter((f) => f.kind === "bad").length;
  return { bad, warn: check.findings.length - bad };
}

// Итог проверки одной строкой — для экрана закупки и списка закупок.
export function checkSummary(check: CheckResult): { text: string; tone: "bad" | "warn" | "ok" } {
  const { bad, warn } = checkCounts(check);
  const warns = `${warn} ${plural(warn, "замечание", "замечания", "замечаний")}`;
  if (bad) {
    return { text: `${bad} ${plural(bad, "ошибка", "ошибки", "ошибок")}${warn ? `, ${warns}` : ""}`, tone: "bad" };
  }
  if (warn) return { text: warns, tone: "warn" };
  return { text: "Ошибок нет", tone: "ok" };
}
