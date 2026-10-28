import { appIdOf, requireAiAuth } from "@/lib/ai-guard";
import { claudeErrorText, NO_KEY_TEXT } from "@/lib/claude-errors";
import { ModelStop } from "@/lib/claude-request";
import { fillCalculatorValues } from "@/lib/calculator-ai-fill";
import { findCalculator } from "@/lib/core/calculators/registry";
import { badRequest, readJson, sentDocuments } from "@/lib/read-json";

export const maxDuration = 60;

const fail = (message: string, status: number) => new Response(message, { status });

export async function POST(request: Request) {
  const denied = await requireAiAuth(request);
  if (denied) return denied;

  const body = await readJson(request);
  if (!body) return badRequest();

  const sphereKey = typeof body.sphereKey === "string" ? body.sphereKey : "";
  const subSphereKey = typeof body.subSphereKey === "string" ? body.subSphereKey : "";
  const currentValues =
    body.currentValues && typeof body.currentValues === "object" && !Array.isArray(body.currentValues) ? (body.currentValues as Record<string, unknown>) : {};
  const documents = sentDocuments(body.documents);

  const descriptor = findCalculator(sphereKey, subSphereKey);
  if (!descriptor) return fail("Калькулятор не найден", 404);

  if (!process.env.ANTHROPIC_API_KEY) return fail(NO_KEY_TEXT, 503);

  try {
    const result = await fillCalculatorValues(descriptor.title, descriptor.inputSchema, currentValues, documents, appIdOf(request));
    return Response.json(result);
  } catch (error) {
    if (error instanceof ModelStop) return fail(error.message, 402);
    return fail(claudeErrorText(error), 502);
  }
}
