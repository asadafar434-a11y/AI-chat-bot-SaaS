import { appIdOf, requireAiAuth } from "@/lib/ai-guard";
import { claudeErrorText, NO_KEY_TEXT } from "@/lib/claude-errors";
import { askJson, ModelStop } from "@/lib/claude-request";
import { MAX_CONTEXT_CHARS } from "@/lib/chat-types";
import {
  HIDDEN_REQUIREMENTS_LIMIT_NOTE,
  HiddenRequirementsSchema,
  sortHiddenFindings,
  withPlaces,
  type HiddenRequirementsResponse,
} from "@/lib/hidden-requirements";
import { HIDDEN_REQUIREMENTS_INSTRUCTIONS } from "@/lib/hidden-requirements-prompt";
import { quoteChecker } from "@/lib/quotes";
import { badRequest, readJson, sentDocuments } from "@/lib/read-json";

export const maxDuration = 300;

const fail = (message: string, status: number) => new Response(message, { status });

// Платный запрос к ИИ по кнопке на шаге «Анализ»: скрытые требования, неоднозначности и условия допуска.
// Каждую цитату код ищет в документах: не нашёл — находка остаётся, но помечена «цитата не найдена».
export async function POST(request: Request) {
  const denied = await requireAiAuth(request);
  if (denied) return denied;
  const body = await readJson(request);
  if (!body) return badRequest();
  const documents = sentDocuments(body.documents);
  if (!process.env.ANTHROPIC_API_KEY) return fail(NO_KEY_TEXT, 503);
  if (documents.length === 0) return fail("В закупке нет документов — добавьте извещение, ТЗ и договор.", 400);
  const size = documents.reduce((sum, d) => sum + d.text.length, 0);
  if (size > MAX_CONTEXT_CHARS)
    return fail(
      `${HIDDEN_REQUIREMENTS_LIMIT_NOTE} Сейчас ${size.toLocaleString("ru-RU")} знаков при лимите ${MAX_CONTEXT_CHARS.toLocaleString("ru-RU")}.`,
      413,
    );

  try {
    const draft = await askJson({
      label: "hidden-requirements",
      appId: appIdOf(request),
      documents,
      instructions: HIDDEN_REQUIREMENTS_INSTRUCTIONS,
      schema: HiddenRequirementsSchema,
      signal: request.signal,
    });
    const found = quoteChecker(documents.map((d) => d.text));
    const checked: HiddenRequirementsResponse = {
      findings: draft.findings.map((f) => ({ ...f, verified: !f.quote || found(f.quote) })),
    };
    // Сначала критическое, затем высокое, среднее и низкое; внутри группы — порядок модели.
    return Response.json(withPlaces({ findings: sortHiddenFindings(checked.findings) }, documents));
  } catch (error) {
    console.error(error);
    return fail(error instanceof ModelStop ? error.message : claudeErrorText(error), error instanceof ModelStop ? 422 : 502);
  }
}
