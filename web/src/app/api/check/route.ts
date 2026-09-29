import { appIdOf } from "@/lib/ai-guard";
import type Anthropic from "@anthropic-ai/sdk";
import { claudeErrorText, NO_KEY_TEXT } from "@/lib/claude-errors";
import { askJson, ModelStop } from "@/lib/claude-request";
import { MAX_CONTEXT_CHARS } from "@/lib/chat-types";
import { APPLICATION_LIMIT, CheckSchema, type CheckResponse } from "@/lib/check";
import { CHECK_INSTRUCTIONS } from "@/lib/check-prompt";
import { quoteFound } from "@/lib/quotes";
import type { SentDocument } from "@/lib/read-documents";
import { badRequest, readJson, sentDocuments } from "@/lib/read-json";

export const maxDuration = 300;

const fail = (message: string, status: number) => new Response(message, { status });

const chars = (docs: SentDocument[]) => docs.reduce((sum, d) => sum + d.text.length, 0);

// Заявка идёт после документов закупки: документы читаются из общего кеша, как у требований и ТП.
const applicationBlocks = (application: SentDocument[]): Anthropic.Beta.BetaRequestDocumentBlock[] =>
  application.map((doc) => ({
    type: "document",
    source: { type: "text", media_type: "text/plain", data: doc.text },
    title: `Заявка участника: ${doc.name}`,
  }));

export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body) return badRequest();
  const documents = sentDocuments(body.documents);
  const application = sentDocuments(body.application);
  if (!process.env.ANTHROPIC_API_KEY) return fail(NO_KEY_TEXT, 503);

  if (documents.length === 0) return fail("В закупке нет документов — добавьте извещение и ТЗ.", 400);
  if (application.length === 0) return fail("Загрузите заявку, которую собираетесь подавать.", 400);
  if (chars(documents) > MAX_CONTEXT_CHARS) {
    return fail(
      `Документы закупки слишком большие: ${chars(documents).toLocaleString("ru-RU")} символов при лимите ${MAX_CONTEXT_CHARS.toLocaleString("ru-RU")}. Уберите из закупки лишние файлы.`,
      413
    );
  }
  if (chars(application) > APPLICATION_LIMIT) {
    return fail(
      `Заявка слишком большая: ${chars(application).toLocaleString("ru-RU")} символов. Загрузите только техническое предложение и анкету, без копий документов компании.`,
      413
    );
  }

  try {
    const draft = await askJson({
      label: "check",
      appId: appIdOf(request),
      documents,
      extra: applicationBlocks(application),
      instructions: CHECK_INSTRUCTIONS,
      schema: CheckSchema,
      signal: request.signal,
    });

    // Цитата требования ищется в документах закупки, цитата ошибки — в самой заявке.
    const texts = documents.map((d) => d.text);
    const appTexts = application.map((d) => d.text);
    const findings = draft.findings.map((f) => ({
      ...f,
      verified: !f.quote || quoteFound(f.quote, texts),
      appVerified: !f.inApplication || quoteFound(f.inApplication, appTexts),
    }));
    const body: CheckResponse = {
      findings: [...findings.filter((f) => f.kind === "bad"), ...findings.filter((f) => f.kind === "warn")],
      okCount: Math.max(0, draft.okCount),
    };
    return Response.json(body);
  } catch (error) {
    console.error(error);
    return fail(error instanceof ModelStop ? error.message : claudeErrorText(error), error instanceof ModelStop ? 422 : 502);
  }
}
