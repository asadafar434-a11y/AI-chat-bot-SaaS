import { wipeTenantData } from "@/server/write/wipe";
import { requireWriteScope, writeError, writeJson } from "@/server/write/route";

export const dynamic = "force-dynamic";

/**
 * P1: удаление данных пользователя/организации на сервере.
 *
 * Организация и роль — только из серверной сессии и членства (`requireWriteScope`):
 * owner удаляет данные организации, member — только свои персональные. Другой tenant
 * недоступен. Событие пишется в S7 audit.
 */
export async function POST(request: Request) {
  const access = await requireWriteScope(request);
  if (access instanceof Response) {
    return access;
  }
  try {
    const result = await wipeTenantData(access.ctx);
    return writeJson({ ok: true, ...result });
  } catch (error) {
    return writeError(error);
  }
}
