/**
 * Двухфакторный вход: одноразовые коды приложения-аутентификатора (TOTP, RFC 6238) и запасные коды.
 *
 * Без внешних библиотек — только `node:crypto`. Здесь чистые функции без базы: разбор секрета, расчёт кода, шифрование секрета в базе,
 * запасные коды и подписанный «пропуск» между вводом пароля и вводом кода (`two-factor.ts` складывает это с базой).
 *
 * Параметры — те, что понимают все приложения (Google Authenticator, Яндекс Ключ, Authy, 1Password): SHA-1, 6 цифр, шаг 30 секунд.
 * Секрет в базе лежит зашифрованным (AES-256-GCM) ключом из AUTH_SECRET: утёкшая копия базы одна кодов не даёт.
 */

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Допуск на часы телефона: код предыдущего и следующего шага тоже принимается. */
export const TOTP_WINDOW = 1;
export const RECOVERY_CODE_COUNT = 10;
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
// Запасные коды без похожих знаков (0/o, 1/l/i): их набирают с бумаги.
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer | null {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  if (!clean) return null;
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const index = ALPHABET.indexOf(ch);
    if (index === -1) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Новый секрет: 160 бит, как требует RFC 4226, строкой base32 (её и вводят вручную в приложение). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function hotp(key: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

export function totpCodeAt(secret: string, step: number): string {
  const key = base32Decode(secret);
  if (!key) throw new Error("secret не base32");
  return hotp(key, step);
}

/** Знаки кода как набрал человек: пробелы и дефис в середине («123 456») не мешают. */
export function normalizeCode(input: unknown): string {
  return typeof input === "string" ? input.replace(/[\s-]/g, "").toLowerCase() : "";
}

/**
 * Какому шагу соответствует введённый код (в пределах допуска) — либо `null`. Шаг нужен, чтобы запомнить его и не принять тот же код дважды.
 * Сравнение за постоянное время; перебираются все шаги окна, чтобы по времени ответа нельзя было понять, где совпало.
 */
export function matchTotp(secret: string, input: unknown, nowMs: number = Date.now()): number | null {
  const code = normalizeCode(input);
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secret);
  if (!key) return null;
  const now = totpStep(nowMs);
  let found: number | null = null;
  for (let step = now - TOTP_WINDOW; step <= now + TOTP_WINDOW; step++) {
    const expected = Buffer.from(hotp(key, step));
    if (timingSafeEqual(expected, Buffer.from(code)) && found === null) found = step;
  }
  return found;
}

/** Ссылка для приложения-аутентификатора (из неё же рисуется QR). */
export function otpauthUri(email: string, secret: string, issuer = "Тендекс"): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

// ── Ключ и шифрование секрета ───────────────────────────────────────────────────────────────────

function masterKey(secret: string | undefined = process.env.AUTH_SECRET): Buffer {
  if (!secret || secret.length < 16) {
    throw new Error("Для двухфакторного входа на сервере должен быть задан AUTH_SECRET (не короче 16 знаков).");
  }
  return Buffer.from(hkdfSync("sha256", secret, "", "tendex-2fa-v1", 32));
}

/** Секрет TOTP для базы: `v1.<iv>.<тег>.<шифртекст>`, всё base64url. */
export function sealSecret(plain: string, authSecret?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(authSecret), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

/** Обратное действие; испорченная или подделанная строка (или другой AUTH_SECRET) даёт `null`, а не ошибку. */
export function openSecret(sealed: string, authSecret?: string): string | null {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", masterKey(authSecret), Buffer.from(parts[1], "base64url"));
    decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ── Запасные коды ──────────────────────────────────────────────────────────────────────────────

/** Десять кодов вида «abcd-efgh-jkmn-pqrs» (80 бит каждый). Человеку показываются один раз, в базе — только отпечатки. */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const chars = Array.from({ length: 16 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]);
    return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join("")).join("-");
  });
}

export function recoveryFingerprint(code: unknown, authSecret?: string): string {
  return createHmac("sha256", masterKey(authSecret)).update(`recovery:${normalizeCode(code)}`).digest("hex");
}

export function looksLikeRecoveryCode(input: unknown): boolean {
  return /^[a-z0-9]{16}$/.test(normalizeCode(input));
}

// ── PIN-код ────────────────────────────────────────────────────────────────────────────────────

/** Только четыре цифры; всё остальное — не PIN. */
export function normalizePin(input: unknown): string | null {
  const pin = typeof input === "string" ? input.trim() : "";
  return /^\d{4}$/.test(pin) ? pin : null;
}

/** Слишком простые PIN (0000, 7777, 1234, 4321, 6789): их угадывают первыми. */
export function isWeakPin(pin: string): boolean {
  const digits = [...pin].map(Number);
  const step = digits[1] - digits[0];
  return digits.every((d, i) => i === 0 || d - digits[i - 1] === step) && Math.abs(step) <= 1;
}

/**
 * Отпечаток PIN: HMAC с ключом сервера и солью человека. Без ключа из AUTH_SECRET 10 000 вариантов по утёкшей базе не перебрать:
 * простой хеш четырёх цифр вскрывается за долю секунды.
 */
export function pinFingerprint(pin: string, salt: string, authSecret?: string): string {
  return createHmac("sha256", masterKey(authSecret)).update(`pin:${salt}:${pin}`).digest("hex");
}

export function newPinHash(pin: string, authSecret?: string): string {
  const salt = randomBytes(8).toString("hex");
  return `v1.${salt}.${pinFingerprint(pin, salt, authSecret)}`;
}

export function pinMatches(pin: string, stored: string, authSecret?: string): boolean {
  const [version, salt, hash] = stored.split(".");
  if (version !== "v1" || !salt || !hash) return false;
  const expected = Buffer.from(pinFingerprint(pin, salt, authSecret));
  const given = Buffer.from(hash);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ── «Пропуск» между паролем и кодом ─────────────────────────────────────────────────────────────

/** Подписанный пропуск: пароль верен, остался код. Сам по себе вход не даёт и живёт 5 минут. */
export function signChallenge(userId: string, nowMs: number = Date.now(), authSecret?: string): string {
  const body = Buffer.from(JSON.stringify({ u: userId, e: nowMs + CHALLENGE_TTL_MS })).toString("base64url");
  const sig = createHmac("sha256", masterKey(authSecret)).update(`challenge:${body}`).digest("base64url");
  return `${body}.${sig}`;
}

export function readChallenge(token: unknown, nowMs: number = Date.now(), authSecret?: string): string | null {
  if (typeof token !== "string") return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = createHmac("sha256", masterKey(authSecret)).update(`challenge:${body}`).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { u?: unknown; e?: unknown };
    if (typeof parsed.u !== "string" || typeof parsed.e !== "number" || parsed.e < nowMs) return null;
    return parsed.u;
  } catch {
    return null;
  }
}
