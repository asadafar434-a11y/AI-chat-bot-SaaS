/**
 * Общая преамбула server-write эндпоинтов S5 (стиль S4 `read/route.ts`).
 *
 * Порядок проверок:
 * 1. флаг `SERVER_WRITES=1` — иначе 404: записи тёмные в production до подписи;
 * 2. серверная сессия — иначе 401;
 * 3. организация — только из членств пользователя (S11-R0: явный выбор
 *    заголовком `x-organization-id`, проверяемый против `Membership`);
 *    ноль членств или несколько без выбора — явный 403.
 *
 * Тело запроса tenant scope не несёт: `organizationId`/`userId` из тела
 * отклоняются сервисами, а не игнорируются.
 */

import { AuthError } from "../auth/errors.ts";
import { requireSession } from "../auth/guards.ts";
import { getDb, getTransactionRunner } from "../db/client.ts";
import { DuplicateLegacyIdError } from "../read/services.ts";
import { requestedOrganizationId, selectMembership } from "../read/route.ts";
import { AlreadyExistsError } from "./services.ts";
import type { OrgScope } from "../db/org-scope.ts";
import { orgScope } from "../db/org-scope.ts";
import { optionalStorageAdapter } from "../storage/config.ts";
import type { WriteContext } from "./services.ts";

export function serverWritesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SERVER_WRITES === "1";
}

export type WriteScope = {
  ctx: WriteContext;
};

/** Контекст записи либо HTTP-отказ. */
export async function requireWriteScope(request: Request): Promise<WriteScope | Response> {
  if (!serverWritesEnabled()) {
    return new Response("Серверная запись выключена", { status: 404 });
  }
  let userId: string;
  try {
    userId = (await requireSession()).userId;
  } catch (error) {
    if (error instanceof AuthError) {
      return new Response("Требуется вход", { status: error.status });
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
  const selected = selectMembership(memberships, requestedOrganizationId(request));
  if (!selected) {
    return new Response(
      memberships.length > 1 ? "Нужно выбрать организацию" : "Организация недоступна",
      { status: 403 },
    );
  }
  const scope: OrgScope = orgScope(selected.organizationId);
  return { ctx: { db, run: getTransactionRunner(), scope, userId, storage: optionalStorageAdapter() } };
}

/** JSON-ответ серверной записи: источник всегда указан явно. */
export function writeJson(data: unknown, status = 200): Response {
  return Response.json({ source: "postgres", data }, { status, headers: { "X-Data-Source": "postgres" } });
}

/**
 * Ожидаемые ошибки записи — в статусы без PII (сообщения содержат только
 * операцию, причину и идентификаторы). Неожиданное пробрасывается (500).
 */
export function writeError(error: unknown): Response {
  if (error instanceof AuthError) {
    const msg =
      error.code === "unauthenticated" || error.code === "invalid_credentials"
        ? "Требуется вход"
        : error.code === "forbidden"
          ? "Нет доступа"
          : "Некорректный запрос";
    return new Response(msg, { status: error.status });
  }
  if (error instanceof Error && error.name === "NotFoundInScopeError") {
    return new Response("Не найдено", { status: 404 });
  }
  if (error instanceof DuplicateLegacyIdError || error instanceof AlreadyExistsError) {
    return new Response("Конфликт данных", { status: 409 });
  }
  if (error instanceof Error && error.name === "InvalidArgumentError") {
    return new Response("Некорректный запрос", { status: 400 });
  }
  throw error;
}
