/**
 * Общая преамбула file endpoints S6 (стиль S4/S5).
 *
 * Порядок: флаг `STORAGE_ENABLED=1` → 404; сессия → 401; организация только
 * из членств (single-org, ограничение этапов) → 403. Тело запроса tenant
 * scope не несёт. Адаптер хранилища выбирается фабрикой по окружению.
 */

import { AuthError } from "../auth/errors.ts";
import { requireSession } from "../auth/guards.ts";
import { getDb } from "../db/client.ts";
import type { OrgScope } from "../db/org-scope.ts";
import { orgScope } from "../db/org-scope.ts";
import { createStorageAdapter } from "./config.ts";
import type { FileContext } from "./files.ts";
import type { StorageAdapter } from "./types.ts";

export function storageEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STORAGE_ENABLED === "1";
}

export type FileScope = {
  ctx: FileContext;
};

let shared: StorageAdapter | null = null;

/** Разделяемый адаптер процесса (как разделяемый Prisma-клиент). */
export function getStorage(): StorageAdapter {
  if (!shared) {
    shared = createStorageAdapter();
  }
  return shared;
}

/** Сбросить кэш адаптера (тесты со сменой конфигурации). */
export function resetStorageForTests(): void {
  shared = null;
}

/** Контекст файловых операций либо HTTP-отказ. */
export async function requireFileScope(storage?: StorageAdapter): Promise<FileScope | Response> {
  if (!storageEnabled()) {
    return new Response("Файловое хранилище выключено", { status: 404 });
  }
  let userId: string;
  try {
    userId = (await requireSession()).userId;
  } catch (error) {
    if (error instanceof AuthError) {
      return new Response(error.message, { status: error.status });
    }
    throw error;
  }
  const db = getDb();
  const memberships = (await db.membership.findMany({ where: { userId } })) as {
    organizationId: string;
  }[];
  if (memberships.length === 0) {
    return new Response("Нет доступной организации", { status: 403 });
  }
  if (memberships.length > 1) {
    return new Response("Несколько организаций: выбор на этапе S6 не поддерживается", { status: 403 });
  }
  const scope: OrgScope = orgScope(memberships[0].organizationId);
  return { ctx: { db, storage: storage ?? getStorage(), scope, userId } };
}

/** JSON-ответ файлового слоя: источник всегда указан явно. */
export function fileJson(data: unknown, status = 200): Response {
  return Response.json(
    { source: "storage", data },
    {
      status,
      headers: { "X-Data-Source": "storage", "Cache-Control": "private, no-store" },
    },
  );
}
