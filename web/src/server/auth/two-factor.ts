/**
 * Второй шаг входа: код приложения-аутентификатора (TOTP) или PIN из четырёх цифр; запасные коды у обоих. Включить, проверить при входе,
 * выключить, выпустить новые запасные коды. Способ один: либо приложение, либо PIN.
 *
 * Состояние живёт в полях пользователя (см. schema.prisma). Двойное использование кода исключено: принятый шаг запоминается, а запись
 * идёт «сравнить и записать» (`updateMany` с прежним значением в условии) — два одновременных запроса с одним кодом не пройдут оба.
 * Секрет, PIN и запасные коды в базе — только в виде отпечатков/шифртекста; секрет показывается человеку один раз — при настройке.
 *
 * PIN из 4 цифр — всего 10 000 вариантов, поэтому защита от подбора здесь строже, чем у кода приложения:
 *  - каждая попытка засчитывается ДО проверки (счётчик растёт «сравнить и записать»), иначе параллельные запросы успели бы перебрать
 *    всё, пока блокировка ещё не стоит;
 *  - с 5-й ошибки — блокировка, и каждая следующая ошибка удваивает паузу: 15 мин, 30 мин, 1 ч … до суток; верный PIN обнуляет счётчик;
 *  - запасной код блокировку снимает: он 80-битный, перебором не берётся.
 */

import { timingSafeEqual } from "node:crypto";

import { auditEvent } from "../audit/service.ts";
import type { DbClient } from "../db/db-client.ts";
import { AuthError } from "./errors.ts";
import { verifyPassword } from "./password.ts";
import {
  generateRecoveryCodes,
  generateTotpSecret,
  isWeakPin,
  looksLikeRecoveryCode,
  matchTotp,
  newPinHash,
  normalizePin,
  openSecret,
  otpauthUri,
  pinMatches,
  recoveryFingerprint,
  sealSecret,
} from "./totp.ts";

export type TwoFactorMethod = "totp" | "pin";

type Row = {
  id: string;
  email: string;
  passwordHash: string | null;
  totpSecret: string | null;
  totpEnabledAt: Date | null;
  totpLastStep: number | null;
  recoveryHashes: string;
  pinHash: string | null;
  pinEnabledAt: Date | null;
  pinFailures: number;
  pinLockedUntil: Date | null;
};

/** Сколько неверных PIN подряд без паузы; пауза после — `pinLockSeconds`. */
export const PIN_FREE_ATTEMPTS = 5;
export const PIN_LOCK_MAX_SECONDS = 24 * 60 * 60;

/** Пауза после n-й неверной попытки (n ≥ 5): 15 мин, 30 мин, 1 ч, 2 ч … не больше суток. */
export const pinLockSeconds = (failures: number): number => Math.min(PIN_LOCK_MAX_SECONDS, 15 * 60 * 2 ** Math.max(0, failures - PIN_FREE_ATTEMPTS));

const NOT_RIGHT_TOTP = "Код не подошёл. Проверьте время на телефоне и введите новый код.";
const NOT_RIGHT_PIN = "PIN-код не подошёл.";
const WEAK_PIN = "Слишком простой PIN: 0000, 1234 и им подобные угадывают первыми. Придумайте другой.";

async function load(db: DbClient, userId: string): Promise<Row | null> {
  return (await db.user.findFirst({ where: { id: userId, deletedAt: null } })) as Row | null;
}

const hashesOf = (row: Row) => row.recoveryHashes.split(",").filter(Boolean);
const methodOf = (row: Row | null): TwoFactorMethod | null => (row?.pinEnabledAt ? "pin" : row?.totpEnabledAt ? "totp" : null);
const notRight = (row: Row) => (row.pinEnabledAt ? NOT_RIGHT_PIN : NOT_RIGHT_TOTP);

export async function twoFactorStatus(db: DbClient, userId: string): Promise<{ enabled: boolean; method: TwoFactorMethod | null; recoveryLeft: number }> {
  const row = await load(db, userId);
  const method = methodOf(row);
  return { enabled: method !== null, method, recoveryLeft: method && row ? hashesOf(row).length : 0 };
}

export async function isTwoFactorEnabled(db: DbClient, userId: string): Promise<boolean> {
  return (await twoFactorStatus(db, userId)).enabled;
}

/** Какой способ спросить при входе: приложение, PIN или ничего. */
export async function secondFactorMethod(db: DbClient, userId: string): Promise<TwoFactorMethod | null> {
  return (await twoFactorStatus(db, userId)).method;
}

/** Событие — в журнал каждой организации человека (учётка общая), как при смене пароля. */
async function audit(db: DbClient, userId: string, change: "enabled" | "disabled" | "recovery_renewed", method?: TwoFactorMethod): Promise<void> {
  const memberships = (await db.membership.findMany({ where: { userId } })) as { organizationId: string }[];
  for (const membership of memberships) {
    await auditEvent(db, { organizationId: membership.organizationId }, { actorUserId: userId, action: "auth.two_factor_changed", entityType: "user", entityId: userId, metadata: method ? { change, method } : { change } });
  }
}

