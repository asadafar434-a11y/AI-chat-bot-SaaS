import { appIdOf, requireAiAuth } from "@/lib/ai-guard";
import { claudeErrorText, NO_KEY_TEXT } from "@/lib/claude-errors";
import { askJson, ModelStop } from "@/lib/claude-request";
import { MAX_CONTEXT_CHARS } from "@/lib/chat-types";
import { CONTRADICTIONS_LIMIT_NOTE, ContradictionsSchema, withPlaces, type ContradictionsResponse } from "@/lib/contradictions";
import { CONTRADICTIONS_INSTRUCTIONS } from "@/lib/contradictions-prompt";
import { quoteChecker } from "@/lib/quotes";
import { badRequest, readJson, sentDocuments } from "@/lib/read-json";

export const maxDuration = 300;

const fail = (message: string, status: number) => new Response(message, { status });

// Платный запрос к ИИ по кнопке на шаге «Анализ»: противоречия внутри документов заказчика. Каждую цитату код ищет в документах:
// не нашёл — находка остаётся, но помечена «цитата не найдена».
export async function POST(request: Request) {
  const denied = await requireAiAuth(request);
  if (denied) return denied;
  const body = await readJson(request);
  if (!body) return badRequest();
  const documents = sentDocuments(body.documents);
  if (!process.env.ANTHROPIC_API_KEY) return fail(NO_KEY_TEXT, 503);
  if (documents.length === 0) return fail("В закупке нет документов — добавьте извещение, ТЗ и договор.", 400);
  const size = documents.reduce((sum, d) => sum + d.text.length, 0);
  if (size > MAX_CONTEXT_CHARS) return fail(`${CONTRADICTIONS_LIMIT_NOTE} Сейчас ${size.toLocaleString("ru-RU")} знаков при лимите ${MAX_CONTEXT_CHARS.toLocaleString("ru-RU")}.`, 413);

  try {
    const draft = await askJson({
      label: "contradictions",
      appId: appIdOf(request),
      documents,
      instructions: CONTRADICTIONS_INSTRUCTIONS,
      schema: ContradictionsSchema,
      signal: request.signal,
    });
    const found = quoteChecker(documents.map((d) => d.text));
    const checked: ContradictionsResponse = {
      findings: draft.findings.map((f) => ({
        ...f,
        firstVerified: !f.firstQuote || found(f.firstQuote),
        secondVerified: !f.secondQuote || found(f.secondQuote),
      })),
    };
    // Прямые противоречия — раньше неясностей; внутри группы порядок модели.
    const ordered: ContradictionsResponse = {
      findings: [...checked.findings.filter((f) => f.kind === "conflict"), ...checked.findings.filter((f) => f.kind === "unclear")],
    };
    return Response.json(withPlaces(ordered, documents));
  } catch (error) {
    console.error(error);
    return fail(error instanceof ModelStop ? error.message : claudeErrorText(error), error instanceof ModelStop ? 422 : 502);
  }
}
