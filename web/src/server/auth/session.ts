/**
 * Серверные сессии в PostgreSQL (решение D4).
 *
 * Cookie хранит только `sessionToken`; сама строка сессии и её срок живут в таблице
 * `Session` и проверяются на сервере при каждом защищённом обращении. Это делает отзыв
 * немедленным: удаление строки завершает сессию, чего нельзя сделать с JWT без
 * блок-листа.
 *
 * Имена и параметры cookie совпадают с ожиданиями Auth.js, чтобы сессия, созданная
 * собственным входом, читалась `auth()` и адаптером Prisma.
 */

import { randomBytes } from "node:crypto";

import type { DbClient } from "../db/db-client.ts";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 суток
export const SESSION_MAX_AGE_SECONDS = Math.floor(SESSION_TTL_MS / 1000);

export const SESSION_COOKIE_NAME = "authjs.session-token";
export const SECURE_SESSION_COOKIE_NAME = "__Secure-authjs.session-token";

export type SessionRow = { id: string; sessionToken: string; userId: string; expires: Date };
export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  deletedAt: Date | null;
};
export type AuthenticatedSession = { sessionId: string; userId: string; expires: Date };

export function sessionCookieName(secure: boolean): string {
  return secure ? SECURE_SESSION_COOKIE_NAME : SESSION_COOKIE_NAME;
}

/** 256 бит энтропии: значение cookie, которое нельзя подобрать. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createSession(
  db: DbClient,
  input: { userId: string; now?: Date; ttlMs?: number },
): Promise<{ token: string; expires: Date }> {
  const now = input.now ?? new Date();
  const expires = new Date(now.getTime() + (input.ttlMs ?? SESSION_TTL_MS));
  const token = generateSessionToken();
  await db.session.create({ data: { sessionToken: token, userId: input.userId, expires } });
  return { token, expires };
}

export async function getActiveSession(
  db: DbClient,
  token: string | null | undefined,
  now: Date = new Date(),
): Promise<AuthenticatedSession | null> {
  if (typeof token !== "string" || token.length === 0) {
    return null;
  }
  const row = (await db.session.findFirst({
    where: { sessionToken: token, expires: { gt: now } },
  })) as SessionRow | null;
  if (!row) {
    return null;
  }
  return { sessionId: row.id, userId: row.userId, expires: row.expires };
}

/**
 * Сессия вместе с пользователем. Мягко удалённый пользователь сессии не получает: сессия
 * при этом отзывается, чтобы удалённый аккаунт не оставался «входабельным» после
 * восстановления занятости email.
 */
export async function getSessionAndUser(
  db: DbClient,
  token: string | null | undefined,
  now: Date = new Date(),
): Promise<{ session: AuthenticatedSession; user: SessionUser } | null> {
  if (typeof token !== "string" || token.length === 0) {
    return null;
  }
  const session = await getActiveSession(db, token, now);
  if (!session) {
    return null;
  }
  const user = (await db.user.findFirst({
    where: { id: session.userId, deletedAt: null },
  })) as SessionUser | null;
  if (!user) {
    await deleteSession(db, token);
    return null;
  }
  return { session, user };
}

export async function deleteSession(db: DbClient, token: string): Promise<number> {
  const result = await db.session.deleteMany({ where: { sessionToken: token } });
  return result.count;
}

export async function deleteSessionsForUser(db: DbClient, userId: string): Promise<number> {
  const result = await db.session.deleteMany({ where: { userId } });
  return result.count;
}
