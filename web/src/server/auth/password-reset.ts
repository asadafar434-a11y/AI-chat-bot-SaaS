/**
 * Сброс пароля по одноразовой ссылке.
 *
 * Выдача токена не раскрывает существование аккаунта: для неизвестного email функция
 * возвращает `null`, а вызывающий обработчик всё равно отвечает одинаково (§5 контракта).
 * В БД лежит хеш токена. Использование одноразово и завершает все активные сессии
 * пользователя: смена пароля выкидывает старые устройства.
 */

import type { DbClient } from "../db/db-client.ts";
import { tryNormalizeEmail } from "./email.ts";
import { AuthError } from "./errors.ts";
import { assertPasswordAllowed, hashPassword } from "./password.ts";
import { PASSWORD_RESET_TTL_MS, generateToken, hashToken, isExpired } from "./tokens.ts";
import type { TransactionRunner } from "./transaction.ts";

export type PasswordResetToken = { token: string; expiresAt: Date };

export async function createPasswordResetToken(
  db: DbClient,
  email: unknown,
  options: { now?: Date; ttlMs?: number } = {},
): Promise<PasswordResetToken | null> {
  const normalized = tryNormalizeEmail(email);
  if (!normalized) {
    return null;
  }
  const user = await db.user.findFirst({ where: { email: normalized, deletedAt: null } });
  if (!user) {
    return null;
  }

  const now = options.now ?? new Date();
  const expiresAt = new Date(now.getTime() + (options.ttlMs ?? PASSWORD_RESET_TTL_MS));
  const token = generateToken();
  await db.verificationToken.create({
    data: { identifier: normalized, token: hashToken(token), expires: expiresAt },
  });
  return { token, expiresAt };
}

/**
 * Применяет новый пароль. Токен выкупается первым `deleteMany` с точным условием: при
 * параллельных запросах успех достаётся одному, остальные получают отказ.
 */
export async function resetPasswordWithToken(
  run: TransactionRunner,
  token: string,
  newPassword: unknown,
  options: { now?: Date } = {},
): Promise<{ userId: string }> {
  assertPasswordAllowed(newPassword);
  const tokenHash = hashToken(token);
  const now = options.now ?? new Date();

  return run(async (db) => {
    const record = (await db.verificationToken.findFirst({ where: { token: tokenHash } })) as {
      identifier: string;
      token: string;
      expires: Date;
    } | null;
    if (!record) {
      throw new AuthError("invalid_token", "ссылка сброса недействительна");
    }

    const consumed = await db.verificationToken.deleteMany({
      where: { identifier: record.identifier, token: tokenHash },
    });
    if (consumed.count === 0) {
      throw new AuthError("invalid_token", "ссылка сброса недействительна");
    }
    if (isExpired(record.expires, now)) {
      throw new AuthError("invalid_token", "срок действия ссылки истёк");
    }

    const user = (await db.user.findFirst({
      where: { email: record.identifier, deletedAt: null },
    })) as { id: string } | null;
    if (!user) {
      throw new AuthError("invalid_token", "ссылка сброса недействительна");
    }

    const passwordHash = await hashPassword(newPassword as string);
    await db.user.updateMany({ where: { id: user.id }, data: { passwordHash } });
    await db.session.deleteMany({ where: { userId: user.id } });

    return { userId: user.id };
  });
}
