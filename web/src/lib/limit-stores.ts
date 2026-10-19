// Откуда берутся хранилища общего счёта лимитов и бюджета ИИ (shared-limits.ts): из базы, если сервер включил SHARED_LIMITS=db, иначе — ниоткуда
// (счёт в памяти, как раньше). Клиент базы и код хранилища подгружаются только при включённой настройке: без неё база не нужна и не трогается.
import { sharedLimitsOn, type HitStore, type SpendStore } from "./shared-limits.ts";

type Raw = import("../server/db/shared-limits-store.ts").RawClient;

async function client(): Promise<Raw> {
  const { getPrismaClient } = await import("../server/db/client.ts");
  return getPrismaClient() as unknown as Raw;
}

let hit: Promise<HitStore | null> | null = null;
let spend: Promise<SpendStore | null> | null = null;

// Не вышло подключиться — следующий запрос попробует снова (база могла подняться), а этот посчитается в памяти.
export function hitStoreSource(): Promise<HitStore | null> {
  if (!sharedLimitsOn()) return Promise.resolve(null);
  return (hit ??= (async () => (await import("../server/db/shared-limits-store.ts")).prismaHitStore(await client()))().catch((e) => {
    hit = null;
    throw e;
  }));
}

export function spendStoreSource(): Promise<SpendStore | null> {
  if (!sharedLimitsOn()) return Promise.resolve(null);
  return (spend ??= (async () => (await import("../server/db/shared-limits-store.ts")).prismaSpendStore(await client()))().catch((e) => {
    spend = null;
    throw e;
  }));
}
