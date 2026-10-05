import { appIdOf, requireAiAuth } from "@/lib/ai-guard";
import { claudeErrorText, NO_KEY_TEXT } from "@/lib/claude-errors";
import { askJson, cleanSamples, ModelStop, sampleBlocks } from "@/lib/claude-request";
import { MAX_CONTEXT_CHARS } from "@/lib/chat-types";
import { EVIDENCE_LIMIT, isEvidencePart, type PartKey } from "@/lib/my-docs";
import { partInstructions, PartDocSchema } from "@/lib/part-doc";
import { EMPTY_PROFILE, PROFILE_KEYS, type Profile } from "@/lib/profile";
import { formatRubles, rublesInWords } from "@/lib/rub-words";
import { SAMPLES_LIMIT } from "@/lib/tp";
import { PART_TITLES } from "@/lib/tp-parts";
import { badRequest, readJson, sentDocuments } from "@/lib/read-json";

export const maxDuration = 300;

const PARTS: PartKey[] = ["participant", "declaration", "price", "experience", "staff"];

// Выписка из порядка оценки по показателю — строки, которые прислал браузер из разобранных критериев.
const field = (row: Record<string, unknown>, key: string) => String(row[key] ?? "").trim().slice(0, 2000);
function criteriaText(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  return raw
    .slice(0, 10)
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    .map((row) =>
      [
        `- ${[field(row, "criterion"), field(row, "indicator"), field(row, "detail")].filter(Boolean).join(" → ")}`,
        field(row, "criterionWeight") && `  Значимость: критерий ${field(row, "criterionWeight")}${field(row, "indicatorWeight") ? `, показатель ${field(row, "indicatorWeight")}` : ""}${field(row, "detailWeight") ? `, детализирующий ${field(row, "detailWeight")}` : ""}`,
        field(row, "scoring") && `  Как считают: ${field(row, "scoring")}`,
        field(row, "proof") && `  Что приложить: ${field(row, "proof")}`,
        field(row, "form") && `  Форма: ${field(row, "form")}`,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n");
}

const fail = (message: string, status: number) => new Response(message, { status });

// Анкета, декларация или предложение о цене — по форме заказчика и образцам участника того же вида.
// Сведения об опыте и о специалистах — по форме заказчика из договоров и документов сотрудников участника.
// Документы закупки идут первыми, как в требованиях и ТП, поэтому читаются из общего кеша.
export async function POST(request: Request) {
  const denied = await requireAiAuth(request);
  if (denied) return denied;
  const body = await readJson(request);
  if (!body) return badRequest();
  const part = PARTS.find((p) => p === body.part);
  if (!part) return fail("Неизвестная часть заявки.", 400);
  const documents = sentDocuments(body.documents);
  if (documents.length === 0) return fail("В закупке нет документов.", 400);
  if (documents.reduce((sum, d) => sum + d.text.length, 0) > MAX_CONTEXT_CHARS) {
    return fail("Документы закупки слишком большие — уберите лишние файлы.", 413);
  }
  const samples = cleanSamples(body.samples);
  const evidence = isEvidencePart(part);
  if (samples.reduce((sum, s) => sum + s.text.length, 0) > (evidence ? EVIDENCE_LIMIT : SAMPLES_LIMIT) * 1.1) {
    return fail(
      evidence
        ? "Документов для сведений слишком много — оставьте в «Образцах и реквизитах» самые подходящие."
        : "Образцов слишком много — удалите в «Образцах и реквизитах» лишние.",
      413
    );
  }
  const raw = body.profile && typeof body.profile === "object" ? (body.profile as Record<string, unknown>) : null;
  const profile: Profile | null = raw
    ? { ...EMPTY_PROFILE, ...Object.fromEntries(PROFILE_KEYS.map((key) => [key, String(raw[key] ?? "").slice(0, 500)])) }
    : null;
  const price = Number(body.price);
  const amount = Number.isFinite(price) && price > 0 ? `${formatRubles(price)} руб. (${rublesInWords(price)})` : null;
  if (!process.env.ANTHROPIC_API_KEY) return fail(NO_KEY_TEXT, 503);

  try {
    const doc = await askJson({
      label: `part ${part}`,
      appId: appIdOf(request),
      documents,
      extra: sampleBlocks(samples, evidence ? "Документ участника" : "Образец участника"),
      instructions: (mask) =>
        partInstructions(
          part,
          { title: PART_TITLES[part], profile, samples: samples.length, price: amount, criteria: evidence ? criteriaText(body.criteria) : "" },
          mask
        ),
      schema: PartDocSchema,
      signal: request.signal,
    });
    return Response.json(doc);
  } catch (error) {
    console.error(error);
    return fail(error instanceof ModelStop ? error.message : claudeErrorText(error), error instanceof ModelStop ? 422 : 502);
  }
}