/** Шаг 1 (приложение): выдать новый секрет. До подтверждения кодом вход не меняется, повторное нажатие выдаёт новый секрет. */
export async function beginSetup(db: DbClient, userId: string): Promise<{ secret: string; uri: string }> {
  const row = await load(db, userId);
  if (!row) throw new AuthError("unauthenticated", "требуется вход");
  if (methodOf(row)) throw new AuthError("conflict", "Двухфакторный вход уже включён.");
  const secret = generateTotpSecret();
  await db.user.updateMany({ where: { id: userId }, data: { totpSecret: sealSecret(secret), totpEnabledAt: null, totpLastStep: null, recoveryHashes: "" } });
  return { secret, uri: otpauthUri(row.email, secret) };
}

/** Шаг 2 (приложение): человек ввёл первый код — включаем и выдаём запасные коды (показываются один раз). */
export async function confirmSetup(db: DbClient, userId: string, code: unknown, now: number = Date.now()): Promise<string[]> {
  const row = await load(db, userId);
  if (!row?.totpSecret || methodOf(row)) throw new AuthError("invalid_argument", "Сначала нажмите «Включить» и добавьте секрет в приложение.");
  const secret = openSecret(row.totpSecret);
  const step = secret ? matchTotp(secret, code, now) : null;
  if (step === null) throw new AuthError("invalid_argument", NOT_RIGHT_TOTP);

  const codes = generateRecoveryCodes();
  const done = await db.user.updateMany({
    where: { id: userId, totpEnabledAt: null, pinEnabledAt: null },
    data: { totpEnabledAt: new Date(now), totpLastStep: step, recoveryHashes: codes.map((c) => recoveryFingerprint(c)).join(",") },
  });
  if (done.count !== 1) throw new AuthError("conflict", "Двухфакторный вход уже включён.");
  await audit(db, userId, "enabled", "totp");
  return codes;
}

/** Включить PIN из 4 цифр. Нужен пароль: иначе тот, кто сел за открытый компьютер, поставил бы свой PIN и закрыл вход владельцу. */
export async function enablePin(db: DbClient, userId: string, input: { pin: unknown; password: unknown }, now: number = Date.now()): Promise<string[]> {
  const row = await load(db, userId);
  const okPassword = await verifyPassword(typeof input.password === "string" ? input.password : "", row?.passwordHash ?? null);
  if (!row || !okPassword) throw new AuthError("invalid_argument", "Пароль указан неверно.");
  if (methodOf(row)) throw new AuthError("conflict", "Двухфакторный вход уже включён.");
  const pin = normalizePin(input.pin);
  if (!pin) throw new AuthError("invalid_argument", "PIN — ровно четыре цифры.");
  if (isWeakPin(pin)) throw new AuthError("invalid_argument", WEAK_PIN);

  const codes = generateRecoveryCodes();
  const done = await db.user.updateMany({
    where: { id: userId, totpEnabledAt: null, pinEnabledAt: null },
    data: {
      pinHash: newPinHash(pin),
      pinEnabledAt: new Date(now),
      pinFailures: 0,
      pinLockedUntil: null,
      totpSecret: null,
      totpLastStep: null,
      recoveryHashes: codes.map((c) => recoveryFingerprint(c)).join(","),
    },
  });
  if (done.count !== 1) throw new AuthError("conflict", "Двухфакторный вход уже включён.");
  await audit(db, userId, "enabled", "pin");
  return codes;
}

export type SecondFactorResult = "ok" | "wrong" | { locked: number };

/**
 * Проверка второго фактора при входе и при опасных действиях: код приложения, PIN или запасной код.
 * Верный код тратится: TOTP — запоминанием шага, запасной — удалением из списка, PIN — обнулением счётчика. Неверный, повторный и «гоночный»
 * дают `"wrong"`; PIN во время паузы — `{ locked: секунд }` (проверка при этом не выполняется).
 */
export async function verifySecondFactor(db: DbClient, userId: string, input: unknown, now: number = Date.now()): Promise<SecondFactorResult> {
  const row = await load(db, userId);
  const method = methodOf(row);
  if (!row || !method) return "wrong";

  // Запасной код: 80 бит, подбором не берётся — работает и во время паузы, и снимает её.
  if (looksLikeRecoveryCode(input)) {
    const given = Buffer.from(recoveryFingerprint(input));
    const stored = hashesOf(row);
    let hit = -1;
    stored.forEach((hash, index) => {
      const other = Buffer.from(hash);
      if (other.length === given.length && timingSafeEqual(other, given) && hit === -1) hit = index;
    });
    if (hit === -1) return "wrong";
    const rest = stored.filter((_, index) => index !== hit).join(",");
    const done = await db.user.updateMany({
      where: { id: userId, recoveryHashes: row.recoveryHashes },
      data: method === "pin" ? { recoveryHashes: rest, pinFailures: 0, pinLockedUntil: null } : { recoveryHashes: rest },
    });
    return done.count === 1 ? "ok" : "wrong";
  }

  if (method === "pin") return verifyPin(db, userId, row, input, now);

  const secret = row.totpSecret ? openSecret(row.totpSecret) : null;
  const step = secret ? matchTotp(secret, input, now) : null;
  if (step === null || (row.totpLastStep !== null && step <= row.totpLastStep)) return "wrong";
  const done = await db.user.updateMany({ where: { id: userId, totpLastStep: row.totpLastStep }, data: { totpLastStep: step } });
  return done.count === 1 ? "ok" : "wrong";
}

