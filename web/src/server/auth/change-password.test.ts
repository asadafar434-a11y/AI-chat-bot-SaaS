import assert from "node:assert/strict";
import test from "node:test";

import { createOwner } from "./bootstrap.ts";
import { changePassword } from "./change-password.ts";
import { AuthError } from "./errors.ts";
import { acceptInvitation } from "./invitation.ts";
import { authenticateWithPassword } from "./credentials.ts";
import { createSession } from "./session.ts";
import { withRunner } from "./transaction.ts";
import { createMemoryDb } from "./testing/memory-db.ts";

// Пароли тестовые, нигде не используются.
const OLD = "test-old-password-1";
const NEW = "test-new-password-2";
const EMAIL = "owner@example.com";

async function ownerWithTwoSessions() {
  const memory = createMemoryDb();
  const run = withRunner(memory.db);
  const created = await createOwner(run, { email: EMAIL, organizationName: "Тест" });
  await acceptInvitation(run, created.link.token, { password: OLD });
  const here = await createSession(memory.db, { userId: created.userId });
  const elsewhere = await createSession(memory.db, { userId: created.userId });
  const sessionId = (token: string) => memory.table("session").find((row) => row.sessionToken === token)!.id as string;
  return { memory, run, userId: created.userId, here: sessionId(here.token), elsewhere: sessionId(elsewhere.token) };
}

test("смена пароля: по текущему паролю; новый работает, старый — нет; текущий вход остаётся, другие завершаются", async () => {
  const { memory, run, userId, here, elsewhere } = await ownerWithTwoSessions();
  await changePassword(run, { userId, keepSessionId: here, current: OLD, next: NEW });

  assert.equal(await authenticateWithPassword(memory.db, { email: EMAIL, password: OLD }), null);
  assert.ok(await authenticateWithPassword(memory.db, { email: EMAIL, password: NEW }));
  const left = memory.table("session").map((row) => row.id);
  assert.ok(left.includes(here), "текущий вход не выкинут");
  assert.ok(!left.includes(elsewhere), "вход на другом устройстве завершён");
  const event = memory.table("auditEvent").find((row) => row.action === "auth.password_reset");
  assert.ok(event, "смена записана в журнал");
  assert.equal(event.actorUserId, userId);
  assert.equal(JSON.stringify(event).includes(NEW) || JSON.stringify(event).includes(OLD), false, "пароли в журнал не попадают");
});

test("неверный текущий пароль, пустой текущий, тот же пароль и слишком короткий новый — отказ, пароль не меняется", async () => {
  const { memory, run, userId, here } = await ownerWithTwoSessions();
  const bad = [
    { current: "неверный-пароль-1", next: NEW },
    { current: "", next: NEW },
    { current: undefined, next: NEW },
    { current: OLD, next: OLD },
    { current: OLD, next: "коротко" },
    { current: OLD, next: undefined },
  ];
  for (const input of bad) {
    await assert.rejects(changePassword(run, { userId, keepSessionId: here, ...input }), (error) => error instanceof AuthError && error.code === "invalid_argument");
  }
  assert.ok(await authenticateWithPassword(memory.db, { email: EMAIL, password: OLD }), "старый пароль на месте");
  assert.equal(memory.table("session").length, 2, "входы не тронуты");
});

test("чужой или удалённый пользователь пароль сменить не может", async () => {
  const { memory, run, userId, here } = await ownerWithTwoSessions();
  await assert.rejects(changePassword(run, { userId: "u_unknown", keepSessionId: here, current: OLD, next: NEW }), (error) => error instanceof AuthError);
  await memory.db.user.updateMany({ where: { id: userId }, data: { deletedAt: new Date("2026-01-01T00:00:00Z") } });
  await assert.rejects(changePassword(run, { userId, keepSessionId: here, current: OLD, next: NEW }), (error) => error instanceof AuthError);
});

test("без идентификатора текущего входа все входы пользователя завершаются", async () => {
  const { memory, run, userId } = await ownerWithTwoSessions();
  await changePassword(run, { userId, keepSessionId: "", current: OLD, next: NEW });
  assert.equal(memory.table("session").length, 0);
});
