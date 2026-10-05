import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryDb } from "./testing/memory-db.ts";
import {
  createSession,
  deleteSession,
  deleteSessionsForUser,
  getActiveSession,
  getSessionAndUser,
  SESSION_TTL_MS,
} from "./session.ts";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function withUser() {
  const memory = createMemoryDb({
    user: [{ id: "u1", email: "user@example.com", name: "Пользователь" }],
  });
  return memory;
}

test("createSession сохраняет строку и getActiveSession её читает", async () => {
  const memory = withUser();
  const { token, expires } = await createSession(memory.db, { userId: "u1", now: NOW });

  assert.equal(expires.getTime(), NOW.getTime() + SESSION_TTL_MS, "срок = now + TTL");
  const row = memory.table("session")[0];
  assert.equal(row.sessionToken, token);
  assert.equal(row.userId, "u1");

  const active = await getActiveSession(memory.db, token, NOW);
  assert.deepEqual(active, { sessionId: row.id, userId: "u1", expires });
});

test("getActiveSession отвергает неизвестный токен и пустое значение", async () => {
  const memory = withUser();
  assert.equal(await getActiveSession(memory.db, "unknown", NOW), null);
  assert.equal(await getActiveSession(memory.db, "", NOW), null);
  assert.equal(await getActiveSession(memory.db, null, NOW), null);
});

test("истёкшая сессия не читается", async () => {
  const memory = withUser();
  const { token } = await createSession(memory.db, { userId: "u1", now: NOW, ttlMs: 1000 });
  assert.ok(await getActiveSession(memory.db, token, NOW));
  assert.equal(await getActiveSession(memory.db, token, new Date(NOW.getTime() + 1001)), null);
});

test("getSessionAndUser возвращает пользователя и отзывает сессию удалённого", async () => {
  const memory = withUser();
  const { token } = await createSession(memory.db, { userId: "u1", now: NOW });

  const found = await getSessionAndUser(memory.db, token, NOW);
  assert.equal(found?.user.id, "u1");
  assert.equal(found?.session.userId, "u1");

  memory.table("user")[0].deletedAt = new Date(NOW.getTime());
  const after = await getSessionAndUser(memory.db, token, NOW);
  assert.equal(after, null, "удалённый пользователь не входит");
  assert.equal(memory.table("session").length, 0, "сессия удалённого пользователя отзывается");
});

test("deleteSession и deleteSessionsForUser удаляют строки", async () => {
  const memory = withUser();
  const first = await createSession(memory.db, { userId: "u1", now: NOW });
  const second = await createSession(memory.db, { userId: "u1", now: NOW });

  assert.equal(await deleteSession(memory.db, first.token), 1);
  assert.equal(memory.table("session").length, 1, "вторая сессия осталась");
  assert.equal(await deleteSessionsForUser(memory.db, "u1"), 1);
  assert.equal(memory.table("session").length, 0);
  assert.equal(await deleteSession(memory.db, second.token), 0, "повторное удаление ничего не находит");
});
