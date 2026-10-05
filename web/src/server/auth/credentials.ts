/**
 * Проверка пары email + пароль.
 *
 * Отвечает за две вещи, которые легко сделать неправильно:
 *  1. не различать «нет пользователя» и «неверный пароль» — ни текстом, ни временем
 *     ответа (за это отвечает `verifyPassword`, которая всегда считает scrypt);
 *  2. мягко удалённый пользователь не входит, даже если пароль верен.
 *
 * `passwordHash` не покидает эту функцию: наружу возвращается только идентификатор.
 */

import type { DbClient } from "../db/db-client.ts";
import { tryNormalizeEmail } from "./email.ts";
import { verifyPassword } from "./password.ts";

export type CredentialInput = { email?: unknown; password?: unknown };
export type AuthenticatedUser = { userId: string; email: string };

export async function authenticateWithPassword(
  db: DbClient,
  input: CredentialInput,
): Promise<AuthenticatedUser | null> {
  const email = tryNormalizeEmail(input.email);
  const password = typeof input.password === "string" ? input.password : "";
  const user = email
    ? ((await db.user.findFirst({
        where: { email, deletedAt: null },
      })) as { id: string; email: string; passwordHash: string | null } | null)
    : null;

  const ok = await verifyPassword(password, user?.passwordHash ?? null);
  if (!user || !ok) {
    return null;
  }
  return { userId: user.id, email: user.email };
}
