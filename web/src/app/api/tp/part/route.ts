import { claudeErrorText, NO_KEY_TEXT } from "@/lib/claude-errors";
import { askJson, cleanSamples, ModelStop, sampleBlocks } from "@/lib/claude-request";
import { MAX_CONTEXT_CHARS } from "@/lib/chat-types";
import type { PartKey } from "@/lib/my-docs";
import { partInstructions, PartDocSchema } from "@/lib/part-doc";
import { EMPTY_PROFILE, PROFILE_KEYS, type Profile } from "@/lib/profile";
import { formatRubles, rublesInWords } from "@/lib/rub-words";
import { SAMPLES_LIMIT } from "@/lib/tp";
import { PART_TITLES } from "@/lib/tp-docx";
import { badRequest, readJson, sentDocuments } from "@/lib/read-json";

export const maxDuration = 300;

const PARTS: PartKey[] = ["participant", "declaration", "price"];

const fail = (message: string, status: number) => new Response(message, { status });

// Анкета, декларация или предложение о цене — по форме заказчика и образцам участника того же вида.
// Документы закупки идут первыми, как в требованиях и ТП, поэтому читаются из общего кеша.
export async function POST(request: Request) {
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
  if (samples.reduce((sum, s) => sum + s.text.length, 0) > SAMPLES_LIMIT * 1.1) {
    return fail("Образцов слишком много — удалите в «Образцах и реквизитах» лишние.", 413);
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
      documents,
      extra: sampleBlocks(samples),
      instructions: (mask) => partInstructions(part, { title: PART_TITLES[part], profile, samples: samples.length, price: amount }, mask),
      schema: PartDocSchema,
      signal: request.signal,
    });
    return Response.json(doc);
  } catch (error) {
    console.error(error);
    return fail(error instanceof ModelStop ? error.message : claudeErrorText(error), error instanceof ModelStop ? 422 : 502);
  }
}
