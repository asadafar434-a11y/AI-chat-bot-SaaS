import { listCoreRuns } from "@/server/core/runs";
import { getDb } from "@/server/db/client";
import { readJson, requireReadScope } from "@/server/read/route";

export const dynamic = "force-dynamic";

/** Последние запуски медицинского core-модуля в организации из сессии. */
export async function GET(request: Request) {
  const access = await requireReadScope(request);
  if (access instanceof Response) {
    return access;
  }
  const runs = await listCoreRuns({
    db: getDb(),
    scope: access.scope,
    userId: access.userId,
  });
  return readJson(runs);
}
