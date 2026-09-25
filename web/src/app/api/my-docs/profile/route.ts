import { claudeErrorText, NO_KEY_TEXT } from "@/lib/claude-errors";
import { askJson, ModelStop } from "@/lib/claude-request";
import { PROFILE_INSTRUCTIONS, ProfileFoundSchema, SORT_SYSTEM, type FoundField, type ProfileFound } from "@/lib/my-docs";
import type { ProfileKey } from "@/lib/profile";
import { quoteFound } from "@/lib/quotes";

export const maxDuration = 300;

// Реквизиты помещаются в первых страницах: анкета, карточка и письмо короткие.
const DOC_LIMIT = 30_000;
const TOTAL_LIMIT = 200_000;

type ProfileRequest = { documents?: { name?: unknown; text?: unknown }[] };

const fail = (message: string, status: number) => new Response(message, { status });

const NUMERIC: ProfileKey[] = ["inn", "kpp", "ogrn", "account", "bik", "corrAccount"];
const digits = (s: string) => s.replace(/\D/g, "");

// Реквизиты участника из его документов. Каждое значение сверяем с текстом: номера — по цифрам,
// остальное — по цитате. Чего в документах нет, в реквизиты не попадает.
export async function POST(request: Request) {
  const body: ProfileRequest = await request.json();
  const documents: { name: string; text: string }[] = [];
  let total = 0;
  for (const doc of Array.isArray(body.documents) ? body.documents : []) {
    const text = String(doc?.text ?? "").slice(0, DOC_LIMIT);
    if (!text.trim() || total + text.length > TOTAL_LIMIT) continue;
    documents.push({ name: String(doc?.name ?? "").slice(0, 300), text });
    total += text.length;
  }
  if (documents.length === 0) return fail("Нет документов с реквизитами.", 400);
  if (!process.env.ANTHROPIC_API_KEY) return fail(NO_KEY_TEXT, 503);

  try {
    const found = await askJson({
      label: "my-docs profile",
      documents,
      instructions: PROFILE_INSTRUCTIONS,
      schema: ProfileFoundSchema,
      system: SORT_SYSTEM,
      cache: false,
      signal: request.signal,
    });

    const texts = documents.map((d) => d.text);
    const compact = texts.map((t) => t.replace(/[\s ]/g, ""));
    const inDocuments = (key: ProfileKey, value: string, quote = "") =>
      NUMERIC.includes(key)
        ? digits(value).length >= 9 && compact.some((t) => t.includes(digits(value)))
        : quoteFound(quote, texts) || quoteFound(value, texts);
    const clean = (f: FoundField): FoundField => ({ key: f.key, value: f.value.trim(), source: f.source.trim() });

    const result: ProfileFound = {
      fields: found.fields.filter((f) => f.value.trim() && inDocuments(f.key, f.value, f.quote)).map(clean),
      conflicts: found.conflicts.filter((f) => f.value.trim() && inDocuments(f.key, f.value)).map(clean),
    };
    return Response.json(result);
  } catch (error) {
    console.error(error);
    return fail(error instanceof ModelStop ? error.message : claudeErrorText(error), error instanceof ModelStop ? 422 : 502);
  }
}
