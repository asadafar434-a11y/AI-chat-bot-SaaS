/**
 * Общая преамбула server-read эндпоинтов S4 (S11-R0: выбор организации + S6).
 *
 * Порядок проверок (каждая — до следующей):
 * 1. флаг `SERVER_READS=1` — иначе 404: эндпоинты тёмные в production до подписи;
 * 2. серверная сессия — иначе 401;
 * 3. организация — только из членств пользователя, никогда из запроса как из
 *    доверенного значения. Явный выбор — заголовок `x-organization-id`:
 *    он проверяется против `Membership`; при одном членстве он необязателен.
 *    Ноль членств или несколько без явного выбора — 403.
 *
 * `organizationId` из query/body здесь не читается: заголовок — запрос выбора,
 * а не источник истины; право на организацию подтверждает `Membership`.
 */

import { AuthError } from "../auth/errors.ts";
import { requireSession } from "../auth/guards.ts";
import { getDb } from "../db/client.ts";
import type { OrgScope } from "../db/org-scope.ts";
import { orgScope } from "../db/org-scope.ts";
import { optionalStorageAdapter } from "../storage/config.ts";
import type { StorageAdapter } from "../storage/types.ts";

export function serverReadsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SERVER_READS === "1";
}

export type ReadScope = {
  scope: OrgScope;
  userId: string;
  storage?: StorageAdapter;
};

/** Запрошенная организация: заголовок `x-organization-id` (без query/body). */
export function requestedOrganizationId(request: Request): string | null {
  const raw = request.headers.get("x-organization-id");
  const value = raw?.trim() ?? "";
  return value.length > 0 && value.length <= 64 ? value : null;
}

/**
 * Выбор организации из подтверждённых членств. Чужой/неизвестный `organizationId`
 * не даёт доступа: возвращается `null`, вызывающий отвечает 403.
 */
export function selectMembership(
  memberships: readonly { organizationId: string }[],
  requested: string | null,
): { organizationId: string } | null {
  if (requested !== null) {
    return memberships.find((m) => m.organizationId === requested) ?? null;
  }
  return memberships.length === 1 ? memberships[0] : null;
}

async function resolveAccess(): Promise<
  { ok: true; memberships: { organizationId: string }[]; userId: string } | { ok: false; response: Response }
> {
  let userId: string;
  try {
    userId = (await requireSession()).userId;
  } catch (error) {
    if (error instanceof AuthError) {
      return { ok: false, response: new Response(error.message, { status: error.status }) };
    }
    throw error;
  }
  const memberships = (await getDb().membership.findMany({ where: { userId } })) as { organizationId: string }[];
  return { ok: true, memberships, userId };
}

/** Скоуп чтения либо HTTP-отказ. Успех означает: флаг включён, сессия есть, организация выбрана и подтверждена. */
export async function requireReadScope(request: Request): Promise<ReadScope | Response> {
  if (!serverReadsEnabled()) {
    return new Response("Серверное чтение выключено", { status: 404 });
  }
  const access = await resolveAccess();
  if (!access.ok) {
    return access.response;
  }
  if (access.memberships.length === 0) {
    return new Response("Нет доступной организации", { status: 403 });
  }
  const selected = selectMembership(access.memberships, requestedOrganizationId(request));
  if (!selected) {
    return new Response(
      access.memberships.length > 1 ? "Нужно выбрать организацию" : "Организация недоступна",
      { status: 403 },
    );
  }
  return { scope: orgScope(selected.organizationId), userId: access.userId, storage: optionalStorageAdapter() };
}

/** JSON-ответ серверного чтения: источник всегда указан явно. */
export function readJson(data: unknown, status = 200): Response {
  return Response.json({ source: "postgres", data }, { status, headers: { "X-Data-Source": "postgres" } });
}
