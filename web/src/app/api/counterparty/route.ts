import { requireAiAuth } from "@/lib/ai-guard";
import { handleCounterparty } from "@/server/counterparty/handler";
import { createCounterpartyLoader } from "@/server/counterparty/counterparty";

export const maxDuration = 45;

// Один загрузчик на процесс: у него общая память на шесть часов и общий счёт проверок в минуту.
// С ключом CHECKO_API_KEY карточка, отчётность, суды, приставы и РНП приходят из Checko API (см. server/counterparty/checko.ts).
const load = createCounterpartyLoader({ checkoApiKey: process.env.CHECKO_API_KEY });

export async function POST(request: Request) {
  return handleCounterparty(request, { authorize: requireAiAuth, load });
}
