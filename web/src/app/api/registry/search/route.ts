import { requireAiAuth } from "@/lib/ai-guard";
import { createDbRegistryStore, type RegistryDb } from "@/lib/registry-store-db";
import { getPrismaClient } from "@/server/db/client";
import { handleRegistrySearch } from "@/server/registry/search-handler";

export const maxDuration = 60;

export async function POST(request: Request) {
  return handleRegistrySearch(request, {
    authorize: requireAiAuth,
    hasDatabase: () => Boolean(process.env.DATABASE_URL),
    getStore: () => createDbRegistryStore(getPrismaClient() as unknown as RegistryDb),
  });
}
