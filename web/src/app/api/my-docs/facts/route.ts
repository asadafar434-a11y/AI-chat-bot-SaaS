import { claudeErrorText, MY_DOCS_NO_KEY_TEXT } from "@/lib/claude-errors";
import { askJson, ModelStop } from "@/lib/claude-request";
import { FACTS_DOC_LIMIT, FACTS_INSTRUCTIONS, FACTS_TOTAL_LIMIT, FactsFoundSchema, verifyFacts, type SentDoc } from "@/lib/evidence-extract";
import { SORT_SYSTEM } from "@/lib/my-docs";
import { badRequest, readJson } from "@/lib/read-json";

export const maxDuration = 300;

const fail = (message: string, status: number) => new Response(message, { status });

// Факты о компании из её документов — лицензии, сертификаты, договоры, сотрудники, оборудование, финансы. Модель ищет, сервер
// проверяет каждый факт по тексту документа (evidence-extract.ts): цитата, номера, даты, сроки и числа должны в нём стоять,
// остальное из ответа убирается. Сервер ничего не хранит: факты возвращаются браузеру, он кладёт их в базу и просит человека подтвердить.
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body) return badRequest();
  const documents: SentDoc[] = [];
  let total = 0;
  for (const doc of Array.isArray(body.documents) ? body.documents : []) {
    const text = String(doc?.text ?? "").slice(0, FACTS_DOC_LIMIT);
    if (!text.trim() || total + text.length > FACTS_TOTAL_LIMIT) continue;
    documents.push({ id: String(doc?.id ?? "").slice(0, 100), name: String(doc?.name ?? "").slice(0, 300), text });
    total += text.length;
  }
  if (documents.length === 0) return fail("Нет документов, в которых искать факты.", 400);
  if (!process.env.ANTHROPIC_API_KEY) return fail(MY_DOCS_NO_KEY_TEXT, 503);

  try {
    const found = await askJson({
      label: "my-docs facts",
      documents: documents.map(({ name, text }) => ({ name, text })),
      instructions: FACTS_INSTRUCTIONS,
      schema: FactsFoundSchema,
      system: SORT_SYSTEM,
      cache: false,
      signal: request.signal,
    });
    return Response.json(verifyFacts(found.facts, documents));
  } catch (error) {
    console.error(error);
    return fail(error instanceof ModelStop ? error.message : claudeErrorText(error), error instanceof ModelStop ? 422 : 502);
  }
}
