import { getDb } from "@/server/db/client";
import { readProfile } from "@/server/read/services";
import { readJson, requireReadScope } from "@/server/read/route";

export const dynamic = "force-dynamic";

/** Серверный профиль: корпоративная часть организации + персональная часть пользователя. */
export async function GET(request: Request) {
  const access = await requireReadScope(request);
  if (access instanceof Response) {
    return access;
  }
  const data = await readProfile({ db: getDb(), scope: access.scope, userId: access.userId, storage: access.storage });
  return readJson(data);
}
