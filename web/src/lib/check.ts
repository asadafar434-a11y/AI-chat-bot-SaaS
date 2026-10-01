import * as z from "zod/v4";
import { createLocator, describeSource, type LocatableDoc } from "@/lib/doc-locate";
import { fingerprint } from "@/lib/fingerprint";
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

// verified — цитата требования нашлась в документах закупки, appVerified — цитата заявки нашлась в заявке,
// inApplicationAt — где в файле заявки стоит эта цитата, например «Заявка.docx» — стр. 3, таблица 1, строка 2.
export type CheckFinding = z.infer<typeof FindingSchema> & { verified: boolean; appVerified: boolean; inApplicationAt?: string };
export type CheckResponse = { findings: CheckFinding[]; okCount: number };

// Место цитаты из заявки узнаём сразу, пока тексты загруженных файлов заявки в руках: потом их в закупке уже нет.
export function withApplicationPlaces(response: CheckResponse, application: LocatableDoc[]): CheckResponse {
  const locator = createLocator(application);
  return {
    ...response,
    findings: response.findings.map((f) => {
      const place = f.inApplication ? locator.locate(f.inApplication) : null;
      return place ? { ...f, inApplicationAt: describeSource(place) } : f;
    }),
  };
}

// files — какие файлы заявки проверены; docsKey — какие документы закупки были на момент проверки;
// inputKey — отпечаток файлов заявки и документов закупки: тот же отпечаток — та же проверка, ИИ не нужен.
export type CheckResult = CheckResponse & { files: string[]; docsKey: string; checkedAt: string; inputKey?: string };

// Отпечаток проверки: имена, размеры и даты файлов заявки и список документов закупки. Файл заменили —
// у него другой размер или дата, и проверка идёт заново.
export const checkInputKey = (files: { name: string; size: number; lastModified: number }[], docsKey: string) =>
  JSON.stringify([docsKey, ...files.map((f) => [f.name, f.size, f.lastModified])]);

// Прежний отпечаток — только имена файлов: сохранённые проверки помнят именно его.
export const docsKeyOf = (files: string[]) => files.join("\n");

// Отпечаток документов закупки: имя и содержимое каждого. Документ заменили более новой версией с тем же именем — отпечаток
// другой, и проверка по старой версии не считается актуальной (по одним именам файлов этого не видно). Порядок файлов
// не важен: добавка того же файла переставляет его в конец, а документы остались те же.
export const docsKeyOfDocuments = (documents: { name: string; text: string }[]) =>
  documents
    .map((d) => `${d.name}\t${fingerprint(d.text)}`)
    .sort()
    .join("\n");

// Проверка сделана по этим же документам? У проверок, сохранённых раньше, отпечаток — одни имена: их сравниваем по именам.
export function sameDocuments(savedKey: string, documents: { name: string; text: string }[]): boolean {
  const legacy = !savedKey.includes("\t");
  return savedKey === (legacy ? docsKeyOf(documents.map((d) => d.name)) : docsKeyOfDocuments(documents));
}

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
