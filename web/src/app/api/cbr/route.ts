import { requireAiAuth } from "@/lib/ai-guard";
import { handleCbr } from "@/server/cbr/handler";
import { createCbrLoader } from "@/server/cbr/cbr";

export const maxDuration = 30;

// Один загрузчик на процесс: у него общая память на час.
const load = createCbrLoader();

export async function POST(request: Request) {
  return handleCbr(request, { authorize: requireAiAuth, load });
}
