import assert from "node:assert/strict";
import test from "node:test";

import { authenticateWithPassword } from "./credentials.ts";
import { hashPassword } from "./password.ts";
import { createMemoryDb } from "./testing/memory-db.ts";

async function memoryWithUser(overrides: Record<string, unknown> = {}) {
  const passwordHash = await hashPassword("correct-password");
  const memory = createMemoryDb({
    user: [
      {
        id: "u1",
        email: "user@example.com",
        name: "Пользователь",
        passwordHash,
        ...overrides,
      },
    ],
  });
  return memory;
}

test("верная пара email + пароль даёт идентификатор пользователя", async () => {
  const memory = await memoryWithUser();
  const result = await authenticateWithPassword(memory.db, {
    email: "  User@Example.com ",
    password: "correct-password",
  });
  assert.deepEqual(result, { userId: "u1", email: "user@example.com" });
});

test("неверный пароль, неизвестный email и удалённый аккаунт дают null", async () => {
  const memory = await memoryWithUser();

  assert.equal(await authenticateWithPassword(memory.db, { email: "user@example.com", password: "wrong" }), null);
  assert.equal(await authenticateWithPassword(memory.db, { email: "ghost@example.com", password: "correct-password" }), null);
  assert.equal(await authenticateWithPassword(memory.db, { email: "user@example.com" }), null);
  assert.equal(await authenticateWithPassword(memory.db, { email: "not-an-email", password: "correct-password" }), null);

  memory.table("user")[0].deletedAt = new Date();
  assert.equal(await authenticateWithPassword(memory.db, { email: "user@example.com", password: "correct-password" }), null);
});

test("пользователь без заданного пароля не входит по пустому паролю", async () => {
  const memory = createMemoryDb({
    user: [{ id: "u2", email: "nopass@example.com", name: null, passwordHash: null }],
  });
  assert.equal(await authenticateWithPassword(memory.db, { email: "nopass@example.com", password: "" }), null);
});
