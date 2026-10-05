import assert from "node:assert/strict";
import test from "node:test";

import { orgScope } from "../db/org-scope.ts";
import {
  assertNotLastOwner,
  assertOwner,
  changeMemberRole,
  findMembership,
  removeMember,
  requireMembership,
} from "./authorization.ts";
import { AuthError } from "./errors.ts";
import { createMemoryDb } from "./testing/memory-db.ts";

// Идентификаторы организаций обязаны проходить проверку `orgScope` (c + 20..24 символов).
const O1 = "c00000000000000000001";
const O2 = "c00000000000000000002";
const ORG1 = orgScope(O1);
const ORG2 = orgScope(O2);

function memory() {
  return createMemoryDb({
    organization: [{ id: O1 }, { id: O2 }],
    user: [{ id: "u1" }, { id: "u2" }, { id: "u3" }, { id: "u4" }],
    membership: [
      { id: "m1", organizationId: O1, userId: "u1", role: "owner" },
      { id: "m2", organizationId: O1, userId: "u2", role: "member" },
      { id: "m3", organizationId: O2, userId: "u3", role: "owner" },
      { id: "m4", organizationId: O1, userId: "u4", role: "owner" },
    ],
  });
}

test("findMembership находит своё членство и не видит чужую организацию", async () => {
  const { db } = memory();
  assert.equal((await findMembership(db, "u2", O1))?.id, "m2");
  assert.equal(await findMembership(db, "u2", O2), null, "членства в чужой организации нет");
});

test("requireMembership бросает forbidden при отсутствии членства", async () => {
  const { db } = memory();
  await assert.rejects(() => requireMembership(db, "u3", O1), (error: unknown) => {
    assert.ok(error instanceof AuthError);
    assert.equal(error.code, "forbidden");
    assert.equal(error.status, 403);
    return true;
  });
});

test("assertOwner отклоняет member", () => {
  assert.throws(
    () => assertOwner({ id: "m2", organizationId: O1, userId: "u2", role: "member" }),
    AuthError,
  );
  assert.doesNotThrow(() => assertOwner({ id: "m1", organizationId: O1, userId: "u1", role: "owner" }));
});

test("assertNotLastOwner защищает последнего владельца", async () => {
  const { db } = memory();
  // В o2 единственный владелец u3.
  await assert.rejects(() => assertNotLastOwner(db, O2, "u3"), /последнего владельца/);
  // В o1 владельцев двое (u1 и u4) — понижение одного допустимо.
  await assert.doesNotReject(() => assertNotLastOwner(db, O1, "u1"));
  // Member никогда не блокируется этим правилом.
  await assert.doesNotReject(() => assertNotLastOwner(db, O1, "u2"));
});

test("changeMemberRole требует owner-а и меняет роль участника", async () => {
  const { db } = memory();

  await assert.rejects(
    () => changeMemberRole(db, ORG1, { actorUserId: "u2", targetUserId: "u2", role: "owner" }),
    (error: unknown) => {
      assert.ok(error instanceof AuthError);
      assert.equal(error.code, "forbidden");
      return true;
    },
    "member не может раздавать роли",
  );

  const updated = await changeMemberRole(db, ORG1, { actorUserId: "u1", targetUserId: "u2", role: "owner" });
  assert.equal(updated.role, "owner");
  assert.equal((await findMembership(db, "u2", O1))?.role, "owner");
});

test("changeMemberRole не понижает последнего владельца", async () => {
  const { db } = memory();
  await assert.rejects(
    () => changeMemberRole(db, ORG2, { actorUserId: "u3", targetUserId: "u3", role: "member" }),
    (error: unknown) => {
      assert.ok(error instanceof AuthError);
      assert.equal(error.code, "conflict");
      return true;
    },
  );
});

test("removeMember удаляет участника и защищает последнего владельца", async () => {
  const { db } = memory();

  await assert.rejects(() => removeMember(db, ORG2, { actorUserId: "u3", targetUserId: "u3" }), AuthError);

  const removed = await removeMember(db, ORG1, { actorUserId: "u1", targetUserId: "u2" });
  assert.equal(removed, 1);
  assert.equal(await findMembership(db, "u2", O1), null);
});

test("действия ограничены организацией из серверного скоупа", async () => {
  const { db } = memory();
  // u3 — владелец o2, но не o1: в o1 он не может действовать.
  await assert.rejects(
    () => changeMemberRole(db, ORG1, { actorUserId: "u3", targetUserId: "u1", role: "member" }),
    AuthError,
  );
});
