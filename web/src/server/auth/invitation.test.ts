import assert from "node:assert/strict";
import test from "node:test";

import { orgScope } from "../db/org-scope.ts";
import { AuthError } from "./errors.ts";
import { acceptInvitation, createInvitation, revokeInvitation } from "./invitation.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import { hashToken } from "./tokens.ts";
import { withRunner } from "./transaction.ts";
import { createMemoryDb } from "./testing/memory-db.ts";

const ORG = "c00000000000000000001";
const SCOPE = orgScope(ORG);

const NEW_PASSWORD = "new-password-1";

test("createInvitation хранит хеш токена, а не сам токен, и нормализует email", async () => {
  const memory = createMemoryDb();
  const { token, invitation } = await createInvitation(memory.db, SCOPE, {
    email: "  Invitee@Example.COM ",
    role: "member",
    invitedByUserId: "u1",
  });

  const row = memory.table("invitation")[0];
  assert.equal(row.organizationId, ORG);
  assert.equal(row.email, "invitee@example.com");
  assert.equal(row.tokenHash, hashToken(token));
  assert.notEqual(row.tokenHash, token);
  assert.equal(token.length > 0, true);
  assert.equal(invitation.role, "member");
});

test("acceptInvitation создаёт пользователя, членство и профиль", async () => {
  const memory = createMemoryDb();
  const { token } = await createInvitation(memory.db, SCOPE, {
    email: "invitee@example.com",
    role: "member",
    invitedByUserId: "u1",
  });

  const result = await acceptInvitation(withRunner(memory.db), token, { password: NEW_PASSWORD, name: "Новый" });

  assert.equal(result.organizationId, ORG);
  assert.equal(result.role, "member");
  const user = memory.table("user").find((row) => row.id === result.userId);
  assert.ok(user, "пользователь создан");
  assert.equal(user.email, "invitee@example.com");
  assert.equal(await verifyPassword(NEW_PASSWORD, user.passwordHash as string), true);
  assert.equal(memory.table("membership").length, 1);
  assert.equal(memory.table("userProfile").length, 1);
  assert.ok(memory.table("invitation")[0].acceptedAt instanceof Date, "приглашение помечено принятым");
});

test("повторное и неверное принятие отвергаются", async () => {
  const memory = createMemoryDb();
  const { token } = await createInvitation(memory.db, SCOPE, {
    email: "invitee@example.com",
    role: "member",
    invitedByUserId: "u1",
  });

  await acceptInvitation(withRunner(memory.db), token, { password: NEW_PASSWORD });
  await assert.rejects(
    () => acceptInvitation(withRunner(memory.db), token, { password: NEW_PASSWORD }),
    (error: unknown) => {
      assert.ok(error instanceof AuthError);
      assert.equal(error.code, "invalid_invitation");
      return true;
    },
    "одноразовый токен нельзя использовать дважды",
  );

  await assert.rejects(
    () => acceptInvitation(withRunner(memory.db), "not-a-real-token", { password: NEW_PASSWORD }),
    AuthError,
  );
});

test("истёкшее приглашение не принимается", async () => {
  const memory = createMemoryDb();
  const past = new Date("2026-01-01T00:00:00.000Z");
  const { token } = await createInvitation(memory.db, SCOPE, {
    email: "invitee@example.com",
    role: "member",
    invitedByUserId: "u1",
    now: past,
    ttlMs: 1000,
  });

  await assert.rejects(
    () => acceptInvitation(withRunner(memory.db), token, { password: NEW_PASSWORD, now: new Date(past.getTime() + 2000) }),
    (error: unknown) => {
      assert.ok(error instanceof AuthError);
      assert.equal(error.code, "invalid_token");
      return true;
    },
  );
});

test("существующему пользователю приглашение добавляет членство и не меняет пароль", async () => {
  const existingHash = await hashPassword("existing-password");
  const memory = createMemoryDb({
    user: [{ id: "u9", email: "invitee@example.com", name: "Старый", passwordHash: existingHash, deletedAt: null }],
  });
  const { token } = await createInvitation(memory.db, SCOPE, {
    email: "invitee@example.com",
    role: "member",
    invitedByUserId: "u1",
  });

  const result = await acceptInvitation(withRunner(memory.db), token, { password: NEW_PASSWORD, name: "Другое имя" });

  assert.equal(result.userId, "u9");
  const user = memory.table("user")[0];
  assert.equal(user.passwordHash, existingHash, "заданный пароль не перезаписывается");
  assert.equal(user.name, "Старый", "имя не перезаписывается");
  assert.equal(memory.table("membership").length, 1);
});

test("приглашение удалённому аккаунту отвергается", async () => {
  const memory = createMemoryDb({
    user: [{ id: "u9", email: "invitee@example.com", passwordHash: null, deletedAt: new Date() }],
  });
  const { token } = await createInvitation(memory.db, SCOPE, {
    email: "invitee@example.com",
    role: "member",
    invitedByUserId: "u1",
  });

  await assert.rejects(
    () => acceptInvitation(withRunner(memory.db), token, { password: NEW_PASSWORD }),
    (error: unknown) => {
      assert.ok(error instanceof AuthError);
      assert.equal(error.code, "conflict");
      return true;
    },
  );
});

test("revokeInvitation удаляет непринятое приглашение в своём скоупе", async () => {
  const memory = createMemoryDb();
  const { invitation } = await createInvitation(memory.db, SCOPE, {
    email: "invitee@example.com",
    role: "member",
    invitedByUserId: "u1",
  });

  assert.equal(await revokeInvitation(memory.db, SCOPE, invitation.id), 1);
  assert.equal(memory.table("invitation").length, 0);
});
