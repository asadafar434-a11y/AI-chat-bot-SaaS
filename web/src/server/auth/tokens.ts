/**
 * Одноразовые токены приглашений и сброса пароля.
 *
 * Сам токен показывается пользователю (в ссылке письма) ровно один раз; в БД хранится
 * только его хеш. Поэтому утечка таблицы не даёт возможности принять чужое приглашение
 * или сбросить чужой пароль. Поскольку токен случайный и длинный, перебор хеша
 * неосуществим, и соль здесь не нужна — SHA-256 достаточен.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const INVITATION_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 суток
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 час

const TOKEN_BYTES = 32;

/** 256 бит энтропии в base64url. */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Сравнение за постоянное время: значения одинаковой длины. */
export function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function isExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}
