import { claudeErrorText, NO_KEY_TEXT } from "@/lib/claude-errors";
import { askJson, cleanSamples, ModelStop, sampleBlocks } from "@/lib/claude-request";
import { MAX_CONTEXT_CHARS } from "@/lib/chat-types";
import { quoteFound } from "@/lib/quotes";
import type { SentDocument } from "@/lib/read-documents";
import { SAMPLES_LIMIT, TpDraftSchema, type TpResponse } from "@/lib/tp";
import { SAMPLES_NOTE, TP_INSTRUCTIONS } from "@/lib/tp-prompt";

export const maxDuration = 300;

type TpRequest = { documents?: SentDocument[]; samples?: unknown };

const fail = (message: string, status: number) => new Response(message, { status });

export async function POST(request: Request) {
  const { documents = [], samples: rawSamples }: TpRequest = await request.json();
  const samples = cleanSamples(rawSamples);
  if (samples.reduce((sum, s) => sum + s.text.length, 0) > SAMPLES_LIMIT * 1.1) {
    return fail("Образцов слишком много — удалите в «Образцах и реквизитах» лишние технические предложения.", 413);
  }
  if (!process.env.ANTHROPIC_API_KEY) return fail(NO_KEY_TEXT, 503);

  if (documents.length === 0) return fail("В закупке нет документов — добавьте ТЗ.", 400);
  const total = documents.reduce((sum, d) => sum + d.text.length, 0);
  if (total > MAX_CONTEXT_CHARS) {
    return fail(
      `Документы слишком большие: ${total.toLocaleString("ru-RU")} символов при лимите ${MAX_CONTEXT_CHARS.toLocaleString("ru-RU")}. Уберите из закупки лишние файлы.`,
      413
    );
  }

  try {
    const draft = await askJson({
      label: "tp",
      documents,
      extra: sampleBlocks(samples),
      instructions: samples.length ? SAMPLES_NOTE + TP_INSTRUCTIONS : TP_INSTRUCTIONS,
      schema: TpDraftSchema,
      signal: request.signal,
    });

    const texts = documents.map((d) => d.text);
    const checked = <T extends { quote: string }>(item: T) => ({ ...item, verified: quoteFound(item.quote, texts) });
    const body: TpResponse = {
      form: draft.form,
      goods: draft.goods.map(checked),
      items: draft.items.map(checked),
      antiDumping: draft.antiDumping.rule
        ? checked(draft.antiDumping)
        : { ...draft.antiDumping, verified: false },
    };
    return Response.json(body);
  } catch (error) {
    console.error(error);
    return fail(error instanceof ModelStop ? error.message : claudeErrorText(error), error instanceof ModelStop ? 422 : 502);
  }
}
