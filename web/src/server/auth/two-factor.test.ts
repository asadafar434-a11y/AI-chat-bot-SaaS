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
import { beginSetup, checkSecondFactor, confirmSetup, disableTwoFactor, enablePin, isTwoFactorEnabled, lockedMessage, PIN_FREE_ATTEMPTS, pinLockSeconds, renewRecoveryCodes, twoFactorStatus, verifySecondFactor } from "./two-factor.ts";

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
  assert.deepEqual(await twoFactorStatus(memory.db, userId), { enabled: false, method: null, recoveryLeft: 0 });

  const { secret, uri } = await beginSetup(memory.db, userId);
  assert.ok(uri.includes(secret));
  assert.equal(await isTwoFactorEnabled(memory.db, userId), false, "секрет выдан, но не подтверждён");
  const now = Date.UTC(2026, 10, 3, 12, 0, 0);
  await assert.rejects(confirmSetup(memory.db, userId, "000000", now), /Код не подошёл/);
  assert.equal(await isTwoFactorEnabled(memory.db, userId), false);

  const codes = await confirmSetup(memory.db, userId, totpCodeAt(secret, totpStep(now)), now);
  assert.equal(codes.length, 10);
  assert.deepEqual(await twoFactorStatus(memory.db, userId), { enabled: true, method: "totp", recoveryLeft: 10 });
  const row = memory.table("user").find((r) => r.id === userId)!;
  assert.equal(JSON.stringify(row).includes(secret), false, "в базе нет открытого секрета");
  assert.equal(JSON.stringify(row).includes(codes[0]), false, "в базе нет открытых запасных кодов");
  assert.ok(memory.table("auditEvent").some((e) => e.action === "auth.two_factor_changed" && JSON.stringify(e.metadata) === '{"change":"enabled","method":"totp"}'));
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
  assert.deepEqual(await twoFactorStatus(memory.db, userId), { enabled: true, method: "totp", recoveryLeft: 9 });
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
  assert.deepEqual(await twoFactorStatus(memory.db, userId), { enabled: false, method: null, recoveryLeft: 0 });
  const row = memory.table("user").find((r) => r.id === userId)!;
  assert.equal(row.totpSecret, null);
  assert.equal(row.recoveryHashes, "");
  assert.ok(memory.table("auditEvent").some((e) => e.action === "auth.two_factor_changed" && JSON.stringify(e.metadata) === '{"change":"disabled","method":"totp"}'));
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
  assert.ok(memory.table("auditEvent").some((e) => e.action === "auth.two_factor_changed" && JSON.stringify(e.metadata) === '{"change":"recovery_renewed","method":"totp"}'));
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

// ── PIN из 4 цифр ────────────────────────────────────────────────────────────────────────────────

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
async function withPin(pin = "4827") {
  const { memory, userId } = await owner();
  const recovery = await enablePin(memory.db, userId, { pin, password: PASSWORD }, NOW);
  return { memory, userId, recovery, pin };
}
const rowOf = (memory: Awaited<ReturnType<typeof owner>>["memory"], userId: string) => memory.table("user").find((r) => r.id === userId)!;

