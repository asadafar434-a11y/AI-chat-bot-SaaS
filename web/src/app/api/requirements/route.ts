import { claudeErrorText, NO_KEY_TEXT } from "@/lib/claude-errors";
import { askJson, ModelStop } from "@/lib/claude-request";
import { MAX_CONTEXT_CHARS } from "@/lib/chat-types";
import { quoteFound } from "@/lib/quotes";
import { RequirementsSchema, type ReqItem, type RequirementsResponse } from "@/lib/requirements";
import { REQ_INSTRUCTIONS } from "@/lib/requirements-prompt";
import { badRequest, readJson, sentDocuments } from "@/lib/read-json";

export const maxDuration = 300;

const fail = (message: string, status: number) => new Response(message, { status });

export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body) return badRequest();
  const documents = sentDocuments(body.documents);
  if (!process.env.ANTHROPIC_API_KEY) return fail(NO_KEY_TEXT, 503);

  if (documents.length === 0) return fail("Загрузите документы закупки.", 400);
  const total = documents.reduce((sum, d) => sum + d.text.length, 0);
  if (total > MAX_CONTEXT_CHARS) {
    return fail(
      `Документы слишком большие: ${total.toLocaleString("ru-RU")} символов при лимите ${MAX_CONTEXT_CHARS.toLocaleString("ru-RU")}. Уберите лишние файлы — например, обоснование цены.`,
      413
    );
  }

  try {
    const draft = await askJson({
      label: "requirements",
      documents,
      instructions: REQ_INSTRUCTIONS,
      schema: RequirementsSchema,
      signal: request.signal,
    });

    const texts = documents.map((d) => d.text);
    const check = (items: Omit<ReqItem, "verified">[]) =>
      items.map((item) => ({ ...item, verified: quoteFound(item.quote, texts) }));
    const { who, submit, scope, terms, ...summary } = draft;
    const body: RequirementsResponse = {
      ...summary,
      groups: { who: check(who), submit: check(submit), scope: check(scope), terms: check(terms) },
    };
    return Response.json(body);
  } catch (error) {
    console.error(error);
    return fail(error instanceof ModelStop ? error.message : claudeErrorText(error), error instanceof ModelStop ? 422 : 502);
  }
}
