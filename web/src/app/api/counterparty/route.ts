import { requireAiAuth } from "@/lib/ai-guard";
import { handleCounterparty } from "@/server/counterparty/handler";
import { createCounterpartyFinder, createCounterpartyLoader } from "@/server/counterparty/counterparty";

export const maxDuration = 45;

// Один загрузчик на процесс: у него общая память на шесть часов и общий счёт проверок в минуту.
// С ключом CHECKO_API_KEY карточка, отчётность, суды, приставы и РНП приходят из Checko API (см. server/counterparty/checko.ts);
// поиск по названию, ФИО и ОГРН — тоже только через него.
const options = { checkoApiKey: process.env.CHECKO_API_KEY };
const load = createCounterpartyLoader(options);
const find = createCounterpartyFinder(options);

export async function POST(request: Request) {
  return handleCounterparty(request, { authorize: requireAiAuth, load, find });
}
