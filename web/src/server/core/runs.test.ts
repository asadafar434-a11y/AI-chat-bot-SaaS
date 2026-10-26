import assert from "node:assert/strict";
import test from "node:test";

import { validFurnitureInput } from "../../lib/core/modules/furniture/fixtures.ts";
import { validMedicalInput } from "../../lib/core/modules/medical/fixtures.ts";
import { validOfficeInput } from "../../lib/core/modules/office-equipment/fixtures.ts";
import { withRunner } from "../auth/transaction.ts";
import { createMemoryDb } from "../auth/testing/memory-db.ts";
import { orgScope } from "../db/org-scope.ts";
import type { WriteContext } from "../write/services.ts";
import { createCoreRun, listCoreRuns } from "./runs.ts";

const ORG_A = "ca00000000000000000001";
const ORG_B = "cb00000000000000000001";
const USER = "cu10000000000000000001";

function makeCtx(org = ORG_A): { memory: ReturnType<typeof createMemoryDb>; ctx: WriteContext } {
  const memory = createMemoryDb();
  memory.table("membership").push({ organizationId: org, userId: USER });
  const db = memory.db;
  return { memory, ctx: { db, run: withRunner(db), scope: orgScope(org), userId: USER } };
}

test("core run: запуск сохраняется с результатом и аудитом", async () => {
  const { memory, ctx } = makeCtx();

  const created = await createCoreRun(ctx, validMedicalInput);

  assert.equal(created.result.outcome, "prepare_application");
  assert.equal(created.replayed, false);
  const rows = memory.table("coreRun");
  assert.equal(rows.length, 1);
  const row = rows[0] as Record<string, unknown>;
  assert.equal(row.organizationId, ORG_A);
  assert.equal(row.createdByUserId, USER);
  assert.equal(row.moduleKey, "medical");
  assert.equal(row.moduleVersion, "0.2.0");
  assert.equal(row.outcome, "prepare_application");
  assert.equal(row.riskScore, 0);
  assert.deepEqual(row.input, validMedicalInput);
  assert.equal((row.result as Record<string, unknown>).outcome, "prepare_application");

  const audits = memory.table("auditEvent");
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.action, "core.run.created");
  assert.equal(audits[0]?.entityType, "core_run");
  assert.equal(audits[0]?.entityId, created.id);
});

test("core run: повтор с тем же Idempotency-Key возвращает тот же запуск", async () => {
  const { ctx, memory } = makeCtx();

  const first = await createCoreRun(ctx, validMedicalInput, "run-1");
  const second = await createCoreRun(ctx, validMedicalInput, "run-1");

  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(second.id, first.id);
  assert.equal(memory.table("coreRun").length, 1);
  assert.equal(memory.table("auditEvent").length, 1);
  assert.equal((memory.table("coreRun")[0] as Record<string, unknown>).idempotencyKey, "run-1");
});

test("core run: разные Idempotency-Key создают разные запуски", async () => {
  const { ctx, memory } = makeCtx();

  const first = await createCoreRun(ctx, validMedicalInput, "run-1");
  const second = await createCoreRun(ctx, validMedicalInput, "run-2");

  assert.notEqual(second.id, first.id);
  assert.equal(memory.table("coreRun").length, 2);
});

test("core run: некорректный Idempotency-Key отклоняется", async () => {
  const { ctx } = makeCtx();

  await assert.rejects(() => createCoreRun(ctx, validMedicalInput, "bad key"), /Idempotency-Key/);
  await assert.rejects(() => createCoreRun(ctx, validMedicalInput, "x".repeat(201)), /Idempotency-Key/);
});

test("core run: неизвестный модуль отклоняется", async () => {
  const { ctx } = makeCtx();

  await assert.rejects(() => createCoreRun(ctx, validMedicalInput, undefined, "unknown"), /неизвестный модуль/);
});

test("core run: офисный и мебельный модули запускаются через тот же сервис", async () => {
  const { ctx, memory } = makeCtx();

  const office = await createCoreRun(ctx, validOfficeInput, undefined, "office-equipment");
  const furniture = await createCoreRun(ctx, validFurnitureInput, undefined, "furniture");

  assert.equal(office.result.moduleKey, "office-equipment");
  assert.equal(office.result.outcome, "prepare_application");
  assert.equal(furniture.result.moduleKey, "furniture");
  assert.equal(furniture.result.outcome, "prepare_application");
  assert.deepEqual(
    memory.table("coreRun").map((row) => (row as Record<string, unknown>).moduleKey),
    ["office-equipment", "furniture"],
  );
});

test("core run: список ограничен организацией", async () => {
  const a = makeCtx(ORG_A);
  const b = makeCtx(ORG_B);
  await createCoreRun(a.ctx, validMedicalInput);

  assert.equal((await listCoreRuns(a.ctx)).length, 1);
  assert.equal((await listCoreRuns(b.ctx)).length, 0);
});

test("core run: без членства запуск запрещён", async () => {
  const { memory } = makeCtx();
  const db = memory.db;
  const ctx: WriteContext = { db, run: withRunner(db), scope: orgScope(ORG_B), userId: USER };

  await assert.rejects(() => createCoreRun(ctx, validMedicalInput), /NotFoundInScope|членств/i);
});

test("core run: organizationId из тела отклоняется", async () => {
  const { ctx } = makeCtx();

  await assert.rejects(
    () => createCoreRun(ctx, { data: {}, organizationId: "cfffffffffffffffffffff" }),
    /некорректный input/,
  );
});

test("core run: слишком большой input отклоняется", async () => {
  const { ctx } = makeCtx();

  await assert.rejects(
    () => createCoreRun(ctx, { data: { big: "x".repeat(600 * 1024) } }),
    /512 КБ/,
  );
});

test("core run: пустой data допустим и даёт needs_input", async () => {
  const { ctx, memory } = makeCtx();

  const created = await createCoreRun(ctx, { data: {} });

  assert.equal(created.result.outcome, "needs_input");
  assert.equal(memory.table("coreRun").length, 1);
});
