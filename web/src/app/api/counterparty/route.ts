import { requireAiAuth } from "@/lib/ai-guard";
import { handleCounterparty } from "@/server/counterparty/handler";
import { createCounterpartyLoader } from "@/server/counterparty/counterparty";

export const maxDuration = 45;

// Один загрузчик на процесс: у него общая память на шесть часов и общий счёт запросов к реестрам в минуту.
const load = createCounterpartyLoader();

export async function POST(request: Request) {
  return handleCounterparty(request, { authorize: requireAiAuth, load });
}
