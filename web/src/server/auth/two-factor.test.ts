import assert from "node:assert/strict";
import test from "node:test";

import { createOwner } from "./bootstrap.ts";
import { acceptInvitation } from "./invitation.ts";
import { withRunner } from "./transaction.ts";
import { createMemoryDb } from "./testing/memory-db.ts";
import {
  base32Decode,
  base32Encode,
  CHALLENGE_TTL_MS,
  generateRecoveryCodes,
  generateTotpSecret,
  matchTotp,
  openSecret,
  otpauthUri,
  readChallenge,
  sealSecret,
  signChallenge,
  totpCodeAt,
  totpStep,
} from "./totp.ts";
import { beginSetup, checkSecondFactor, confirmSetup, disableTwoFactor, isTwoFactorEnabled, renewRecoveryCodes, twoFactorStatus } from "./two-factor.ts";

// Ключ только для тестов.
process.env.AUTH_SECRET = "test-auth-secret-not-for-production-1234567890";

const PASSWORD = "test-password-123";

async function owner() {
  const memory = createMemoryDb();
  const run = withRunner(memory.db);
  const created = await createOwner(run, { email: "owner@example.com", organizationName: "Тест" });
  await acceptInvitation(run, created.link.token, { password: PASSWORD });
  return { memory, userId: created.userId };
}

/** Включённый второй шаг: секрет, запасные коды и «сейчас» для кодов. */
async function enabled(now = Date.UTC(2026, 10, 3, 12, 0, 0)) {
  const { memory, userId } = await owner();
  const { secret } = await beginSetup(memory.db, userId);
  const recovery = await confirmSetup(memory.db, userId, totpCodeAt(secret, totpStep(now)), now);
  return { memory, userId, secret, recovery, now };
}

test("TOTP: коды сверены с примерами из RFC 6238 (секрет «12345678901234567890», SHA-1)", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  assert.equal(secret, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.equal(totpCodeAt(secret, totpStep(59_000)), "287082");
  assert.equal(totpCodeAt(secret, totpStep(1_111_111_109_000)), "081804");
  assert.equal(totpCodeAt(secret, totpStep(1_234_567_890_000)), "005924");
  assert.deepEqual(base32Decode(secret), Buffer.from("12345678901234567890"));
});

test("TOTP: допуск на часы — один шаг назад и вперёд, дальше нет; пробелы в коде не мешают", () => {
  const secret = generateTotpSecret();
  const now = 1_800_000_000_000;
  const step = totpStep(now);
  assert.equal(matchTotp(secret, totpCodeAt(secret, step), now), step);
  assert.equal(matchTotp(secret, totpCodeAt(secret, step - 1), now), step - 1);
  assert.equal(matchTotp(secret, totpCodeAt(secret, step + 1), now), step + 1);
  assert.equal(matchTotp(secret, totpCodeAt(secret, step + 3), now), null);
  const code = totpCodeAt(secret, step);
  assert.equal(matchTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, now), step);
  for (const bad of ["", "12345", "1234567", "abcdef", undefined, null, 123456]) assert.equal(matchTotp(secret, bad, now), null);
});

test("секрет в базе зашифрован: открывается тем же ключом, чужим ключом и после порчи — нет", () => {
  const secret = generateTotpSecret();
  const sealed = sealSecret(secret);
  assert.equal(sealed.includes(secret), false);
  assert.equal(openSecret(sealed), secret);
  assert.notEqual(sealSecret(secret), sealed, "каждый раз другой шифртекст");
  assert.equal(openSecret(sealed, "другой-ключ-другой-ключ-другой-ключ"), null);
  assert.equal(openSecret(sealed.slice(0, -2) + "xx"), null);
  assert.equal(openSecret("мусор"), null);
});

test("ссылка для приложения: название, почта и секрет в адресе", () => {
  const uri = otpauthUri("a@b.ru", "ABCDEFGH");
  assert.ok(uri.startsWith("otpauth://totp/"));
  assert.ok(uri.includes("secret=ABCDEFGH"));
  assert.ok(uri.includes(encodeURIComponent("a@b.ru")));
  assert.ok(uri.includes("period=30") && uri.includes("digits=6"));
});

