/**
 * Смена пароля вошедшим пользователем (раздел «Настройки»).
 *
 * Нужен текущий пароль: иначе чужой человек за оставленным открытым компьютером мог бы сменить пароль и закрыть владельцу вход.
 * Новый пароль проходит те же правила, что и при создании. После смены все остальные входы пользователя (другие компьютеры и браузеры)
 * завершаются, а текущий остаётся — человек не выкидывает сам себя. Ответ на неверный текущий пароль не уточняет ничего лишнего.
 */

import { auditEvent } from "../audit/service.ts";
import type { DbClient } from "../db/db-client.ts";
import { AuthError } from "./errors.ts";
import { assertPasswordAllowed, hashPassword, verifyPassword } from "./password.ts";
import type { TransactionRunner } from "./transaction.ts";

export async function changePassword(
  run: TransactionRunner,
  input: { userId: string; keepSessionId: string; current: unknown; next: unknown },
): Promise<void> {
  assertPasswordAllowed(input.next);
  const nextHash = await hashPassword(input.next);
  const current = typeof input.current === "string" ? input.current : "";

  await run(async (db: DbClient) => {
    const user = (await db.user.findFirst({ where: { id: input.userId, deletedAt: null } })) as { id: string; passwordHash: string | null } | null;
    // verifyPassword всегда считает хеш, даже когда пароля нет: ответ по времени не выдаёт состояние учётной записи.
    const ok = await verifyPassword(current, user?.passwordHash ?? null);
    if (!user || !ok) {
      throw new AuthError("invalid_argument", "Текущий пароль указан неверно.");
    }
    if (current === input.next) {
      throw new AuthError("invalid_argument", "Новый пароль совпадает с текущим — придумайте другой.");
    }

    await db.user.updateMany({ where: { id: user.id }, data: { passwordHash: nextHash } });
    if (input.keepSessionId) {
      await db.session.deleteMany({ where: { userId: user.id, id: { not: input.keepSessionId } } });
    } else {
      await db.session.deleteMany({ where: { userId: user.id } });
    }

    // Учётка общая для всех организаций пользователя: событие пишется в журнал каждой (как при сбросе пароля).
    const memberships = (await db.membership.findMany({ where: { userId: user.id } })) as { organizationId: string }[];
    for (const membership of memberships) {
      await auditEvent(db, { organizationId: membership.organizationId }, {
        actorUserId: user.id,
        action: "auth.password_reset",
        entityType: "user",
        entityId: user.id,
        metadata: { via: "settings" },
      });
    }
  });
}
