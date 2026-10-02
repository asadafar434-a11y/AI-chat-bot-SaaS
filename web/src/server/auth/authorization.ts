/**
 * Авторизация на уровне организации.
 *
 * Идентичность приходит только из серверной сессии: `organizationId`, `userId` и `role`
 * из запроса здесь не используются как доказательство. Роль проверяется поверх членства,
 * а не вместо него: без строки `Membership` роль взять неоткуда.
 *
 * Инвариант «в организации всегда есть owner» обеспечивается тем, что понижение и
 * удаление владельца сначала считают владельцев и отклоняют операцию, если он последний.
 */

import type { DbClient } from "../db/db-client.ts";
import type { OrgScope } from "../db/org-scope.ts";
import { orgRepositories } from "../db/repositories/index.ts";
import type { Membership } from "../db/repositories/index.ts";
import { AuthError } from "./errors.ts";

export type Role = "owner" | "member";

export function isRole(value: unknown): value is Role {
  return value === "owner" || value === "member";
}

/** Членство пользователя в организации или `null`. */
export async function findMembership(
  db: DbClient,
  userId: string,
  organizationId: string,
): Promise<Membership | null> {
  const row = (await db.membership.findFirst({
    where: { organizationId, userId },
  })) as Membership | null;
  return row ?? null;
}

export async function requireMembership(
  db: DbClient,
  userId: string,
  organizationId: string,
): Promise<Membership> {
  const membership = await findMembership(db, userId, organizationId);
  if (!membership) {
    throw new AuthError("forbidden", "нет членства в организации");
  }
  return membership;
}

export function assertOwner(membership: Membership): void {
  if (membership.role !== "owner") {
    throw new AuthError("forbidden", "требуется роль owner");
  }
}

export async function countOwners(db: DbClient, organizationId: string): Promise<number> {
  return db.membership.count({ where: { organizationId, role: "owner" } });
}

/**
 * Проверяет, что участника можно понизить или удалить, не оставив организацию без
 * владельца. Вызывается до мутации; считает только строки этой организации.
 */
export async function assertNotLastOwner(
  db: DbClient,
  organizationId: string,
  targetUserId: string,
): Promise<void> {
  const target = await requireMembership(db, targetUserId, organizationId);
  if (target.role !== "owner") {
    return;
  }
  const owners = await countOwners(db, organizationId);
  if (owners <= 1) {
    throw new AuthError("conflict", "нельзя понизить или удалить последнего владельца организации");
  }
}

/** Смена роли участника. Инициатор обязан быть owner этой организации. */
export async function changeMemberRole(
  db: DbClient,
  scope: OrgScope,
  input: { actorUserId: string; targetUserId: string; role: Role },
): Promise<Membership> {
  const organizationId = scope.organizationId;
  const actor = await requireMembership(db, input.actorUserId, organizationId);
  assertOwner(actor);
  if (!isRole(input.role)) {
    throw new AuthError("invalid_argument", "недопустимая роль");
  }

  const target = await requireMembership(db, input.targetUserId, organizationId);
  if (target.role === input.role) {
    return target;
  }
  if (target.role === "owner" && input.role !== "owner") {
    await assertNotLastOwner(db, organizationId, input.targetUserId);
  }

  const repos = orgRepositories(db, scope);
  return repos.membership.update(target.id, { role: input.role });
}

/** Удаление участника из организации. Инициатор обязан быть owner. */
export async function removeMember(
  db: DbClient,
  scope: OrgScope,
  input: { actorUserId: string; targetUserId: string },
): Promise<number> {
  const organizationId = scope.organizationId;
  const actor = await requireMembership(db, input.actorUserId, organizationId);
  assertOwner(actor);

  const target = await requireMembership(db, input.targetUserId, organizationId);
  await assertNotLastOwner(db, organizationId, input.targetUserId);

  const repos = orgRepositories(db, scope);
  return repos.membership.remove(target.id);
}
