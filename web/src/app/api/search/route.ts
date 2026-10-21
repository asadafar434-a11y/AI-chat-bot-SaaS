import { requireAiAuth } from "@/lib/ai-guard";
import { handleWebSearch } from "@/server/web-search/handler";
import { createSearcher } from "@/server/web-search/search";

export const maxDuration = 30;

// Один поисковик на процесс: у него общая память на час и общий счёт запросов в минуту.
const search = createSearcher();

export async function POST(request: Request) {
  return handleWebSearch(request, { authorize: requireAiAuth, search });
}