test("PIN: включается с паролем, выдаёт 10 запасных кодов; в базе только отпечаток, не сам PIN", async () => {
  const { memory, userId, recovery } = await withPin();
  assert.equal(recovery.length, 10);
  assert.deepEqual(await twoFactorStatus(memory.db, userId), { enabled: true, method: "pin", recoveryLeft: 10 });
  const row = rowOf(memory, userId);
  assert.match(String(row.pinHash), /^v1\.[0-9a-f]{16}\.[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(row).includes("4827"), false, "открытого PIN в базе нет");
  assert.ok(memory.table("auditEvent").some((e) => e.action === "auth.two_factor_changed" && JSON.stringify(e.metadata) === '{"change":"enabled","method":"pin"}'));
});

test("PIN: без пароля, с неверным паролем, не из четырёх цифр и слишком простой — отказ, защита не включается", async () => {
  const { memory, userId } = await owner();
  await assert.rejects(enablePin(memory.db, userId, { pin: "4827", password: "неверный-пароль-1" }), /Пароль указан неверно/);
  await assert.rejects(enablePin(memory.db, userId, { pin: "4827", password: "" }), /Пароль указан неверно/);
  for (const bad of ["123", "12345", "abcd", "", undefined, 4827]) await assert.rejects(enablePin(memory.db, userId, { pin: bad, password: PASSWORD }), /ровно четыре цифры/, String(bad));
  for (const weak of ["0000", "7777", "1234", "4321", "6789", "3210"]) await assert.rejects(enablePin(memory.db, userId, { pin: weak, password: PASSWORD }), /Слишком простой/, weak);
  assert.equal(await isTwoFactorEnabled(memory.db, userId), false);
});

test("PIN и приложение — по одному: при включённом PIN приложение не настроить, и наоборот", async () => {
  const { memory, userId } = await withPin();
  await assert.rejects(beginSetup(memory.db, userId), /уже включён/);
  await assert.rejects(enablePin(memory.db, userId, { pin: "5936", password: PASSWORD }), /уже включён/);
  const other = await owner();
  const { secret } = await beginSetup(other.memory.db, other.userId);
  await confirmSetup(other.memory.db, other.userId, totpCodeAt(secret, totpStep(NOW)), NOW);
  await assert.rejects(enablePin(other.memory.db, other.userId, { pin: "4827", password: PASSWORD }), /уже включён/);
});

test("вход с PIN: верный проходит сколько угодно раз, неверный — нет, не-цифры не считаются попыткой", async () => {
  const { memory, userId, pin } = await withPin();
  assert.equal(await verifySecondFactor(memory.db, userId, pin, NOW), "ok");
  assert.equal(await verifySecondFactor(memory.db, userId, pin, NOW), "ok", "PIN не одноразовый, в отличие от кода приложения");
  assert.equal(await verifySecondFactor(memory.db, userId, "0001", NOW), "wrong");
  assert.equal(rowOf(memory, userId).pinFailures, 1);
  for (const junk of ["", "abcd", "12345", "12", undefined, 4827]) assert.equal(await verifySecondFactor(memory.db, userId, junk, NOW), "wrong");
  assert.equal(rowOf(memory, userId).pinFailures, 1, "мусор вместо PIN не расходует попытки");
  assert.equal(await verifySecondFactor(memory.db, userId, pin, NOW), "ok");
  assert.equal(rowOf(memory, userId).pinFailures, 0, "верный PIN обнуляет счётчик");
});

test("подбор PIN: после 5 ошибок пауза 15 минут, верный PIN во время паузы не принимается; после паузы одна попытка, ошибка — пауза вдвое длиннее", async () => {
  const { memory, userId, pin } = await withPin();
  for (let i = 0; i < PIN_FREE_ATTEMPTS; i += 1) assert.equal(await verifySecondFactor(memory.db, userId, "0002", NOW), "wrong");
  const locked = await verifySecondFactor(memory.db, userId, pin, NOW + 1000);
  assert.deepEqual(locked, { locked: 15 * 60 - 1 }, "верный PIN во время паузы отвергнут");
  assert.equal(rowOf(memory, userId).pinFailures, PIN_FREE_ATTEMPTS, "попытки во время паузы не накапливаются");

  const later = NOW + 15 * 60 * 1000 + 1;
  assert.equal(await verifySecondFactor(memory.db, userId, "0002", later), "wrong");
  assert.deepEqual(await verifySecondFactor(memory.db, userId, "0002", later + 1000), { locked: 30 * 60 - 1 }, "вторая пауза — 30 минут");
  assert.equal(await verifySecondFactor(memory.db, userId, pin, later + 31 * 60 * 1000), "ok", "после паузы верный PIN пускает и обнуляет счётчик");
  assert.equal(rowOf(memory, userId).pinFailures, 0);
});

test("паузы растут вдвое и не длиннее суток", () => {
  assert.deepEqual([5, 6, 7, 8, 9, 10, 11, 12, 20].map(pinLockSeconds), [900, 1800, 3600, 7200, 14400, 28800, 57600, 86400, 86400]);
  assert.match(lockedMessage(14 * 60), /14 мин/);
  assert.match(lockedMessage(3 * 3600), /3 ч/);
});

test("параллельный перебор не обходит блокировку: из 50 одновременных попыток проверяются не больше пяти", async () => {
  const { memory, userId, pin } = await withPin("4827");
  const guesses = Array.from({ length: 50 }, (_, i) => String(1000 + i * 37).padStart(4, "0")).filter((g) => g !== pin);
  guesses.push(pin); // верный PIN — среди попыток
  const results = await Promise.all(guesses.map((g) => verifySecondFactor(memory.db, userId, g, NOW)));
  const checked = results.filter((r) => r === "ok" || r === "wrong").length;
  assert.ok(checked <= PIN_FREE_ATTEMPTS + 1, `проверено ${checked}, допустимо не больше ${PIN_FREE_ATTEMPTS}`);
  assert.ok(results.some((r) => typeof r === "object"), "остальные получили паузу");
});

test("запасной код при включённом PIN: работает и во время паузы, снимает её", async () => {
  const { memory, userId, recovery, pin } = await withPin();
  for (let i = 0; i < PIN_FREE_ATTEMPTS; i += 1) await verifySecondFactor(memory.db, userId, "0002", NOW);
  assert.equal(typeof (await verifySecondFactor(memory.db, userId, pin, NOW + 1000)), "object");
  assert.equal(await verifySecondFactor(memory.db, userId, recovery[0], NOW + 2000), "ok");
  assert.equal(rowOf(memory, userId).pinFailures, 0);
  assert.equal(await verifySecondFactor(memory.db, userId, pin, NOW + 3000), "ok", "пауза снята");
  assert.equal(await verifySecondFactor(memory.db, userId, recovery[0], NOW + 4000), "wrong", "использованный запасной код не работает");
});

test("выключение и новые запасные коды при PIN: нужен PIN (и пароль для выключения); запасным кодом новые коды не выпустить", async () => {
  const { memory, userId, recovery, pin } = await withPin();
  await assert.rejects(renewRecoveryCodes(memory.db, userId, recovery[0], NOW), /PIN-код не подошёл/);
  const fresh = await renewRecoveryCodes(memory.db, userId, pin, NOW);
  assert.equal(fresh.length, 10);
  assert.equal(await verifySecondFactor(memory.db, userId, recovery[1], NOW), "wrong", "прежние запасные коды не работают");

  await assert.rejects(disableTwoFactor(memory.db, userId, { password: "неверный-пароль-1", code: pin }, NOW), /Пароль указан неверно/);
  await assert.rejects(disableTwoFactor(memory.db, userId, { password: PASSWORD, code: "0003" }, NOW), /PIN-код не подошёл/);
  await disableTwoFactor(memory.db, userId, { password: PASSWORD, code: pin }, NOW);
  assert.deepEqual(await twoFactorStatus(memory.db, userId), { enabled: false, method: null, recoveryLeft: 0 });
  const row = rowOf(memory, userId);
  assert.equal(row.pinHash, null);
  assert.equal(row.pinFailures, 0);
  assert.ok(memory.table("auditEvent").some((e) => e.action === "auth.two_factor_changed" && JSON.stringify(e.metadata) === '{"change":"disabled","method":"pin"}'));
});

test("утечка базы: PIN не вскрыть без ключа сервера — отпечаток с другим AUTH_SECRET не совпадает", async () => {
  const { memory, userId } = await withPin("4827");
  const stored = String(rowOf(memory, userId).pinHash);
  const { pinMatches } = await import("./totp.ts");
  assert.equal(pinMatches("4827", stored), true);
  assert.equal(pinMatches("4827", stored, "другой-ключ-другой-ключ-другой-ключ"), false);
});
