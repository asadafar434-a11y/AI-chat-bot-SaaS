/**
 * Точки входа для защищённых серверных путей: `requireSession`, `requireMembership`,
 * `requireRole`, `withOrgScope`.
 *
 * Проверки идут сверху вниз и не пропускают шагов: сначала аутентификация, затем
 * членство, затем роль. `organizationId` приходит из серверной сессии и членства, а не
 * из запроса, поэтому клиент не может выбрать чужой арендатор.
 *
 * Модуль импортирует Auth.js (`config.ts`) и Prisma, поэтому не используется в
 * модульных тестах: доменная логика лежит в Prisma-независимых модулях и проверяется
 * отдельно.
 */

import { getDb } from "../db/client.ts";
import type { DbClient } from "../db/db-client.ts";
import type { Membership } from "../db/repositories/index.ts";
import { assertOwner, requireMembership } from "./authorization.ts";
import type { Role } from "./authorization.ts";
import { auth } from "./config.ts";
import { unauthenticated } from "./errors.ts";
import type { AuthenticatedSession } from "./session.ts";

export type CurrentSession = AuthenticatedSession & { email: string | null };

export async function currentSession(): Promise<CurrentSession | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return null;
  }
  const shaped = session as unknown as { sessionId?: string; expires?: Date | string };
  return {
    sessionId: shaped.sessionId ?? "",
    userId,
    expires: shaped.expires ? new Date(shaped.expires) : new Date(0),
    email: session.user?.email ?? null,
  };
}

export async function requireSession(): Promise<CurrentSession> {
  const session = await currentSession();
  if (!session) {
    throw unauthenticated();
  }
  return session;
}

/** Сессия + членство в организации. Организация обязательна. */
export async function requireMembershipForOrganization(
  organizationId: string,
  db: DbClient = getDb(),
): Promise<CurrentSession & { membership: Membership }> {
  const session = await requireSession();
  const membership = await requireMembership(db, session.userId, organizationId);
  return { ...session, membership };
}

/** Сессия + членство + роль owner. */
export async function requireOwner(
  organizationId: string,
  db: DbClient = getDb(),
): Promise<CurrentSession & { membership: Membership }> {
  const context = await requireMembershipForOrganization(organizationId, db);
  assertOwner(context.membership);
  return context;
}

/** Проверка роли над уже полученным членством. `member` означает «любое членство». */
export function requireRole(membership: Membership, role: Role): void {
  if (role === "owner") {
    assertOwner(membership);
  }
}
