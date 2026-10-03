/**
 * Приглашения owner → member.
 *
 * В БД хранится только хеш токена; сам токен возвращается вызывающему ровно один раз —
 * его кладут в письмо. Принятие атомарно: сначала приглашение «выкупается» условным
 * обновлением `acceptedAt IS NULL`, и только победившая гонка создаёт пользователя,
 * членство и профиль. Проигравшая параллельная попытка получает отказ.
 */

import { auditEvent } from "../audit/service.ts";
import type { DbClient } from "../db/db-client.ts";
import type { OrgScope } from "../db/org-scope.ts";
import { orgRepositories } from "../db/repositories/index.ts";
import type { InvitationRow } from "../db/repositories/index.ts";
import { normalizeEmail } from "./email.ts";
import { AuthError } from "./errors.ts";
import { assertPasswordAllowed, hashPassword } from "./password.ts";
import type { Role } from "./authorization.ts";
import { isRole } from "./authorization.ts";
import { INVITATION_TTL_MS, generateToken, hashToken, isExpired } from "./tokens.ts";
import type { TransactionRunner } from "./transaction.ts";

export type InvitationWithToken = { invitation: InvitationRow; token: string; expiresAt: Date };

export type CreateInvitationInput = {
  email: unknown;
  role: Role;
  invitedByUserId: string;
  now?: Date;
  ttlMs?: number;
};

/** Создаёт приглашение в организации скоупа. Право owner проверяется вызывающим сервисом. */
export async function createInvitation(
  db: DbClient,
  scope: OrgScope,
  input: CreateInvitationInput,
): Promise<InvitationWithToken> {
  const email = normalizeEmail(input.email);
  if (!isRole(input.role)) {
    throw new AuthError("invalid_argument", "недопустимая роль приглашения");
  }
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlMs ?? INVITATION_TTL_MS));
  const token = generateToken();

  const invitation = (await orgRepositories(db, scope).invitation.create({
    tokenHash: hashToken(token),
    email,
    role: input.role,
    invitedByUserId: input.invitedByUserId,
    expiresAt,
  })) as InvitationRow;

  await auditEvent(db, scope, {
    actorUserId: input.invitedByUserId,
    action: "invitation.created",
    entityType: "invitation",
    entityId: invitation.id,
    metadata: { role: input.role },
  });

  return { invitation, token, expiresAt };
}

/** Отзывает непринятое приглашение. Повторный вызов даёт `NotFoundInScopeError`. */
export async function revokeInvitation(db: DbClient, scope: OrgScope, invitationId: string): Promise<number> {
  return orgRepositories(db, scope).invitation.remove(invitationId);
}

export type AcceptInvitationInput = { password: unknown; name?: string; now?: Date };
export type AcceptedInvitation = { userId: string; organizationId: string; role: Role };

/**
 * Принимает приглашение по одноразовому токену.
 *
 * Пароль хешируется до открытия транзакции, чтобы scrypt (CPU-bound) не держал её. Если
 * пользователь с таким email уже существует и пароль у него задан, пароль не
 * перезаписывается: приглашение лишь добавляет членство.
 */
export async function acceptInvitation(
  run: TransactionRunner,
  token: string,
  input: AcceptInvitationInput,
): Promise<AcceptedInvitation> {
  assertPasswordAllowed(input.password);
  const passwordHash = await hashPassword(input.password);
  const now = input.now ?? new Date();
  const tokenHash = hashToken(token);

  return run(async (db) => {
    const invitation = (await db.invitation.findFirst({ where: { tokenHash } })) as InvitationRow | null;
    if (!invitation) {
      throw new AuthError("invalid_invitation", "приглашение недействительно");
    }
    if (invitation.acceptedAt) {
      throw new AuthError("invalid_invitation", "приглашение уже принято");
    }
    if (isExpired(invitation.expiresAt, now)) {
      throw new AuthError("invalid_token", "срок действия приглашения истёк");
    }

    const claim = await db.invitation.updateMany({
      where: { id: invitation.id, acceptedAt: null },
      data: { acceptedAt: now },
    });
    if (claim.count === 0) {
      throw new AuthError("invalid_invitation", "приглашение уже принято");
    }

    const existing = (await db.user.findFirst({
      where: { email: invitation.email },
    })) as { id: string; name: string | null; passwordHash: string | null; deletedAt: Date | null } | null;

    if (existing?.deletedAt) {
      throw new AuthError("conflict", "аккаунт с таким email удалён");
    }

    let userId: string;
    if (existing) {
      userId = existing.id;
      if (!existing.passwordHash) {
        await db.user.updateMany({ where: { id: userId }, data: { passwordHash } });
      }
      if (input.name && !existing.name) {
        await db.user.updateMany({ where: { id: userId }, data: { name: input.name } });
      }
    } else {
      const created = (await db.user.create({
        data: { email: invitation.email, name: input.name ?? null, passwordHash },
      })) as { id: string };
      userId = created.id;
    }

    const membership = await db.membership.findFirst({
      where: { organizationId: invitation.organizationId, userId },
    });
    if (!membership) {
      await db.membership.create({
        data: { organizationId: invitation.organizationId, userId, role: invitation.role },
      });
    }

    const profile = await db.userProfile.findFirst({ where: { userId } });
    if (!profile) {
      await db.userProfile.create({ data: { userId, fields: {} } });
    }

    await auditEvent(db, { organizationId: invitation.organizationId }, {
      actorUserId: userId,
      action: "member.joined",
      entityType: "member",
      entityId: userId,
      metadata: { role: invitation.role },
    });

    return { userId, organizationId: invitation.organizationId, role: invitation.role };
  });
}
