import { getDb } from "@/server/db/client";
import { listFacts } from "@/server/read/services";
import { readJson, requireReadScope } from "@/server/read/route";

export const dynamic = "force-dynamic";

/** Серверные факты базы доказательств в доменной форме. */
export async function GET(request: Request) {
  const access = await requireReadScope(request);
  if (access instanceof Response) {
    return access;
  }
  const data = await listFacts({ db: getDb(), scope: access.scope, userId: access.userId, storage: access.storage });
  return readJson(data);
}
