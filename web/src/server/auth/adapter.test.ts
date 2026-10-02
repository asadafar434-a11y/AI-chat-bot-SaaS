/**
 * Регрессия S2: сессии мягко удалённых пользователей недействительны на уровне
 * адаптера Auth.js, а не только в доменном `getSessionAndUser`.
 *
 * Поддельная база повторяет поведение `PrismaAdapter.getSessionAndUser` — обычный join
 * сессии с пользователем без проверки `deletedAt`: именно эту дыру закрывает обёртка.
 * Проверяются свойства протокола: активный пользователь проходит (A, E), удалённый —
 * нет и его строка подчищается (B), гонка удаления не роняет чтение (B), неизвестный
 * токен — null (E), остальные методы адаптера проходят транзитом (F).
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Adapter } from "next-auth/adapters";

import { withRevokedSessionsForDeletedUsers } from "./adapter.ts";
import { createMemoryDb } from "./testing/memory-db.ts";
import type { MemoryDb } from "./testing/memory-db.ts";

type SessionRow = { id: string; sessionToken: string; userId: string; expires: Date };
type UserRow = { id: string; email: string; deletedAt: Date | null };

const NOW = new Date("2026-01-01T00:00:00.000Z");

/** Имитация `PrismaAdapter`: join без проверки `deletedAt`. */
function fakeBase(memory: MemoryDb, options: { failDelete?: boolean } = {}): Adapter {
  return {
    async getSessionAndUser(sessionToken: string) {
      const session = (await memory.db.session.findFirst({ where: { sessionToken } })) as SessionRow | null;
      if (!session) {
        return null;
      }
      const user = (await memory.db.user.findFirst({ where: { id: session.userId } })) as UserRow | null;
      if (!user) {
        return null;
      }
      return { session, user };
    },
    async deleteSession(sessionToken: string) {
      if (options.failDelete) {
        throw new Error("строка уже удалена");
      }
      await memory.db.session.deleteMany({ where: { sessionToken } });
    },
  } as unknown as Adapter;
}

function seed(memory: MemoryDb): { token: string } {
  memory.table("user").push({ id: "u1", email: "user@example.com", deletedAt: null });
  memory
    .table("session")
    .push({ id: "s1", sessionToken: "token-1", userId: "u1", expires: new Date(NOW.getTime() + 3600_000) });
  return { token: "token-1" };
}

test("A/E: активный пользователь проходит через обёртку, строка сессии цела", async () => {
  const memory = createMemoryDb();
  const { token } = seed(memory);
  const adapter = withRevokedSessionsForDeletedUsers(fakeBase(memory));

  const result = await adapter.getSessionAndUser?.(token);
  assert.ok(result, "сессия активного пользователя действительна");
  assert.equal(result.user.id, "u1");
  assert.equal(memory.table("session").length, 1, "строка активной сессии не трогается");
});

test("B: мягко удалённый пользователь — null, строка сессии подчинена", async () => {
  const memory = createMemoryDb();
  const { token } = seed(memory);
  const adapter = withRevokedSessionsForDeletedUsers(fakeBase(memory));

  memory.table("user")[0].deletedAt = new Date(NOW.getTime());
  assert.equal(await adapter.getSessionAndUser?.(token), null, "сессия удалённого пользователя недействительна");
  assert.equal(memory.table("session").length, 0, "строка сессии удалённого пользователя удалена");
});

test("B2: параллельное удаление строки не роняет чтение — всё равно null", async () => {
  const memory = createMemoryDb();
  const { token } = seed(memory);
  const adapter = withRevokedSessionsForDeletedUsers(fakeBase(memory, { failDelete: true }));

  memory.table("user")[0].deletedAt = new Date(NOW.getTime());
  assert.equal(await adapter.getSessionAndUser?.(token), null, "авторизация невозможна, даже если подчистить не удалось");
});

test("E: неизвестный токен — null", async () => {
  const memory = createMemoryDb();
  seed(memory);
  const adapter = withRevokedSessionsForDeletedUsers(fakeBase(memory));

  assert.equal(await adapter.getSessionAndUser?.("unknown"), null);
});

test("F: остальные методы адаптера проходят транзитом (выход не регрессирует)", async () => {
  const memory = createMemoryDb();
  const { token } = seed(memory);
  const adapter = withRevokedSessionsForDeletedUsers(fakeBase(memory));

  await adapter.deleteSession?.(token);
  assert.equal(memory.table("session").length, 0, "выход через адаптер удаляет строку");
});

test("база без getSessionAndUser возвращается без изменений", async () => {
  const base = {} as Adapter;
  assert.strictEqual(withRevokedSessionsForDeletedUsers(base), base);
});
