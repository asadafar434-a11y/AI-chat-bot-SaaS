/**
 * Regression-тест нормативного правила переноса legacy-профиля
 * (`migration-and-rollback.md` §4.1):
 *
 * - корпоративные поля — только в `OrganizationProfile`;
 * - персональные — только в `UserProfile`, принадлежащем импортирующему user;
 * - организация профиля — только target-организация из скоупа;
 * - настройки браузера/устройства и `profile-meta.sources/suggestions` не данные;
 * - `userId`/`organizationId` из данных копии не влияют на владение.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { PROFILE_KEYS } from "@/lib/profile";
import { withRunner } from "../auth/transaction.ts";
import { createMemoryDb } from "../auth/testing/memory-db.ts";
import { orgScope } from "../db/org-scope.ts";
import { runLegacyImport } from "./pipeline.ts";
import { standardBackupJson } from "./testing/fixtures.ts";

const ORG_A = "ca00000000000000000001";
const ORG_B = "cb00000000000000000001";
const U1 = "cu10000000000000000001";
const U2 = "cu20000000000000000002";

function makeCtx() {
  const memory = createMemoryDb();
  memory.table("membership").push({ organizationId: ORG_A, userId: U1 });
  memory.table("membership").push({ organizationId: ORG_A, userId: U2 });
  memory.table("membership").push({ organizationId: ORG_B, userId: U1 });
  const db = memory.db;
  const input = (raw: string, scopeOrg: string, userId: string, batchKey: string) => ({
    db,
    run: withRunner(db),
    scope: orgScope(scopeOrg),
    userId,
    raw,
    batchKey,
  });
  return { memory, db, input };
}

const rawBackup = (settings: unknown): string =>
  JSON.stringify({
    format: "tender-lawyer-backup",
    version: 1,
    savedAt: "2026-09-26T12:00:00.000Z",
    purchases: [{ id: "x" }],
    documents: [],
    settings,
    samples: [],
    facts: [],
  });

test("корпоративное — организации, персональное — человеку, раздел полный", async () => {
  const ctx = makeCtx();
  const run = await runLegacyImport(ctx.input(standardBackupJson(), ORG_A, U1, "pr1"));
  assert.equal(run.reconciliation.verdict, "match");

  const orgRows = ctx.memory.table("organizationProfile") as Record<string, unknown>[];
  const userRows = ctx.memory.table("userProfile") as Record<string, unknown>[];
  assert.equal(orgRows.length, 1);
  assert.equal(userRows.length, 1);
  const orgFields = orgRows[0].fields as Record<string, string>;
  const userFields = userRows[0].fields as Record<string, string>;
  assert.equal(orgFields.fullName, "ООО Ромашка");
  assert.ok(!("head" in orgFields), "персональное не попадает организации");
  assert.ok(!("futureField" in orgFields), "неизвестное не попадает организации");
  assert.equal(userFields.head, "Иванов И. И.");
  assert.ok(!("inn" in userFields), "корпоративное не попадает человеку");
  assert.deepEqual(
    [...Object.keys(orgFields), ...Object.keys(userFields)].sort(),
    [...PROFILE_KEYS].sort(),
    "раздел покрывает ровно все ключи домена",
  );
  assert.equal(userRows[0].userId, U1, "UserProfile принадлежит импортирующему user");
});

test("повтор того же файла другим участником: уже импортировано, чужие персональные данные не копируются", async () => {
  const ctx = makeCtx();
  await runLegacyImport(ctx.input(standardBackupJson(), ORG_A, U1, "pr2a"));
  const second = await runLegacyImport(ctx.input(standardBackupJson(), ORG_A, U2, "pr2b"));

  assert.equal(second.resumed, true, "тот же файл в ту же организацию — уже импортировано");
  assert.equal(second.reconciliation.verdict, "already-imported");
  const userRows = ctx.memory.table("userProfile") as Record<string, unknown>[];
  assert.equal(userRows.length, 1, "копия чужих персональных данных второму участнику не создаётся");
  assert.equal(userRows[0].userId, U1);
});

test("второй участник со своими данными получает свой UserProfile, чужой не трогается", async () => {
  const ctx = makeCtx();
  await runLegacyImport(ctx.input(standardBackupJson(), ORG_A, U1, "pr2c"));
  const before = JSON.parse(JSON.stringify(ctx.memory.table("userProfile"))) as Record<string, unknown>[];

  const parsed = JSON.parse(standardBackupJson()) as { settings: [string, Record<string, string>][] };
  for (const [key, value] of parsed.settings) {
    if (key === "profile") {
      value.phone = "+7 900 000-00-01";
      value.head = "Петров П. П.";
    }
  }
  const second = await runLegacyImport(ctx.input(JSON.stringify(parsed), ORG_A, U2, "pr2d"));

  const userRows = ctx.memory.table("userProfile") as Record<string, unknown>[];
  assert.equal(userRows.length, 2, "у каждого участника своя строка");
  assert.deepEqual(
    userRows.map((r) => r.userId).sort(),
    [U1, U2].sort(),
  );
  assert.equal((userRows.find((r) => r.userId === U2)?.fields as Record<string, string>).phone, "+7 900 000-00-01");
  assert.equal(ctx.memory.table("organizationProfile").length, 1, "профиль организации общий и не дублируется");
  assert.deepEqual(
    userRows.find((r) => r.userId === U1),
    before[0],
    "строка первого участника не перезаписана",
  );
  assert.equal(second.reconciliation.verdict, "match");
});

test("тот же пользователь в другой организации: персональная строка одна, корпоративных две", async () => {
  const ctx = makeCtx();
  await runLegacyImport(ctx.input(standardBackupJson(), ORG_A, U1, "pr3a"));
  await runLegacyImport(ctx.input(standardBackupJson(), ORG_B, U1, "pr3b"));

  assert.equal(ctx.memory.table("userProfile").length, 1, "персональные данные принадлежат человеку, а не организации");
  assert.equal(ctx.memory.table("organizationProfile").length, 2, "у каждой организации свой корпоративный профиль");
});

test("без членства импорт запрещён до первой записи", async () => {
  const ctx = makeCtx();
  await assert.rejects(
    () => runLegacyImport(ctx.input(standardBackupJson(), ORG_B, U2, "pr4")),
    /no-membership/,
    "U2 не состоит в ORG_B",
  );
  for (const table of ["purchase", "organizationProfile", "userProfile", "legacyImportBatch"] as const) {
    assert.equal(ctx.memory.table(table).length, 0, `${table}: записей нет`);
  }
});

test("profile-meta: version + sources/suggestions сохраняются как метаданные, не как поля", async () => {
  const ctx = makeCtx();
  const run = await runLegacyImport(
    ctx.input(
      rawBackup([
        ["profile", { inn: "7700000000" }],
        ["profile-meta", { sources: { inn: "Файл.pdf" }, suggestions: [{ key: "kpp", value: "1", source: "Файл.pdf" }, { what: "x" }] }],
      ]),
      ORG_A,
      U1,
      "pr5",
    ),
  );

  assert.equal(run.reconciliation.verdict, "match");
  const org = ctx.memory.table("organizationProfile")[0] as Record<string, unknown>;
  const user = ctx.memory.table("userProfile")[0] as Record<string, unknown>;
  assert.equal(org.version, 1);
  assert.equal(user.version, 1);
  assert.ok(!JSON.stringify([org.fields, user.fields]).includes("Файл.pdf"), "источники подсказок не попали в поля");
  // S11-R0: метаданные профиля не теряются — сохраняются в `meta` строки организации.
  const meta = org.meta as { sources: Record<string, string>; suggestions: unknown[] };
  assert.equal(meta.sources.inn, "Файл.pdf");
  assert.deepEqual(meta.suggestions, [{ key: "kpp", value: "1", source: "Файл.pdf" }], "битый element отброшен, форма сохранена");
});

test("номер формата записи наследуется в version (правило versionOfRaw)", async () => {
  const { versionOfRaw } = await import("./mapping.ts");
  assert.equal(versionOfRaw({ v: 2 }), 2);
  assert.equal(versionOfRaw({}), 1, "без номера — первый формат");
  assert.equal(versionOfRaw({ v: 0 }), 1);
  assert.equal(versionOfRaw(null), 1);
});

test("настройки браузера/устройства не импортируются", async () => {
  const ctx = makeCtx();
  const run = await runLegacyImport(ctx.input(rawBackup([["theme", { dark: true }]]), ORG_A, U1, "pr6"));

  assert.equal(run.reconciliation.counts.profiles.source, 0, "секции профиля нет");
  assert.equal(ctx.memory.table("organizationProfile").length, 0);
  assert.equal(ctx.memory.table("userProfile").length, 0);
  assert.ok(
    run.reconciliation.malformed.some((m) => m.reason === "unknown-setting"),
    "чужая настройка — в отчёте, а не в базе",
  );
});

test("ключи userId/organizationId в данных не меняют владельца", async () => {
  const ctx = makeCtx();
  const run = await runLegacyImport(
    ctx.input(
      rawBackup([
        ["profile", { inn: "7700000000", userId: U2, organizationId: ORG_B }],
        ["profile-meta", { sources: {}, suggestions: [] }],
      ]),
      ORG_A,
      U1,
      "pr7",
    ),
  );

  assert.equal(run.reconciliation.verdict, "match");
  const userRows = ctx.memory.table("userProfile") as Record<string, unknown>[];
  assert.equal(userRows.length, 1);
  assert.equal(userRows[0].userId, U1, "владелец — параметр вызова, а не данные");
  const orgRows = ctx.memory.table("organizationProfile") as Record<string, unknown>[];
  assert.equal(orgRows.length, 1);
  assert.ok(
    run.reconciliation.profiles.unknownKeys.includes("userId") &&
      run.reconciliation.profiles.unknownKeys.includes("organizationId"),
    "подмена зафиксирована как неизвестные ключи",
  );
});
