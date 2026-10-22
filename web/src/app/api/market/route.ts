import { requireAiAuth } from "@/lib/ai-guard";
import { createDbMarketStore, type MarketDb } from "@/lib/market-store-db";
import { getPrismaClient } from "@/server/db/client";
import { handleMarket } from "@/server/market/handler";

export const maxDuration = 30;

export async function POST(request: Request) {
  return handleMarket(request, {
    authorize: requireAiAuth,
    hasDatabase: () => Boolean(process.env.DATABASE_URL),
    getStore: () => createDbMarketStore(getPrismaClient() as unknown as MarketDb),
  });
}
