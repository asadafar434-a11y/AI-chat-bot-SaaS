import { claudeErrorText, MY_DOCS_NO_KEY_TEXT } from "@/lib/claude-errors";
import { askJson, ModelStop } from "@/lib/claude-request";
import { clipForSort, SORT_BATCH, SORT_INSTRUCTIONS, SORT_SYSTEM, SortSchema, type SortedDoc } from "@/lib/my-docs";
import { badRequest, readJson } from "@/lib/read-json";

export const maxDuration = 300;

const fail = (message: string, status: number) => new Response(message, { status });

// Раскладка документов участника по видам. Нужно только начало и конец документа, поэтому это дёшево.
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body) return badRequest();
  const documents = (Array.isArray(body.documents) ? body.documents : []).slice(0, SORT_BATCH).map((doc, i) => ({
    name: `Документ ${i + 1}: ${String(doc?.name ?? "").slice(0, 300)}`,
    text: clipForSort(String(doc?.text ?? "")),
  }));
  if (documents.length === 0) return fail("Нет документов.", 400);
  if (!process.env.ANTHROPIC_API_KEY) return fail(MY_DOCS_NO_KEY_TEXT, 503);

  try {
    const result = await askJson({
      label: "my-docs sort",
      documents,
      instructions: SORT_INSTRUCTIONS,
      schema: SortSchema,
      system: SORT_SYSTEM,
      cache: false,
      effort: "low",
      signal: request.signal,
    });
    const byIndex = new Map(result.documents.map((doc) => [doc.index, doc]));
    const sorted: SortedDoc[] = documents.map((_, i) => {
      const found = byIndex.get(i + 1);
      return { kinds: found?.kinds.length ? [...new Set(found.kinds)] : ["other"], about: found?.about.trim() ?? "" };
    });
    return Response.json({ documents: sorted });
  } catch (error) {
    console.error(error);
    return fail(error instanceof ModelStop ? error.message : claudeErrorText(error), error instanceof ModelStop ? 422 : 502);
  }
}
