import assert from "node:assert/strict";
import test from "node:test";

import { AuthError } from "./errors.ts";
import {
  assertPasswordAllowed,
  hashPassword,
  isValidPasswordHash,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  verifyPassword,
} from "./password.ts";

test("hashPassword выдаёт разбираемый хеш scrypt и не содержит сам пароль", async () => {
  const password = "correct horse battery";
  const hash = await hashPassword(password);
  assert.match(hash, /^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.equal(isValidPasswordHash(hash), true);
  assert.equal(hash.includes(password), false, "хеш не должен содержать пароль");
});

test("соль делает хеши одного пароля разными", async () => {
  const a = await hashPassword("same-password");
  const b = await hashPassword("same-password");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("same-password", a), true);
  assert.equal(await verifyPassword("same-password", b), true);
});

test("verifyPassword принимает верный пароль и отвергает неверный", async () => {
  const hash = await hashPassword("s3cret-pass");
  assert.equal(await verifyPassword("s3cret-pass", hash), true);
  assert.equal(await verifyPassword("s3cret-pass2", hash), false);
});

test("verifyPassword не падает на отсутствующем или испорченном хеше", async () => {
  for (const value of [null, undefined, "", "not-a-hash", "scrypt$1$8$1$AA$BB"]) {
    assert.equal(await verifyPassword("whatever", value), false, `значение ${JSON.stringify(value)}`);
  }
});

test("verifyPassword отвергает подделку и параметры за верхними границами", async () => {
  const hash = await hashPassword("original-pass");
  const parts = hash.split("$");
  const tampered = [...parts.slice(0, 5), parts[5].replace(/^./, parts[5][0] === "A" ? "B" : "A")].join("$");
  assert.equal(await verifyPassword("original-pass", tampered), false, "изменённый хеш не должен приниматься");

  // Огромный N отклоняется парсером, проверка идёт по безопасным параметрам по умолчанию.
  const bomb = `scrypt$1048576$8$1$${parts[4]}$${parts[5]}`;
  assert.equal(isValidPasswordHash(bomb), true, "N на границе MAX_N допустим");
  const over = `scrypt$2097152$8$1$${parts[4]}$${parts[5]}`;
  assert.equal(isValidPasswordHash(over), false, "N выше MAX_N недопустим");
  assert.equal(await verifyPassword("original-pass", over), false);
});

test("assertPasswordAllowed соблюдает границы длины", async () => {
  assert.throws(() => assertPasswordAllowed("short"), (error: unknown) => {
    assert.ok(error instanceof AuthError);
    assert.equal(error.code, "invalid_argument");
    return true;
  });
  assert.throws(() => assertPasswordAllowed(undefined), AuthError);
  assert.throws(() => assertPasswordAllowed("x".repeat(PASSWORD_MAX_LENGTH + 1)), AuthError);

  assert.doesNotThrow(() => assertPasswordAllowed("x".repeat(PASSWORD_MIN_LENGTH)));
  assert.doesNotThrow(() => assertPasswordAllowed("x".repeat(PASSWORD_MAX_LENGTH)));
});