test("пропуск между паролем и кодом: подпись, срок 5 минут, подделка и чужой ключ не проходят", () => {
  const now = 1_800_000_000_000;
  const token = signChallenge("user-1", now);
  assert.equal(readChallenge(token, now + 1000), "user-1");
  assert.equal(readChallenge(token, now + CHALLENGE_TTL_MS + 1), null);
  const [body, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ u: "user-2", e: now + CHALLENGE_TTL_MS })).toString("base64url");
  assert.equal(readChallenge(`${forged}.${sig}`, now), null);
  assert.equal(readChallenge(`${body}.${sig}x`, now), null);
  assert.equal(readChallenge("a.b.c", now), null);
  for (const bad of [undefined, null, "", 5, {}]) assert.equal(readChallenge(bad, now), null);
});

test("запасные коды: десять разных, вида «xxxx-xxxx-xxxx-xxxx»", () => {
  const codes = generateRecoveryCodes();
  assert.equal(new Set(codes).size, 10);
  for (const code of codes) assert.match(code, /^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
});

test("включение: до подтверждения кодом вход не меняется; неверный код не включает; верный включает и выдаёт 10 запасных кодов", async () => {
  const { memory, userId } = await owner();
  assert.deepEqual(await twoFactorStatus(memory.db, userId), { enabled: false, recoveryLeft: 0 });

  const { secret, uri } = await beginSetup(memory.db, userId);
  assert.ok(uri.includes(secret));
  assert.equal(await isTwoFactorEnabled(memory.db, userId), false, "секрет выдан, но не подтверждён");
  const now = Date.UTC(2026, 10, 3, 12, 0, 0);
  await assert.rejects(confirmSetup(memory.db, userId, "000000", now), /Код не подошёл/);
  assert.equal(await isTwoFactorEnabled(memory.db, userId), false);

  const codes = await confirmSetup(memory.db, userId, totpCodeAt(secret, totpStep(now)), now);
  assert.equal(codes.length, 10);
  assert.deepEqual(await twoFactorStatus(memory.db, userId), { enabled: true, recoveryLeft: 10 });
  const row = memory.table("user").find((r) => r.id === userId)!;
  assert.equal(JSON.stringify(row).includes(secret), false, "в базе нет открытого секрета");
  assert.equal(JSON.stringify(row).includes(codes[0]), false, "в базе нет открытых запасных кодов");
  assert.ok(memory.table("auditEvent").some((e) => e.action === "auth.two_factor_changed" && JSON.stringify(e.metadata) === '{"change":"enabled"}'));
  await assert.rejects(beginSetup(memory.db, userId), /уже включён/);
});

test("вход: верный код проходит один раз, тот же код второй раз и неверный — нет", async () => {
  const { memory, userId, secret, now } = await enabled();
  const next = now + 30_000;
  const code = totpCodeAt(secret, totpStep(next));
  assert.equal(await checkSecondFactor(memory.db, userId, "000000", next), false);
  assert.equal(await checkSecondFactor(memory.db, userId, code, next), true);
  assert.equal(await checkSecondFactor(memory.db, userId, code, next), false, "тот же код повторно не принимается");
  assert.equal(await checkSecondFactor(memory.db, userId, totpCodeAt(secret, totpStep(now)), next), false, "код уже использованного шага или старше — нет");
});

test("код, который подтвердил включение, тоже нельзя использовать для входа", async () => {
  const { memory, userId, secret, now } = await enabled();
  assert.equal(await checkSecondFactor(memory.db, userId, totpCodeAt(secret, totpStep(now)), now), false);
});

test("два одновременных запроса с одним кодом: проходит только один", async () => {
  const { memory, userId, secret, now } = await enabled();
  const next = now + 30_000;
  const code = totpCodeAt(secret, totpStep(next));
  const results = await Promise.all([checkSecondFactor(memory.db, userId, code, next), checkSecondFactor(memory.db, userId, code, next)]);
  assert.equal(results.filter(Boolean).length, 1);
});

test("запасной код: работает один раз и тратится; чужой и выдуманный — нет", async () => {
  const { memory, userId, recovery } = await enabled();
  assert.equal(await checkSecondFactor(memory.db, userId, "abcd-efgh-jkmn-pqrs"), false);
  assert.equal(await checkSecondFactor(memory.db, userId, recovery[3].toUpperCase().replaceAll("-", " ")), true, "регистр и пробелы вместо дефисов не мешают");
  assert.equal(await checkSecondFactor(memory.db, userId, recovery[3]), false);
  assert.deepEqual(await twoFactorStatus(memory.db, userId), { enabled: true, recoveryLeft: 9 });
  assert.equal(await checkSecondFactor(memory.db, userId, recovery[0]), true);
  assert.equal((await twoFactorStatus(memory.db, userId)).recoveryLeft, 8);
});

test("у человека без второго шага любой код — отказ", async () => {
  const { memory, userId } = await owner();
  assert.equal(await checkSecondFactor(memory.db, userId, "123456"), false);
});

test("выключение: нужны и пароль, и код; после отказов защита на месте, с верными данными — снята", async () => {
  const { memory, userId, secret, now } = await enabled();
  const next = now + 30_000;
  const code = totpCodeAt(secret, totpStep(next));
  await assert.rejects(disableTwoFactor(memory.db, userId, { password: "неверный-пароль-1", code }, next), /Пароль указан неверно/);
  await assert.rejects(disableTwoFactor(memory.db, userId, { password: PASSWORD, code: "000000" }, next), /Код не подошёл/);
  assert.equal(await isTwoFactorEnabled(memory.db, userId), true);

  await disableTwoFactor(memory.db, userId, { password: PASSWORD, code }, next);
  assert.equal(await isTwoFactorEnabled(memory.db, userId), false);
});

test("выключение запасным кодом: секрет, шаг и коды стираются, событие в журнале", async () => {
  const { memory, userId, recovery } = await enabled();
  await disableTwoFactor(memory.db, userId, { password: PASSWORD, code: recovery[0] });
  assert.deepEqual(await twoFactorStatus(memory.db, userId), { enabled: false, recoveryLeft: 0 });
  const row = memory.table("user").find((r) => r.id === userId)!;
  assert.equal(row.totpSecret, null);
  assert.equal(row.recoveryHashes, "");
  assert.ok(memory.table("auditEvent").some((e) => e.action === "auth.two_factor_changed" && JSON.stringify(e.metadata) === '{"change":"disabled"}'));
  await assert.rejects(disableTwoFactor(memory.db, userId, { password: PASSWORD, code: "000000" }), /не включён/);
});

test("новые запасные коды: нужен код из приложения (запасным нельзя); прежние перестают работать", async () => {
  const { memory, userId, secret, recovery, now } = await enabled();
  const next = now + 30_000;
  await assert.rejects(renewRecoveryCodes(memory.db, userId, recovery[0], next), /Код не подошёл/);
  assert.equal((await twoFactorStatus(memory.db, userId)).recoveryLeft, 10, "отказ ничего не потратил");

  const fresh = await renewRecoveryCodes(memory.db, userId, totpCodeAt(secret, totpStep(next)), next);
  assert.equal(fresh.length, 10);
  assert.equal(await checkSecondFactor(memory.db, userId, recovery[1], next), false, "прежний запасной код больше не работает");
  assert.equal(await checkSecondFactor(memory.db, userId, fresh[1], next), true);
  assert.ok(memory.table("auditEvent").some((e) => e.action === "auth.two_factor_changed" && JSON.stringify(e.metadata) === '{"change":"recovery_renewed"}'));
});

test("повторная настройка до подтверждения выдаёт новый секрет, старый не работает", async () => {
  const { memory, userId } = await owner();
  const first = await beginSetup(memory.db, userId);
  const second = await beginSetup(memory.db, userId);
  assert.notEqual(first.secret, second.secret);
  const now = Date.UTC(2026, 10, 3, 12, 0, 0);
  await assert.rejects(confirmSetup(memory.db, userId, totpCodeAt(first.secret, totpStep(now)), now), /Код не подошёл/);
  await confirmSetup(memory.db, userId, totpCodeAt(second.secret, totpStep(now)), now);
  assert.equal(await isTwoFactorEnabled(memory.db, userId), true);
});
