/**
 * Двухфакторный вход: включить, проверить код при входе, выключить, обновить запасные коды.
 *
 * Состояние живёт в четырёх полях пользователя (см. schema.prisma). Двойное использование кода исключено: принятый шаг запоминается, а запись
 * идёт «сравнить и записать» (`updateMany` с прежним значением в условии) — два одновременных запроса с одним кодом не пройдут оба.
 * Секрет и отпечатки запасных кодов наружу не уходят; секрет показывается человеку один раз — при настройке.
 */

import { timingSafeEqual } from "node:crypto";

import { auditEvent } from "../audit/service.ts";
import type { DbClient } from "../db/db-client.ts";
import { AuthError } from "./errors.ts";
import { verifyPassword } from "./password.ts";
import { generateRecoveryCodes, generateTotpSecret, looksLikeRecoveryCode, matchTotp, openSecret, otpauthUri, recoveryFingerprint, sealSecret } from "./totp.ts";

type Row = {
  id: string;
  email: string;
  passwordHash: string | null;
  totpSecret: string | null;
  totpEnabledAt: Date | null;
  totpLastStep: number | null;
  recoveryHashes: string;
};

const NOT_RIGHT = "Код не подошёл. Проверьте время на телефоне и введите новый код.";

async function load(db: DbClient, userId: string): Promise<Row | null> {
  return (await db.user.findFirst({ where: { id: userId, deletedAt: null } })) as Row | null;
}

const hashesOf = (row: Row) => row.recoveryHashes.split(",").filter(Boolean);

export async function twoFactorStatus(db: DbClient, userId: string): Promise<{ enabled: boolean; recoveryLeft: number }> {
  const row = await load(db, userId);
  return { enabled: Boolean(row?.totpEnabledAt), recoveryLeft: row?.totpEnabledAt ? hashesOf(row).length : 0 };
}

export async function isTwoFactorEnabled(db: DbClient, userId: string): Promise<boolean> {
  return (await twoFactorStatus(db, userId)).enabled;
}

/** Событие — в журнал каждой организации человека (учётка общая), как при смене пароля. */
async function audit(db: DbClient, userId: string, change: "enabled" | "disabled" | "recovery_renewed"): Promise<void> {
  const memberships = (await db.membership.findMany({ where: { userId } })) as { organizationId: string }[];
  for (const membership of memberships) {
    await auditEvent(db, { organizationId: membership.organizationId }, { actorUserId: userId, action: "auth.two_factor_changed", entityType: "user", entityId: userId, metadata: { change } });
  }
}

/** Шаг 1: выдать новый секрет. До подтверждения кодом вход не меняется, повторное нажатие выдаёт новый секрет. */
export async function beginSetup(db: DbClient, userId: string): Promise<{ secret: string; uri: string }> {
  const row = await load(db, userId);
  if (!row) throw new AuthError("unauthenticated", "требуется вход");
  if (row.totpEnabledAt) throw new AuthError("conflict", "Двухфакторный вход уже включён.");
  const secret = generateTotpSecret();
  await db.user.updateMany({ where: { id: userId }, data: { totpSecret: sealSecret(secret), totpEnabledAt: null, totpLastStep: null, recoveryHashes: "" } });
  return { secret, uri: otpauthUri(row.email, secret) };
}

/** Шаг 2: человек ввёл первый код из приложения — включаем и выдаём запасные коды (показываются один раз). */
export async function confirmSetup(db: DbClient, userId: string, code: unknown, now: number = Date.now()): Promise<string[]> {
  const row = await load(db, userId);
  if (!row?.totpSecret || row.totpEnabledAt) throw new AuthError("invalid_argument", "Сначала нажмите «Включить» и добавьте секрет в приложение.");
  const secret = openSecret(row.totpSecret);
  const step = secret ? matchTotp(secret, code, now) : null;
  if (step === null) throw new AuthError("invalid_argument", NOT_RIGHT);

  const codes = generateRecoveryCodes();
  const done = await db.user.updateMany({
    where: { id: userId, totpEnabledAt: null },
    data: { totpEnabledAt: new Date(now), totpLastStep: step, recoveryHashes: codes.map((c) => recoveryFingerprint(c)).join(",") },
  });
  if (done.count !== 1) throw new AuthError("conflict", "Двухфакторный вход уже включён.");
  await audit(db, userId, "enabled");
  return codes;
}

/**
 * Проверка второго фактора при входе и при опасных действиях: код приложения или запасной код.
 * Верный код тратится: TOTP — запоминанием шага, запасной — удалением из списка. Неверный, повторный и «гоночный» дают `false`.
 */
export async function checkSecondFactor(db: DbClient, userId: string, input: unknown, now: number = Date.now()): Promise<boolean> {
  const row = await load(db, userId);
  if (!row?.totpEnabledAt || !row.totpSecret) return false;

  if (looksLikeRecoveryCode(input)) {
    const given = Buffer.from(recoveryFingerprint(input));
    const stored = hashesOf(row);
    let hit = -1;
    stored.forEach((hash, index) => {
      const other = Buffer.from(hash);
      if (other.length === given.length && timingSafeEqual(other, given) && hit === -1) hit = index;
    });
    if (hit === -1) return false;
    const rest = stored.filter((_, index) => index !== hit).join(",");
    const done = await db.user.updateMany({ where: { id: userId, recoveryHashes: row.recoveryHashes }, data: { recoveryHashes: rest } });
    return done.count === 1;
  }

  const secret = openSecret(row.totpSecret);
  const step = secret ? matchTotp(secret, input, now) : null;
  if (step === null || (row.totpLastStep !== null && step <= row.totpLastStep)) return false;
  const done = await db.user.updateMany({ where: { id: userId, totpLastStep: row.totpLastStep }, data: { totpLastStep: step } });
  return done.count === 1;
}

/** Выключить: нужны и пароль, и код — иначе тот, кто сел за открытый компьютер, снял бы защиту. */
export async function disableTwoFactor(db: DbClient, userId: string, input: { password: unknown; code: unknown }, now: number = Date.now()): Promise<void> {
  const row = await load(db, userId);
  const okPassword = await verifyPassword(typeof input.password === "string" ? input.password : "", row?.passwordHash ?? null);
  if (!row || !okPassword) throw new AuthError("invalid_argument", "Пароль указан неверно.");
  if (!row.totpEnabledAt) throw new AuthError("invalid_argument", "Двухфакторный вход не включён.");
  if (!(await checkSecondFactor(db, userId, input.code, now))) throw new AuthError("invalid_argument", NOT_RIGHT);
  await db.user.updateMany({ where: { id: userId }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryHashes: "" } });
  await audit(db, userId, "disabled");
}

/** Новые запасные коды вместо прежних (потерян листок или остались единицы). Нужен код из приложения. */
export async function renewRecoveryCodes(db: DbClient, userId: string, code: unknown, now: number = Date.now()): Promise<string[]> {
  const row = await load(db, userId);
  if (!row?.totpEnabledAt) throw new AuthError("invalid_argument", "Двухфакторный вход не включён.");
  if (looksLikeRecoveryCode(code) || !(await checkSecondFactor(db, userId, code, now))) throw new AuthError("invalid_argument", NOT_RIGHT);
  const codes = generateRecoveryCodes();
  await db.user.updateMany({ where: { id: userId }, data: { recoveryHashes: codes.map((c) => recoveryFingerprint(c)).join(",") } });
  await audit(db, userId, "recovery_renewed");
  return codes;
}
