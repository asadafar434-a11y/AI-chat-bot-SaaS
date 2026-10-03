/**
 * Модульные проверки import pipeline S3 на in-memory БД.
 *
 * Покрывают сценарии задачи (M): обычный импорт (1), повтор (2), изменённый
 * backup (3), битые записи (4), изоляция организаций (5), конфликт legacyId (6),
 * dry-run (7), прерванный и повторённый импорт (8), сходимость counts/checksums
 * (9), неизвестные поля (10). Откат (N) — здесь же на прерывании: ошибка посреди
 * батча фиксирует `failed`, а повтор доводит работу без дублей; тот же сценарий
 * на настоящей транзакции PostgreSQL — в `integration.test.ts`.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { TransactionRunner } from "../auth/transaction.ts";
import { withRunner } from "../auth/transaction.ts";
import type { DbClient, QueryArgs } from "../db/db-client.ts";
import { orgScope } from "../db/org-scope.ts";
import { orgRepositories } from "../db/repositories/index.ts";
import { PROFILE_KEYS } from "@/lib/profile";
import { createMemoryDb } from "../auth/testing/memory-db.ts";
import { ORG_PROFILE_KEYS, PERSONAL_PROFILE_KEYS } from "./mapping.ts";
import { normalizeBackupStage, parseBackupStage, runLegacyImport, verifyStage } from "./pipeline.ts";
import {
  changedBackupJson,
  edgeBackupJson,
  emptyBackupJson,
  minimalBackupJson,
  standardBackupJson,
} from "./testing/fixtures.ts";

const BACKUP_KEYS = ["purchases", "documents", "samples", "facts", "profiles"] as const;

const ORG_A = "ca00000000000000000001";
const ORG_B = "cb00000000000000000001";
const USER = "cu00000000000000000001";

function makeCtx() {
  const memory = createMemoryDb();
  memory.table("membership").push({ organizationId: ORG_A, userId: USER });
  const db = memory.db;
  return {
    memory,
    db,
    scope: orgScope(ORG_A),
    userId: USER,
    run: withRunner(db),
    input: (raw: string, extra: { batchKey?: string; dryRun?: boolean } = {}) => ({
      db,
      run: withRunner(db) as TransactionRunner,
      scope: orgScope(ORG_A),
      userId: USER,
      raw,
      ...extra,
    }),
  };
}

async function countAll(db: DbClient, scopeOrg: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const name of ["purchase", "document", "sample", "fact", "organizationProfile", "userProfile", "legacyImportBatch"] as const) {
    out[name] = await db[name].count({ where: name === "userProfile" ? {} : { organizationId: scopeOrg } });
  }
  return out;
}

test("разделение профиля покрывает ровно все ключи домена без пересечений", () => {
  const split = new Set([...ORG_PROFILE_KEYS, ...PERSONAL_PROFILE_KEYS]);
  assert.equal(ORG_PROFILE_KEYS.length, 15);
  assert.equal(PERSONAL_PROFILE_KEYS.length, 5);
  assert.deepEqual([...split].sort(), [...PROFILE_KEYS].sort(), "расхождение с PROFILE_KEYS — дрейф контракта");
});

test("M1: обычный backup импортируется, verdict match, mapping точный", async () => {
  const ctx = makeCtx();
  const run = await runLegacyImport(ctx.input(standardBackupJson(), { batchKey: "m1" }));
  const rec = run.reconciliation;

  assert.equal(rec.verdict, "match");
  assert.deepEqual(
    Object.fromEntries(BACKUP_KEYS.map((e) => [e, rec.counts[e]])),
    {
      purchases: { source: 4, target: 4, created: 4, exists: 0, conflicts: 0, unimportable: 0 },
      documents: { source: 4, target: 4, created: 4, exists: 0, conflicts: 0, unimportable: 0 },
      samples: { source: 2, target: 2, created: 2, exists: 0, conflicts: 0, unimportable: 0 },
      facts: { source: 2, target: 2, created: 2, exists: 0, conflicts: 0, unimportable: 0 },
      profiles: { source: 1, target: 2, created: 2, exists: 0, conflicts: 0, unimportable: 0 },
    },
  );
  assert.deepEqual(rec.aggregates.source, {
    tpPriceSum: 1200000,
    // pa — объект ТП; pc — список пунктов, ставший объектом миграцией 1 → 2.
    purchasesWithTp: 2,
    confirmedFacts: 1,
    factsWithTerm: 1,
    purchasesWithUnreadable: 1,
  });
  assert.equal(rec.aggregates.match, true);
  assert.deepEqual(rec.profiles.unknownKeys, ["futureField"]);

  // Точный mapping: версии форматов, статусы, метаданные документов без текстов.
  const purchases = await orgRepositories(ctx.db, ctx.scope).purchase.list();
  const byLegacy = new Map(
    purchases.map((p) => {
      const row = p as unknown as Record<string, unknown>;
      return [row.legacyId as string, row] as const;
    }),
  );
  assert.equal((byLegacy.get("pc") as { originalFormatVersion: number }).originalFormatVersion, 1);
  assert.equal((byLegacy.get("pa") as { originalFormatVersion: number }).originalFormatVersion, 2);
  assert.equal((byLegacy.get("pa") as { status: string }).status, "submitted");
  assert.equal((byLegacy.get("pb") as { status: string }).status, "draft");
  const payload = (byLegacy.get("pa") as { payload: Record<string, unknown> }).payload;
  assert.equal(payload.customField, "неизвестное будущее поле закупки", "M10: неизвестные поля закупки не теряются");
  assert.ok(!("id" in payload) && !("v" in payload), "служебные поля не попадают в payload");
  // Миграция 1 → 2 отработала существующим кодом: список пунктов стал объектом ТП.
  assert.equal(typeof (byLegacy.get("pc") as { payload: Record<string, unknown> }).payload.tp, "object");

  const docs = (await orgRepositories(ctx.db, ctx.scope).document.list()) as Record<string, unknown>[];
  const docByLegacy = new Map(docs.map((d) => [d.legacyId as string, d]));
  assert.equal(docByLegacy.get("pa:0")?.fileName, "ТЗ.pdf");
  assert.equal(docByLegacy.get("pa:0")?.mimeType, "application/pdf");
  assert.equal(docByLegacy.get("pa:0")?.ocr, true);
  assert.equal(docByLegacy.get("pa:1")?.readError, null);
  assert.equal(docByLegacy.get("pd:0")?.readError, "файл повреждён", "readError подтянут из unreadable закупки");
  assert.ok(docs.every((d) => d.storageKey === null && d.textKey === null), "ключей S3 нет — этап S6");

  const samples = (await orgRepositories(ctx.db, ctx.scope).sample.list()) as Record<string, unknown>[];
  assert.deepEqual(samples.find((s) => s.legacyId === "s2")?.kinds, ["other"], "неизвестный вид → other");

  const orgProfile = ctx.memory.table("organizationProfile")[0] as Record<string, unknown>;
  const userProfile = ctx.memory.table("userProfile")[0] as Record<string, unknown>;
  const orgFields = orgProfile.fields as Record<string, string>;
  const userFields = userProfile.fields as Record<string, string>;
  assert.equal(orgFields.fullName, "ООО Ромашка");
  assert.ok(!("head" in orgFields) && !("futureField" in orgFields), "M10: чужое и неизвестное не попадают в организацию");
  assert.equal(userFields.head, "Иванов И. И.");
  assert.ok(!("inn" in userFields), "корпоративное не попадает человеку");
  assert.equal(rec.profiles.orgFields, 2);
  assert.equal(rec.profiles.userFields, 2);

  const batch = ctx.memory.table("legacyImportBatch")[0] as Record<string, unknown>;
  assert.equal(batch.status, "completed");
  assert.equal(batch.backupHash, run.backupHash);
});

test("M2: повторный импорт того же backup безопасен", async () => {
  const ctx = makeCtx();
  const first = await runLegacyImport(ctx.input(standardBackupJson(), { batchKey: "m2a" }));
  const before = await countAll(ctx.db, ORG_A);
  const second = await runLegacyImport(ctx.input(standardBackupJson(), { batchKey: "m2b" }));

  assert.equal(second.resumed, true);
  assert.equal(second.result, null, "записей не выполнялось");
  assert.equal(second.reconciliation.verdict, "already-imported");
  assert.deepEqual(await countAll(ctx.db, ORG_A), before, "повтор ничего не дописал");
  assert.notEqual(first.backupHash, "", "хеш файла зафиксирован");
  assert.equal(second.backupHash, first.backupHash, "тот же файл — тот же хеш");
});

test("M3: изменённый backup имеет другой checksum, расхождение — конфликт без перезаписи", async () => {
  const ctx = makeCtx();
  const first = await runLegacyImport(ctx.input(standardBackupJson(), { batchKey: "m3a" }));
  const second = await runLegacyImport(ctx.input(changedBackupJson(), { batchKey: "m3b" }));

  assert.notEqual(second.backupHash, first.backupHash, "изменённый файл — другой хеш");
  assert.deepEqual(second.plan.entities.find((e) => e.entity === "facts")?.conflictLegacyIds, ["f1"]);
  assert.equal(second.reconciliation.verdict, "mismatch", "расхождение — явная причина, а не успех");
  const rows = (await orgRepositories(ctx.db, ctx.scope).fact.list()) as unknown as {
    legacyId: string;
    title: string;
  }[];
  assert.equal(rows.find((r) => r.legacyId === "f1")?.title, "Лицензия", "существующая запись не перезаписана");
  assert.equal(rows.length, 2, "дублей нет");
});

test("M4: malformed record не ломает batch, потери — в отчёте", async () => {
  const ctx = makeCtx();
  const run = await runLegacyImport(ctx.input(edgeBackupJson(), { batchKey: "m4" }));
  const rec = run.reconciliation;

  assert.equal(rec.verdict, "mismatch", "есть потери — вердикт честный");
  assert.ok(rec.malformed.length >= 5, `ожидались битые записи, получено: ${JSON.stringify(rec.malformed)}`);
  const reasons = new Set(rec.malformed.map((m) => m.reason));
  for (const expected of ["empty-id", "not-object", "missing-id", "bad-docs", "bad-key", "non-object-setting"]) {
    assert.ok(reasons.has(expected), `нет причины ${expected}`);
  }
  assert.equal(rec.counts.purchases.created, 1, "целая закупка pe1 создана");
  assert.equal(rec.counts.documents.created, 1, "целый документ pe1:0 создан");
  assert.ok(
    rec.counts.documents.unimportable >= 2,
    "безымянный документ и сирота не импортируются",
  );
  const batch = ctx.memory.table("legacyImportBatch")[0] as Record<string, unknown>;
  assert.equal(batch.status, "completed", "батч с потерями завершается, а не падает");
});

test("M5: импорт одной организации не попадает в другую; чужак отклоняется", async () => {
  const ctx = makeCtx();
  ctx.memory.table("membership").push({ organizationId: ORG_B, userId: USER });
  const scopeB = orgScope(ORG_B);
  const raw = standardBackupJson();

  await runLegacyImport({ ...ctx.input(raw), batchKey: "m5a" });
  await runLegacyImport({ db: ctx.db, run: ctx.run, scope: scopeB, userId: USER, raw, batchKey: "m5b" });

  const inA = await orgRepositories(ctx.db, ctx.scope).purchase.list();
  const inB = await orgRepositories(ctx.db, scopeB).purchase.list();
  assert.equal(inA.length, 4);
  assert.equal(inB.length, 4);
  assert.ok(inA.every((p) => (p as { organizationId: string }).organizationId === ORG_A));
  assert.ok(inB.every((p) => (p as { organizationId: string }).organizationId === ORG_B));

  await assert.rejects(
    () => runLegacyImport({ db: ctx.db, run: ctx.run, scope: scopeB, userId: "cstranger00000000000001", raw, batchKey: "m5c" }),
    /no-membership/,
    "без членства перенос в организацию запрещён",
  );
});

test("M6: конфликт legacy identity обнаруживается, чужая строка не трогается", async () => {
  const ctx = makeCtx();
  await orgRepositories(ctx.db, ctx.scope).purchase.create({
    legacyId: "pa",
    originalFormatVersion: 2,
    status: "draft",
    payload: { subject: "Чужая версия" },
    createdByUserId: null,
  });

  const run = await runLegacyImport(ctx.input(standardBackupJson(), { batchKey: "m6" }));
  assert.deepEqual(run.plan.entities.find((e) => e.entity === "purchases")?.conflictLegacyIds, ["pa"]);
  assert.equal(run.reconciliation.verdict, "mismatch");
  const rows = (await orgRepositories(ctx.db, ctx.scope).purchase.list()) as unknown as {
    legacyId: string;
    payload: unknown;
  }[];
  assert.equal(rows.filter((r) => r.legacyId === "pa").length, 1, "дубля нет");
  assert.deepEqual(
    rows.find((r) => r.legacyId === "pa")?.payload,
    { subject: "Чужая версия" },
    "чужая строка не перезаписана",
  );
});

test("M7: dry-run ничего не меняет", async () => {
  const ctx = makeCtx();
  const run = await runLegacyImport(ctx.input(standardBackupJson(), { batchKey: "m7", dryRun: true }));

  assert.equal(run.dryRun, true);
  assert.equal(run.result, null);
  assert.equal(run.reconciliation.verdict, "dry-run");
  const plan = run.plan.entities;
  assert.equal(plan.find((e) => e.entity === "purchases")?.toCreate, 4);
  assert.equal(plan.find((e) => e.entity === "documents")?.toCreate, 4);
  assert.ok(plan.find((e) => e.entity === "profiles")?.toCreate === 1, "профиль виден в плане");
  assert.deepEqual(plan.flatMap((e) => e.entity), [...BACKUP_KEYS], "затронуты все сущности");
  assert.deepEqual(await countAll(ctx.db, ORG_A), {
    purchase: 0,
    document: 0,
    sample: 0,
    fact: 0,
    organizationProfile: 0,
    userProfile: 0,
    legacyImportBatch: 0,
  }, "ни одной записи, включая строку батча");
});

test("M8+N: прерванный импорт фиксирует failed и безопасно доводится повтором", async () => {
  const ctx = makeCtx();
  let calls = 0;
  const flaky: TransactionRunner = <T>(fn: (db: DbClient) => Promise<T>): Promise<T> =>
    ctx.run(async (db) => {
      calls += 1;
      if (calls === 1) {
        let creates = 0;
        const faulty = {
          ...db,
          purchase: {
            ...db.purchase,
            create: async (args: QueryArgs) => {
              creates += 1;
              if (creates >= 2) {
                throw new Error("injected fault");
              }
              return db.purchase.create(args);
            },
          },
        };
        return fn(faulty as DbClient);
      }
      return fn(db);
    });

  await assert.rejects(
    () => runLegacyImport({ ...ctx.input(standardBackupJson(), { batchKey: "m8" }), run: flaky }),
    /injected fault/,
    "ошибка посреди батча пробрасывается",
  );
  const batch = ctx.memory.table("legacyImportBatch")[0] as Record<string, unknown>;
  assert.equal(batch.status, "failed", "прерванный батч помечен failed");

  const resumed = await runLegacyImport(ctx.input(standardBackupJson(), { batchKey: "m8" }));
  assert.equal(resumed.resumed, true, "повтор продолжает тот же батч");
  assert.equal(resumed.reconciliation.verdict, "match");
  const purchases = await orgRepositories(ctx.db, ctx.scope).purchase.list();
  assert.equal(purchases.length, 4, "ни потерь, ни дублей");
  const done = ctx.memory.table("legacyImportBatch")[0] as Record<string, unknown>;
  assert.equal(done.status, "completed");
});

test("M9: counts/checksums source == target после импорта", async () => {
  const ctx = makeCtx();
  await runLegacyImport(ctx.input(standardBackupJson(), { batchKey: "m9" }));
  const normalized = normalizeBackupStage(parseBackupStage(standardBackupJson()).dump);
  const { verification } = await verifyStage(ctx.db, ctx.scope, normalized, USER);

  for (const v of verification) {
    assert.equal(v.missing.length, 0, `${v.entity}: нет missing`);
    assert.equal(v.duplicates.length, 0, `${v.entity}: нет дублей`);
    assert.equal(v.checksumMatch, true, `${v.entity}: checksum сошёлся`);
    if (v.entity === "profiles") {
      // Одна секция профиля даёт две строки: организацию и человека.
      assert.equal(v.sourceCount, 1, "profiles: источник — одна секция");
      assert.equal(v.targetCount, 2, "profiles: цель — две строки");
    } else {
      assert.equal(v.sourceCount, v.targetCount, `${v.entity}: счётчики равны`);
    }
  }
});

test("пустой backup отклоняется до записей", async () => {
  const ctx = makeCtx();
  await assert.rejects(() => runLegacyImport(ctx.input(emptyBackupJson(), { batchKey: "m0" })), /empty-backup/);
  assert.deepEqual(await countAll(ctx.db, ORG_A), {
    purchase: 0,
    document: 0,
    sample: 0,
    fact: 0,
    organizationProfile: 0,
    userProfile: 0,
    legacyImportBatch: 0,
  });
});

test("минимальная копия из backup-format тестов: голые факты без kind честно не импортируются", async () => {
  const ctx = makeCtx();
  const run = await runLegacyImport(ctx.input(minimalBackupJson(), { batchKey: "mmin" }));
  const rec = run.reconciliation;
  // Заглушки `{ id }` фактов не ложатся в обязательную колонку `kind`: это
  // явная причина расхождения, а не молчаливая потеря.
  assert.equal(rec.verdict, "mismatch");
  assert.equal(rec.counts.purchases.target, 2);
  assert.equal(rec.counts.documents.target, 1);
  assert.equal(rec.counts.samples.target, 1);
  assert.equal(rec.counts.facts.target, 0);
  assert.deepEqual(
    rec.counts.facts.unimportable,
    2,
    "оба факта — в unimportable",
  );
  const reasons = new Set(
    run.plan.entities.find((e) => e.entity === "facts")?.unimportableList.map((u) => u.reason),
  );
  assert.ok(reasons.has("missing-kind"));
  assert.equal(rec.counts.profiles.target, 2, "профиль из минимальной копии создан");
});
