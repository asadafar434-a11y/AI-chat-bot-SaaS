import assert from "node:assert/strict";
import test from "node:test";

import { AuthError } from "./errors.ts";
import { createPasswordResetToken, resetPasswordWithToken } from "./password-reset.ts";
import { verifyPassword } from "./password.ts";
import { createSession } from "./session.ts";
import { hashToken } from "./tokens.ts";
import { withRunner } from "./transaction.ts";
import { createMemoryDb } from "./testing/memory-db.ts";

const NEW_PASSWORD = "brand-new-pass";

function memoryWithUser() {
  return createMemoryDb({
    user: [{ id: "u1", email: "user@example.com", name: null, passwordHash: null, deletedAt: null }],
  });
}

test("createPasswordResetToken хранит хеш и не раскрывает существование аккаунта", async () => {
  const memory = memoryWithUser();

  const issued = await createPasswordResetToken(memory.db, "  User@Example.com ");
  assert.ok(issued, "для существующего пользователя токен выдаётся");
  const row = memory.table("verificationToken")[0];
  assert.equal(row.identifier, "user@example.com");
  assert.equal(row.token, hashToken(issued.token));
  assert.notEqual(row.token, issued.token, "в хранилище не должен попадать сам токен");

  assert.equal(await createPasswordResetToken(memory.db, "ghost@example.com"), null);
  assert.equal(await createPasswordResetToken(memory.db, "not-an-email"), null);

  memory.table("user")[0].deletedAt = new Date();
  assert.equal(await createPasswordResetToken(memory.db, "user@example.com"), null, "удалённому аккаунту токен не выдаётся");
});

test("resetPasswordWithToken меняет пароль и завершает все сессии", async () => {
  const memory = memoryWithUser();
  await createSession(memory.db, { userId: "u1" });
  await createSession(memory.db, { userId: "u1" });
  assert.equal(memory.table("session").length, 2);

  const issued = await createPasswordResetToken(memory.db, "user@example.com");
  assert.ok(issued);
  const result = await resetPasswordWithToken(withRunner(memory.db), issued.token, NEW_PASSWORD);

  assert.equal(result.userId, "u1");
  assert.equal(await verifyPassword(NEW_PASSWORD, memory.table("user")[0].passwordHash as string), true);
  assert.equal(memory.table("session").length, 0, "старые сессии отозваны");
  assert.equal(memory.table("verificationToken").length, 0, "токен одноразовый");
});

test("токен сброса одноразовый и не принимает мусор", async () => {
  const memory = memoryWithUser();
  const issued = await createPasswordResetToken(memory.db, "user@example.com");
  assert.ok(issued);

  await resetPasswordWithToken(withRunner(memory.db), issued.token, NEW_PASSWORD);
  await assert.rejects(
    () => resetPasswordWithToken(withRunner(memory.db), issued.token, NEW_PASSWORD),
    (error: unknown) => {
      assert.ok(error instanceof AuthError);
      assert.equal(error.code, "invalid_token");
      return true;
    },
    "токен нельзя использовать дважды",
  );

  await assert.rejects(
    () => resetPasswordWithToken(withRunner(memory.db), "unknown-token", NEW_PASSWORD),
    AuthError,
  );
});

test("истёкший токен не принимается", async () => {
  const memory = memoryWithUser();
  const past = new Date("2026-01-01T00:00:00.000Z");
  const issued = await createPasswordResetToken(memory.db, "user@example.com", { now: past, ttlMs: 1000 });
  assert.ok(issued);

  await assert.rejects(
    () => resetPasswordWithToken(withRunner(memory.db), issued.token, NEW_PASSWORD, { now: new Date(past.getTime() + 2000) }),
    (error: unknown) => {
      assert.ok(error instanceof AuthError);
      assert.equal(error.code, "invalid_token");
      return true;
    },
  );
});

test("resetPasswordWithToken проверяет новый пароль до транзакции", async () => {
  const memory = memoryWithUser();
  await assert.rejects(() => resetPasswordWithToken(withRunner(memory.db), "any", "short"), AuthError);
  await assert.rejects(() => resetPasswordWithToken(withRunner(memory.db), "any", undefined), AuthError);
});
