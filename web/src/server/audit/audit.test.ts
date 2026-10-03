/**
 * Модульные проверки audit service S7: валидация входа, закрытая таксономия,
 * sanitization метаданных, append-only поверхность.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createMemoryDb } from "../auth/testing/memory-db.ts";
import { orgScope } from "../db/org-scope.ts";
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  auditEvent,
  isAuditAction,
  isAuditEntityType,
  sanitizeMetadata,
} from "./service.ts";

const ORG = "ca00000000000000000001";
const USER = "cu10000000000000000001";

function ctx() {
  const memory = createMemoryDb();
  const db = memory.db;
  return { memory, db, scope: orgScope(ORG) };
}

test("валидное событие пишется с actor/org/action/entity", async () => {
  const { db, memory, scope } = ctx();
  const row = await auditEvent(db, scope, {
    actorUserId: USER,
    action: "purchase.created",
    entityType: "purchase",
    entityId: "pg-1",
    metadata: { legacyId: "p1" },
  });

  assert.equal(row.organizationId, ORG);
  assert.equal(row.actorUserId, USER);
  assert.equal(row.action, "purchase.created");
  assert.equal(row.entityType, "purchase");
  // createdAt ставит БД (@default(now())); memory-fake default-ов не знает —
  // метку времени проверяет интеграционный тест на PostgreSQL.
  assert.ok(row.createdAt === undefined || row.createdAt instanceof Date);
  assert.equal(memory.table("auditEvent").length, 1);
});

test("организация берётся из скоупа, а не из данных", async () => {
  const { db, memory, scope } = ctx();
  await auditEvent(db, scope, {
    actorUserId: USER,
    action: "purchase.created",
    entityType: "purchase",
    entityId: "pg-1",
    metadata: { organizationId: "cfffffffffffffffffffff" },
  });
  const row = memory.table("auditEvent")[0] as Record<string, unknown>;
  assert.equal(row.organizationId, ORG, "подмена organizationId невозможна");
});

test("таксономия закрыта: неизвестное действие и тип отклоняются", async () => {
  const { db, scope } = ctx();
  assert.ok(isAuditAction("purchase.created"));
  assert.ok(!isAuditAction("purchase.hacked"));
  assert.ok(isAuditEntityType("document"));
  assert.ok(!isAuditEntityType("payment"));
  await assert.rejects(
    () =>
      auditEvent(db, scope, {
        actorUserId: USER,
        action: "purchase.hacked",
        entityType: "purchase",
        entityId: "x",
      } as never),
    /неизвестное действие/,
  );
  await assert.rejects(
    () =>
      auditEvent(db, scope, {
        actorUserId: USER,
        action: "purchase.created",
        entityType: "payment",
        entityId: "x",
      } as never),
    /неизвестный тип сущности/,
  );
  await assert.rejects(
    () => auditEvent(db, scope, { actorUserId: "", action: "purchase.created", entityType: "purchase", entityId: "x" }),
    /actorUserId/,
  );
  await assert.rejects(
    () => auditEvent(db, scope, { actorUserId: USER, action: "purchase.created", entityType: "purchase", entityId: "" }),
    /entityId/,
  );
});

test("sanitization: секреты отклоняются, мусорные типы и перевес — тоже", () => {
  assert.deepEqual(sanitizeMetadata(undefined), null);
  assert.deepEqual(sanitizeMetadata({ legacyId: "p1", count: 2, ok: true, nothing: null }), {
    legacyId: "p1",
    count: 2,
    ok: true,
    nothing: null,
  });
  for (const key of ["password", "PasswordHash", "token", "SESSIONTOKEN", "secret", "apiKey", "cardNumber", "cookie"]) {
    assert.throws(() => sanitizeMetadata({ [key]: "x" }), /запрещённый ключ/, key);
  }
  assert.throws(() => sanitizeMetadata({ nested: { deep: { token: "x" } } }), /запрещённый ключ/);
  assert.throws(() => sanitizeMetadata("строка"), /объектом/);
  assert.throws(() => sanitizeMetadata([1, 2]), /объектом/);
  assert.throws(() => sanitizeMetadata({ fn: (() => 1) as unknown }), /недопустимого типа/);
  assert.throws(() => sanitizeMetadata({ n: Number.NaN }), /не конечно/);
  const wide: Record<string, string> = {};
  for (let i = 0; i < 20; i += 1) {
    wide[`k${i}`] = "x".repeat(300);
  }
  assert.throws(() => sanitizeMetadata(wide), /лимит 4 КБ/);
});

test("таксономия покрывает все реальные mutation paths и ничего лишнего", () => {
  const actions = new Set<string>(AUDIT_ACTIONS);
  for (const expected of [
    "purchase.created",
    "purchase.updated",
    "purchase.deleted",
    "purchase.documents.replaced",
    "sample.created",
    "sample.updated",
    "sample.deleted",
    "fact.created",
    "fact.updated",
    "fact.deleted",
    "profile.updated",
    "document.uploaded",
    "document.downloaded",
    "document.deleted",
    "invitation.created",
    "member.joined",
    "member.role_changed",
    "member.removed",
    "auth.password_reset",
    "document.extracted",
    "storage.reconciled",
  ]) {
    assert.ok(actions.has(expected), `нет события ${expected}`);
  }
  assert.ok(AUDIT_ACTIONS.length <= 24, "таксономия не раздута");
  assert.ok((AUDIT_ENTITY_TYPES as readonly string[]).includes("user"));
});

test("системное событие: actorUserId null допустим, случайный actor не подставляется", async () => {
  const { db, scope } = ctx();
  const row = await auditEvent(db, scope, {
    actorUserId: null,
    action: "storage.reconciled",
    entityType: "organization",
    entityId: ORG,
    metadata: { checked: 0 },
  });
  assert.equal(row.actorUserId, null);
  assert.equal(row.entityType, "organization");
});

test("append-only: application API не обновляет и не удаляет события", () => {
  // Repo-scan в традиции documents-payload.test.ts: у auditEvent нет легальных
  // вызовов update/remove/updateMany/deleteMany вне тестов и миграций.
  const here = dirname(fileURLToPath(import.meta.url));
  const roots = [resolve(here, ".."), resolve(here, "../../app")];
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") {
          walk(full);
        }
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) {
        continue;
      }
      const code = readFileSync(full, "utf8");
      for (const match of code.matchAll(/auditEvent\s*\.\s*(update|updateMany|remove|deleteMany)\s*\(/g)) {
        offenders.push(`${full}: ${match[0]}`);
      }
      if (/db\.auditEvent\s*\.\s*(update|delete)\s*\(/.test(code)) {
        offenders.push(`${full}: прямой update/delete делегата auditEvent`);
      }
    }
  };
  for (const root of roots) {
    walk(root);
  }
  assert.deepEqual(offenders, [], "мутации журнала запрещены");
});
