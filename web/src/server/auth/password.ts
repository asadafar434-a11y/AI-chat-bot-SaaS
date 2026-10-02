/**
 * Хеширование и проверка пароля.
 *
 * Используется встроенный в Node `scrypt` (память-затратный KDF), а не «хеш с солью»:
 * быстрый SHA без растяжения ключа позволяет перебирать пароли на GPU. Параметры
 * зафиксированы в самой строке хеша, поэтому их можно поднять позже, не ломая уже
 * сохранённые пароли: старый хеш проверяется по своим параметрам.
 *
 * Формат: `scrypt$N$r$p$salt(base64url)$hash(base64url)`.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

import { AuthError } from "./errors.ts";

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

// Верхние границы параметров при разборе сохранённого хеша: без них подделанная строка
// с огромным `N` заставила бы сервер считать scrypt неограниченно долго (DoS).
const MAX_N = 1 << 20;
const MAX_R = 32;
const MAX_P = 16;

type ParsedHash = { n: number; r: number; p: number; salt: Buffer; hash: Buffer };

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  params: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, params, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  if (n < 2 || n > MAX_N || (n & (n - 1)) !== 0) return null;
  if (r < 1 || r > MAX_R || p < 1 || p > MAX_P) return null;

  let salt: Buffer;
  let hash: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64url");
    hash = Buffer.from(parts[5], "base64url");
  } catch {
    return null;
  }
  if (salt.length === 0 || hash.length === 0) return null;
  return { n, r, p, salt, hash };
}

export function assertPasswordAllowed(password: unknown): asserts password is string {
  if (typeof password !== "string") {
    throw new AuthError("invalid_argument", "пароль не передан");
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new AuthError("invalid_argument", `пароль короче ${PASSWORD_MIN_LENGTH} символов`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new AuthError("invalid_argument", "пароль слишком длинный");
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertPasswordAllowed(password);
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

/**
 * Проверка пароля. Всегда выполняет scrypt той же стоимости, даже если хеша нет:
 * иначе по времени ответа можно было бы отличить несуществующего пользователя от
 * существующего с неверным паролем.
 */
export async function verifyPassword(password: string, storedHash: string | null | undefined): Promise<boolean> {
  const value = typeof password === "string" ? password : "";
  const parsed = typeof storedHash === "string" ? parseHash(storedHash) : null;
  const params = parsed ?? { n: N, r: R, p: P };
  const expectedLength = parsed?.hash.length ?? KEY_LENGTH;
  const salt = parsed?.salt ?? Buffer.alloc(SALT_LENGTH);

  const derived = await scryptAsync(value, salt, expectedLength, { N: params.n, r: params.r, p: params.p });
  if (!parsed || derived.length !== parsed.hash.length) return false;
  return timingSafeEqual(derived, parsed.hash);
}

/** Проверяет, что сохранённый хеш имеет поддерживаемый формат. Для диагностики и тестов. */
export function isValidPasswordHash(value: unknown): value is string {
  return typeof value === "string" && parseHash(value) !== null;
}