async function verifyPin(db: DbClient, userId: string, first: Row, input: unknown, now: number): Promise<SecondFactorResult> {
  const pin = normalizePin(input);
  if (!pin) return "wrong"; // не четыре цифры — это не попытка угадать, счётчик не трогаем

  // Попытка засчитывается до проверки: «сравнить и записать» по счётчику. Параллельные запросы получают разные номера попыток и упираются
  // в паузу, а не проверяются все разом.
  let reserved: Row | null = null;
  for (let attempt = 0; attempt < 8 && !reserved; attempt += 1) {
    const fresh = attempt === 0 ? first : await load(db, userId);
    if (!fresh?.pinEnabledAt || !fresh.pinHash) return "wrong";
    const lockedUntil = fresh.pinLockedUntil ? fresh.pinLockedUntil.getTime() : 0;
    if (lockedUntil > now) return { locked: Math.ceil((lockedUntil - now) / 1000) };
    const failures = fresh.pinFailures + 1;
    const lock = failures >= PIN_FREE_ATTEMPTS ? new Date(now + pinLockSeconds(failures) * 1000) : null;
    const done = await db.user.updateMany({ where: { id: userId, pinFailures: fresh.pinFailures }, data: { pinFailures: failures, pinLockedUntil: lock } });
    if (done.count === 1) reserved = fresh;
  }
  if (!reserved?.pinHash) return { locked: 60 }; // слишком много одновременных попыток — просим подождать

  if (!pinMatches(pin, reserved.pinHash)) return "wrong";
  await db.user.updateMany({ where: { id: userId }, data: { pinFailures: 0, pinLockedUntil: null } });
  return "ok";
}

export async function checkSecondFactor(db: DbClient, userId: string, input: unknown, now: number = Date.now()): Promise<boolean> {
  return (await verifySecondFactor(db, userId, input, now)) === "ok";
}

const lockText = (seconds: number) => {
  const minutes = Math.ceil(seconds / 60);
  return minutes >= 120 ? `${Math.ceil(minutes / 60)} ч` : `${minutes} мин`;
};

/** Текст отказа человеку: пауза после неверных PIN — с оставшимся временем. */
export const lockedMessage = (seconds: number) => `Слишком много неверных PIN-кодов подряд. Подождите ${lockText(seconds)} — или войдите по запасному коду.`;

/** Выключить: нужны и пароль, и второй фактор — иначе тот, кто сел за открытый компьютер, снял бы защиту. */
export async function disableTwoFactor(db: DbClient, userId: string, input: { password: unknown; code: unknown }, now: number = Date.now()): Promise<void> {
  const row = await load(db, userId);
  const okPassword = await verifyPassword(typeof input.password === "string" ? input.password : "", row?.passwordHash ?? null);
  if (!row || !okPassword) throw new AuthError("invalid_argument", "Пароль указан неверно.");
  const was = methodOf(row);
  if (!was) throw new AuthError("invalid_argument", "Двухфакторный вход не включён.");
  const result = await verifySecondFactor(db, userId, input.code, now);
  if (typeof result === "object") throw new AuthError("invalid_argument", lockedMessage(result.locked));
  if (result !== "ok") throw new AuthError("invalid_argument", notRight(row));
  await db.user.updateMany({
    where: { id: userId },
    data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryHashes: "", pinHash: null, pinEnabledAt: null, pinFailures: 0, pinLockedUntil: null },
  });
  await audit(db, userId, "disabled", was);
}

/** Новые запасные коды вместо прежних (потерян листок или остались единицы). Нужен код приложения или PIN — запасным нельзя. */
export async function renewRecoveryCodes(db: DbClient, userId: string, code: unknown, now: number = Date.now()): Promise<string[]> {
  const row = await load(db, userId);
  const was = methodOf(row);
  if (!row || !was) throw new AuthError("invalid_argument", "Двухфакторный вход не включён.");
  if (looksLikeRecoveryCode(code)) throw new AuthError("invalid_argument", notRight(row));
  const result = await verifySecondFactor(db, userId, code, now);
  if (typeof result === "object") throw new AuthError("invalid_argument", lockedMessage(result.locked));
  if (result !== "ok") throw new AuthError("invalid_argument", notRight(row));
  const codes = generateRecoveryCodes();
  await db.user.updateMany({ where: { id: userId }, data: { recoveryHashes: codes.map((c) => recoveryFingerprint(c)).join(",") } });
  await audit(db, userId, "recovery_renewed", was);
  return codes;
}
