import assert from "node:assert/strict";
import test from "node:test";

import { AuthError } from "./errors.ts";
import { acceptInvitation } from "./invitation.ts";
import { createOwner } from "./bootstrap.ts";
import { authenticateWithPassword } from "./credentials.ts";
import { resetPasswordWithToken } from "./password-reset.ts";
import { hashToken } from "./tokens.ts";
import { withRunner } from "./transaction.ts";
import { createMemoryDb } from "./testing/memory-db.ts";

// Пароль тестовый, нигде не используется: проверяем только протокол.
const FIRST = "test-first-password-1";
const SECOND = "test-second-password-2";

test("первый владелец: организация, пользователь без пароля, членство owner и ссылка-приглашение; сам токен нигде не хранится", async () => {
  const memory = createMemoryDb();
  const result = await createOwner(withRunner(memory.db), { email: "  Owner@Example.COM ", organizationName: "  ООО  «Тест»  " });

  assert.equal(result.email, "owner@example.com");
  assert.equal(result.organizationCreated, true);
  assert.equal(result.userCreated, true);
  assert.equal(result.link.kind, "invite");
  assert.equal(memory.table("organization")[0].name, "ООО «Тест»", "пробелы схлопнуты");
  assert.equal(memory.table("user")[0].passwordHash ?? null, null, "пароль не задан: его выберет сам владелец");
  const [membership] = memory.table("membership");
  assert.equal(membership.role, "owner");
  const [invitation] = memory.table("invitation");
  assert.equal(invitation.tokenHash, hashToken(result.link.token));
  assert.notEqual(invitation.tokenHash, result.link.token);
  assert.equal(invitation.role, "owner");
});

test("по ссылке владелец задаёт пароль и входит; организация и членство остаются теми же", async () => {
  const memory = createMemoryDb();
  const created = await createOwner(withRunner(memory.db), { email: "owner@example.com", organizationName: "Тест" });
  const accepted = await acceptInvitation(withRunner(memory.db), created.link.token, { password: FIRST });
  assert.equal(accepted.userId, created.userId);
  assert.equal(accepted.organizationId, created.organizationId);
  assert.equal(accepted.role, "owner");
  assert.equal(memory.table("membership").length, 1, "членство не задвоилось");
  const user = await authenticateWithPassword(memory.db, { email: "owner@example.com", password: FIRST });
  assert.equal(user?.userId, created.userId);
  assert.equal(await authenticateWithPassword(memory.db, { email: "owner@example.com", password: "неверный-пароль-1" }), null);
});

test("повторный запуск до задания пароля: новая ссылка, та же организация", async () => {
  const memory = createMemoryDb();
  const first = await createOwner(withRunner(memory.db), { email: "owner@example.com", organizationName: "Тест" });
  const second = await createOwner(withRunner(memory.db), { email: "owner@example.com", organizationName: "Другое название" });
  assert.equal(second.organizationId, first.organizationId);
  assert.equal(second.organizationCreated, false);
  assert.equal(second.userCreated, false);
  assert.equal(second.link.kind, "invite");
  assert.notEqual(second.link.token, first.link.token);
  assert.equal(memory.table("organization").length, 1);
  assert.equal(memory.table("membership").length, 1);
});

test("повторный запуск, когда пароль уже есть: выдаётся ссылка смены пароля, а не приглашение; старый пароль перестаёт работать после смены", async () => {
  const memory = createMemoryDb();
  const first = await createOwner(withRunner(memory.db), { email: "owner@example.com", organizationName: "Тест" });
  await acceptInvitation(withRunner(memory.db), first.link.token, { password: FIRST });

  const again = await createOwner(withRunner(memory.db), { email: "owner@example.com", organizationName: "Тест" });
  assert.equal(again.link.kind, "reset");
  assert.equal(memory.table("organization").length, 1);
  await resetPasswordWithToken(withRunner(memory.db), again.link.token, SECOND);
  assert.equal(await authenticateWithPassword(memory.db, { email: "owner@example.com", password: FIRST }), null);
  assert.ok(await authenticateWithPassword(memory.db, { email: "owner@example.com", password: SECOND }));
});

test("плохая почта и пустое или слишком длинное название — понятный отказ, в базу ничего не пишется", async () => {
  const memory = createMemoryDb();
  for (const input of [
    { email: "не-почта", organizationName: "Тест" },
    { email: "owner@example.com", organizationName: "   " },
    { email: "owner@example.com", organizationName: "я".repeat(201) },
    { email: "owner@example.com", organizationName: undefined },
  ]) {
    await assert.rejects(createOwner(withRunner(memory.db), input), (error) => error instanceof AuthError);
  }
  assert.equal(memory.table("organization").length + memory.table("user").length + memory.table("invitation").length, 0);
});

test("удалённый аккаунт владельцем не становится", async () => {
  const memory = createMemoryDb();
  await memory.db.user.create({ data: { email: "gone@example.com", deletedAt: new Date("2026-01-01T00:00:00Z") } });
  await assert.rejects(createOwner(withRunner(memory.db), { email: "gone@example.com", organizationName: "Тест" }), (error) => error instanceof AuthError && error.code === "conflict");
});
