/**
 * Первый владелец: организация, пользователь без пароля и одноразовая ссылка, по которой человек сам задаёт пароль.
 *
 * Зачем: аккаунты создаются только приглашением (D13), а для самого первого приглашать некому. Пароль нигде не передаётся и не
 * печатается — владелец задаёт его сам на экране по ссылке. Повторный запуск для той же почты не плодит организации: выдаёт новую
 * ссылку (приглашение — если пароль ещё не задан, сброс пароля — если уже задан).
 */

import { auditEvent } from "../audit/service.ts";
import type { DbClient } from "../db/db-client.ts";
import { orgScope } from "../db/org-scope.ts";
import { normalizeEmail } from "./email.ts";
import { AuthError } from "./errors.ts";
import { createInvitation } from "./invitation.ts";
import { createPasswordResetToken } from "./password-reset.ts";
import type { TransactionRunner } from "./transaction.ts";

export const ORGANIZATION_NAME_MAX = 200;

export type OwnerLink = {
  /** invite — задать пароль впервые; reset — пароль уже есть, ссылка меняет его. */
  kind: "invite" | "reset";
  token: string;
  expiresAt: Date;
};

export type CreatedOwner = {
  userId: string;
  organizationId: string;
  email: string;
  organizationCreated: boolean;
  userCreated: boolean;
  link: OwnerLink;
};

function organizationNameOf(value: unknown): string {
  const name = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (name.length === 0 || name.length > ORGANIZATION_NAME_MAX) {
    throw new AuthError("invalid_argument", `название организации — от 1 до ${ORGANIZATION_NAME_MAX} знаков`);
  }
  return name;
}

export async function createOwner(
  run: TransactionRunner,
  input: { email: unknown; organizationName: unknown; now?: Date },
): Promise<CreatedOwner> {
  const email = normalizeEmail(input.email);
  const name = organizationNameOf(input.organizationName);
  const now = input.now ?? new Date();

  return run(async (db: DbClient) => {
    const existing = (await db.user.findFirst({ where: { email } })) as { id: string; passwordHash: string | null; deletedAt: Date | null } | null;
    if (existing?.deletedAt) {
      throw new AuthError("conflict", "аккаунт с такой почтой удалён");
    }

    let userId: string;
    let userCreated = false;
    if (existing) {
      userId = existing.id;
    } else {
      userId = ((await db.user.create({ data: { email } })) as { id: string }).id;
      userCreated = true;
    }

    // Организация, где этот человек уже владелец, переиспользуется: повторный запуск не множит организации.
    const owned = (await db.membership.findMany({ where: { userId, role: "owner" } })) as { organizationId: string }[];
    let organizationId = owned[0]?.organizationId;
    let organizationCreated = false;
    if (!organizationId) {
      organizationId = ((await db.organization.create({ data: { name } })) as { id: string }).id;
      organizationCreated = true;
      const membership = (await db.membership.create({ data: { organizationId, userId, role: "owner" } })) as { id: string };
      await auditEvent(db, orgScope(organizationId), {
        actorUserId: userId,
        action: "member.joined",
        entityType: "member",
        entityId: membership.id,
        metadata: { role: "owner", bootstrap: true },
      });
    }

    if (existing?.passwordHash) {
      const reset = await createPasswordResetToken(db, email, { now });
      if (!reset) throw new AuthError("conflict", "не удалось выдать ссылку для смены пароля");
      return { userId, organizationId, email, organizationCreated, userCreated, link: { kind: "reset", token: reset.token, expiresAt: reset.expiresAt } };
    }

    const invitation = await createInvitation(db, orgScope(organizationId), { email, role: "owner", invitedByUserId: userId, now });
    return { userId, organizationId, email, organizationCreated, userCreated, link: { kind: "invite", token: invitation.token, expiresAt: invitation.expiresAt } };
  });
}
