import { appIdOf, requireAiAuth } from "@/lib/ai-guard";
import { castFromDraft } from "@/lib/cast";
import { claudeErrorText, NO_KEY_TEXT } from "@/lib/claude-errors";
import { askJson, cleanSamples, ModelStop, sampleBlocks } from "@/lib/claude-request";
import { MAX_CONTEXT_CHARS } from "@/lib/chat-types";
import { quoteChecker } from "@/lib/quotes";
import { SAMPLES_LIMIT, TpDraftSchema, type TpResponse } from "@/lib/tp";
import { guardContext, guardOffer, ownConditions } from "@/lib/tp-guard";
import { SAMPLES_NOTE, TP_INSTRUCTIONS } from "@/lib/tp-prompt";
import { DRAFT_TP_KB_QUERY, draftKnowledgeBlock, knowledgeTextBlock } from "@/lib/kb-check";
import { badRequest, readJson, sentDocuments } from "@/lib/read-json";

export const maxDuration = 300;

const fail = (message: string, status: number) => new Response(message, { status });

export async function POST(request: Request) {
  const denied = await requireAiAuth(request);
  if (denied) return denied;
  const body = await readJson(request);
  if (!body) return badRequest();
  const documents = sentDocuments(body.documents);
  const samples = cleanSamples(body.samples);
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
    // Фрагменты базы знаний — после образцов и только как справка (правило приоритета — в тексте блока).
    const knowledge = await draftKnowledgeBlock(DRAFT_TP_KB_QUERY);
    const draft = await askJson({
      label: "tp",
      appId: appIdOf(request),
      documents,
      extra: [...sampleBlocks(samples), ...(knowledge ? [knowledgeTextBlock(knowledge)] : [])],
      instructions: samples.length ? SAMPLES_NOTE + TP_INSTRUCTIONS : TP_INSTRUCTIONS,
      schema: TpDraftSchema,
      signal: request.signal,
    });

    const found = quoteChecker(documents.map((d) => d.text));
    const checked = <T extends { quote: string }>(item: T) => ({ ...item, verified: found(item.quote) });

    // Заказчик требует — участник предлагает: число, которое повторяет границу заказчика или придумано рядом с ней, в предложении
    // участника не остаётся — на его месте пустое место «[число, не меньше N]» (tp-guard.ts). Что ответит модель, неизвестно,
    // поэтому это делает код, а не только инструкция.
    const guard = guardContext(documents.map((d) => d.text));
    let blanked = 0;
    const own = <T extends { offer: string; quote: string; requirement: string }>(item: T): T => {
      const result = guardOffer(item.offer, ownConditions(item.quote, item.requirement), guard);
      blanked += result.hits.length;
      return { ...item, offer: result.text };
    };
    const goods = draft.goods.map((g) => {
      const result = guardOffer(g.characteristics, ownConditions(g.quote, g.name), guard);
      blanked += result.hits.length;
      return { ...g, characteristics: result.text };
    });
    const items = draft.items.map(own);
    if (blanked > 0) console.log(`[ТП] значений участника оставлено пустыми: ${blanked} — ИИ взял их с границы требования заказчика`);

    const body: TpResponse = {
      form: draft.form,
      goods: goods.map(checked),
      items: items.map(checked),
      detectedForms: draft.detectedForms,
      antiDumping: draft.antiDumping.rule
        ? checked(draft.antiDumping)
        : { ...draft.antiDumping, verified: false },
      cast: castFromDraft(draft.cast, found),
    };
    return Response.json(body);
  } catch (error) {
    console.error(error);
    return fail(error instanceof ModelStop ? error.message : claudeErrorText(error), error instanceof ModelStop ? 422 : 502);
  }
}
