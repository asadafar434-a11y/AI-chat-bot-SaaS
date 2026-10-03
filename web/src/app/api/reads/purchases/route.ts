import { getDb } from "@/server/db/client";
import { listPurchases } from "@/server/read/services";
import { readJson, requireReadScope } from "@/server/read/route";

export const dynamic = "force-dynamic";

/** Серверный список закупок. За флагом `SERVER_READS=1`, скоуп — только из сессии. */
export async function GET(request: Request) {
  const access = await requireReadScope(request);
  if (access instanceof Response) {
    return access;
  }
  const data = await listPurchases({ db: getDb(), scope: access.scope, userId: access.userId, storage: access.storage });
  return readJson(data);
}
