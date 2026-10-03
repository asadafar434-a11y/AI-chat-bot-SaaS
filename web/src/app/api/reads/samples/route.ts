import { getDb } from "@/server/db/client";
import { listSamples } from "@/server/read/services";
import { readJson, requireReadScope } from "@/server/read/route";

export const dynamic = "force-dynamic";

/** Серверные образцы: полная форма `MyDocument`, текст/карта — из S6. */
export async function GET(request: Request) {
  const access = await requireReadScope(request);
  if (access instanceof Response) {
    return access;
  }
  const data = await listSamples({ db: getDb(), scope: access.scope, userId: access.userId, storage: access.storage });
  return readJson(data);
}
