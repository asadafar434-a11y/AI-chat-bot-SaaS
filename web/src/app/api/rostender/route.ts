import { requireAiAuth } from "@/lib/ai-guard";
import { getPrismaClient } from "@/server/db/client";
import { handleRostender } from "@/server/rostender/handler";
import { moscowToday } from "@/server/rostender/schedule";
import { createTenderStore, type TenderDb } from "@/server/rostender/store";

// Список закупок из базы (обновляется сервером раз в сутки, schedule.ts). Без DATABASE_URL базы нет — список пуст.
export async function POST(request: Request) {
  const configured = Boolean(process.env.ROSTENDER_API_KEY?.trim());
  const store = process.env.DATABASE_URL ? createTenderStore(getPrismaClient() as unknown as TenderDb) : null;
  return handleRostender(request, { authorize: requireAiAuth, store, configured, today: moscowToday });
}
