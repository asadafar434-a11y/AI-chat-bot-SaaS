import assert from "node:assert/strict";
import test from "node:test";

import { assertDbClient, type DbClient } from "../db-client.ts";
import { InvalidArgumentError, MissingOrganizationScopeError, NotFoundInScopeError } from "../errors.ts";
import { orgScope } from "../org-scope.ts";
import {
  appendAuditEvent,
  findImportBatchByKey,
  findMembership,
  findOrganizationById,
  findOrganizationsForUser,
  findUserInOrganization,
  finishImportBatch,
  organizationRepository,
  orgRepositories,
  requireOrganizationAccess,
  startImportBatch,
} from "./index.ts";
import { scopedRepository } from "./scoped.ts";
import { createFakeDb, dataOf, whereOf } from "../testing/fake-db.ts";

const ORG_A = "ckq2h1x9a0b3c4d5e6f7g8";
const ORG_B = "ckq2h1x9a0b3c4d5e6f7h9";

test("созданный фейк проходит проверку состава клиента", () => {
  assertDbClient(createFakeDb());
});

test("проверка состава клиента отвергает объект без делегатов", () => {
  assert.throws(() => assertDbClient({}), TypeError);
  assert.throws(() => assertDbClient(null), TypeError);
});

test("проверка состава клиента перечисляет недостающие методы", () => {
  const broken = createFakeDb() as unknown as Record<string, Record<string, unknown>>;
  delete broken.purchase.updateMany;
  assert.throws(() => assertDbClient(broken), /purchase\.updateMany/);
});

test("каждый чтение в выборке несёт organizationId", async () => {
  const db = createFakeDb();
  const repos = orgRepositories(db, orgScope(ORG_A));

  await repos.purchase.list();
  assert.equal(whereOf(db.firstCall("findMany"))?.organizationId, ORG_A);
});

test("вызываемые условия не могут убрать organizationId", async () => {
  const db = createFakeDb();
  const repos = orgRepositories(db, orgScope(ORG_A));

  // Вызывающий передаёт условие без организации и с чужим значением одновременно.
  await assert.rejects(
    () => repos.purchase.list({ where: { organizationId: ORG_B } }),
    InvalidArgumentError,
  );
});

test("вызываемый orderBy сохраняется, а фильтр добавляется", async () => {
  const db = createFakeDb();
  const repos = orgRepositories(db, orgScope(ORG_A));

  await repos.purchase.list({ orderBy: { updatedAt: "desc" }, take: 10 });
  const call = db.firstCall("findMany");
  assert.deepEqual(call?.args?.orderBy, { updatedAt: "desc" });
  assert.equal(call?.args?.take, 10);
  assert.equal(whereOf(call)?.organizationId, ORG_A);
});

test("чтение по идентификатору ограничено организацией", async () => {
  const db = createFakeDb();
  const repos = orgRepositories(db, orgScope(ORG_A));

  await repos.document.getById("doc-1");
  assert.deepEqual(whereOf(db.firstCall("findFirst")), { id: "doc-1", organizationId: ORG_A });
});

test("запись проставляет организацию из скоупа поверх переданной", async () => {
  const db = createFakeDb();
  const repos = orgRepositories(db, orgScope(ORG_A));

  await repos.fact.create({ kind: "contract", organizationId: ORG_B, title: "Договор" });
  const data = dataOf(db.firstCall("create"));
  assert.equal(data?.organizationId, ORG_A);
  assert.equal(data?.kind, "contract");
});

test("изменение идёт одним запросом с фильтром по организации", async () => {
  const db = createFakeDb();
  const repos = orgRepositories(db, orgScope(ORG_A));

  await repos.purchase.update("purchase-1", { status: "submitted" });
  const update = db.calls.find((call) => call.method === "updateMany");
  assert.ok(update, "изменение должно выполняться через updateMany");
  assert.deepEqual(whereOf(update), { id: "purchase-1", organizationId: ORG_A });
  assert.deepEqual(update.args?.data, { status: "submitted" });
});

test("изменение не использует update по одному лишь идентификатору", async () => {
  const db = createFakeDb();
  const repos = orgRepositories(db, orgScope(ORG_A));

  await repos.purchase.update("purchase-1", { status: "submitted" });
  // Условие с organizationId не уникально, поэтому update/delete по нему невозможны.
  assert.equal(db.callsTo("purchase").filter((call) => call.method === "update").length, 0);
});

test("изменение чужой записи не приводит к успеху", async () => {
  const db = createFakeDb();
  db.affected = 0; // БД вернула 0 затронутых строк: запись чужой или отсутствующей.
  const repos = orgRepositories(db, orgScope(ORG_A));

  await assert.rejects(() => repos.purchase.update("purchase-1", { status: "submitted" }), NotFoundInScopeError);
});

test("удаление чужой записи не приводит к успеху", async () => {
  const db = createFakeDb();
  db.affected = 0;
  const repos = orgRepositories(db, orgScope(ORG_A));

  await assert.rejects(() => repos.purchase.remove("purchase-1"), NotFoundInScopeError);
});

test("удаление ограничено организацией", async () => {
  const db = createFakeDb();
  const repos = orgRepositories(db, orgScope(ORG_A));

  const removed = await repos.document.remove("doc-1");
  assert.equal(removed, 1);
  assert.deepEqual(whereOf(db.calls.find((call) => call.method === "deleteMany")), {
    id: "doc-1",
    organizationId: ORG_A,
  });
});

test("generic-репозитории не предлагают мягкого удаления: колонки deletedAt у них нет", () => {
  const repos = orgRepositories(createFakeDb(), orgScope(ORG_A));
  for (const repo of Object.values(repos)) {
    assert.equal(
      "softRemove" in (repo as Record<string, unknown>),
      false,
      `${(repo as { operation: string }).operation}: softRemove не должен существовать без колонки deletedAt`,
    );
  }
});

test("организация исключена из generic-фабрики", () => {
  const repos = orgRepositories(createFakeDb(), orgScope(ORG_A)) as Record<string, unknown>;
  assert.equal("organization" in repos, false);
});

test("подсчёт ограничен организацией", async () => {
  const db = createFakeDb();
  const repos = orgRepositories(db, orgScope(ORG_A));

  await repos.purchase.count();
  assert.equal(whereOf(db.firstCall("count"))?.organizationId, ORG_A);
});

test("репозиторий нельзя создать без скоупа", () => {
  const db = createFakeDb();
  assert.throws(() => scopedRepository(db, "purchase", null as never, "purchase"), MissingOrganizationScopeError);
});

test("репозиторий запоминает организацию при создании", () => {
  const repos = orgRepositories(createFakeDb(), orgScope(ORG_A));
  assert.equal(repos.purchase.organizationId, ORG_A);
  assert.equal(repos.purchase.operation, "purchase");
});

test("чтение организации идёт по точному идентификатору без признака удаления", async () => {
  const db = createFakeDb();
  await findOrganizationById(db, ORG_A);
  assert.deepEqual(whereOf(db.firstCall("findFirst")), { id: ORG_A, deletedAt: null });
});

test("чтение организации отвергает пустой идентификатор", () => {
  const db = createFakeDb();
  assert.throws(() => findOrganizationById(db, ""), InvalidArgumentError);
});

test("список организаций пользователя идёт через членство", async () => {
  const db = createFakeDb();
  await findOrganizationsForUser(db, "user-1");
  const where = whereOf(db.firstCall("findMany")) as Record<string, unknown>;
  assert.deepEqual(where.deletedAt, null);
  assert.deepEqual(where.memberships, { some: { userId: "user-1" } });
});

test("список организаций отвергает пустой идентификатор пользователя", () => {
  const db = createFakeDb();
  assert.throws(() => findOrganizationsForUser(db, ""), InvalidArgumentError);
});

test("чтение пользователя требует членства в этой организации", async () => {
  const db = createFakeDb();
  await findUserInOrganization(db, orgScope(ORG_A), "user-1");
  const where = whereOf(db.firstCall("findFirst")) as Record<string, unknown>;
  assert.equal(where.id, "user-1");
  assert.deepEqual(where.deletedAt, null);
  assert.deepEqual(where.memberships, { some: { organizationId: ORG_A } });
});

test("проверка членства ограничена организацией", async () => {
  const db = createFakeDb();
  db.rows = [{ id: "m-1", organizationId: ORG_A, userId: "user-1", role: "member" }];

  const membership = await findMembership(db, orgScope(ORG_A), "user-1");
  assert.equal(membership?.role, "member");
  assert.deepEqual(whereOf(db.firstCall("findFirst")), { organizationId: ORG_A, userId: "user-1" });
});

test("проверка членства возвращает null при отсутствии членства", async () => {
  const db = createFakeDb();
  db.rows = [];
  assert.equal(await findMembership(db, orgScope(ORG_A), "user-1"), null);
});

test("проверка членства без скоупа — программная ошибка", async () => {
  const db = createFakeDb();
  await assert.rejects(() => findMembership(db, null as never, "user-1"), MissingOrganizationScopeError);
});

test("обязательный доступ отказывает без членства", async () => {
  const db = createFakeDb();
  db.rows = [];
  await assert.rejects(
    () => requireOrganizationAccess(db, orgScope(ORG_A), "user-1"),
    NotFoundInScopeError,
  );
});

test("событие аудита получает организацию из скоупа", async () => {
  const db = createFakeDb();
  await appendAuditEvent(db, orgScope(ORG_A), {
    organizationId: ORG_B,
    action: "purchase.archived",
    entityType: "Purchase",
    entityId: "purchase-1",
  });
  const data = dataOf(db.firstCall("create"));
  assert.equal(data?.organizationId, ORG_A);
  assert.equal(data?.action, "purchase.archived");
});

test("событие аудита без скоупа отвергается", async () => {
  const db = createFakeDb();
  await assert.rejects(() => appendAuditEvent(db, null as never, { action: "x" }), MissingOrganizationScopeError);
});

test("старт пакета импорта проставляет статус и организацию", async () => {
  const db = createFakeDb();
  await startImportBatch(db, orgScope(ORG_A), { batchKey: "batch-1", backupHash: "a".repeat(64) });
  const data = dataOf(db.firstCall("create"));
  assert.equal(data?.organizationId, ORG_A);
  assert.equal(data?.status, "started");
  assert.equal(data?.batchKey, "batch-1");
});

test("завершение пакета импорта ограничено организацией", async () => {
  const db = createFakeDb();
  const count = await finishImportBatch(db, orgScope(ORG_A), "batch-1", { status: "completed" });
  assert.equal(count, 1);
  const call = db.calls.find((entry) => entry.method === "updateMany");
  assert.deepEqual(whereOf(call), { id: "batch-1", organizationId: ORG_A });
  assert.ok((call?.args?.data as Record<string, unknown>).finishedAt instanceof Date);
});

test("завершение чужого пакета импорта отказывает", async () => {
  const db = createFakeDb();
  db.affected = 0;
  await assert.rejects(
    () => finishImportBatch(db, orgScope(ORG_A), "batch-1", { status: "completed" }),
    NotFoundInScopeError,
  );
});

test("поиск пакета импорта по ключу ограничен организацией", async () => {
  const db = createFakeDb();
  await findImportBatchByKey(db, orgScope(ORG_A), "batch-1");
  assert.deepEqual(whereOf(db.firstCall("findFirst")), { batchKey: "batch-1", organizationId: ORG_A });
});

test("один и тот же клиент в разных скоупах обращается к разным организациям", async () => {
  const db: DbClient = createFakeDb();
  await orgRepositories(db, orgScope(ORG_A)).fact.list();
  await orgRepositories(db, orgScope(ORG_B)).fact.list();

  const calls = (db as unknown as ReturnType<typeof createFakeDb>).callsTo("fact");
  assert.equal(calls[0]?.args?.where && (calls[0].args.where as Record<string, unknown>).organizationId, ORG_A);
  assert.equal(calls[1]?.args?.where && (calls[1].args.where as Record<string, unknown>).organizationId, ORG_B);
});

// ── F1: запись нельзя переместить между организациями через обновление ─────────

test("F1: изменение с чужим organizationId отклоняется до обращения к БД", async () => {
  const db = createFakeDb();
  const repos = orgRepositories(db, orgScope(ORG_A));

  await assert.rejects(
    () => repos.purchase.update("purchase-1", { status: "submitted", organizationId: ORG_B }),
    InvalidArgumentError,
  );
  assert.equal(db.calls.length, 0, "отклонённый запрос не должен доходить до БД");
});

test("F1: изменение отклоняется, даже если organizationId совпадает со скоупом", async () => {
  const db = createFakeDb();
  const repos = orgRepositories(db, orgScope(ORG_A));

  // Строгая проверка: поле organizationId в данных обновления всегда означает попытку
  // сменить владельца, молчаливого игнорирования нет.
  await assert.rejects(
    () => repos.purchase.update("purchase-1", { organizationId: ORG_A }),
    InvalidArgumentError,
  );
  assert.equal(db.calls.length, 0);
});

test("F1: завершение импорта не принимает organizationId из внешнего результата", async () => {
  const db = createFakeDb();

  await assert.rejects(
    () => finishImportBatch(db, orgScope(ORG_A), "batch-1", { status: "completed", organizationId: ORG_B }),
    InvalidArgumentError,
  );
  assert.equal(db.calls.length, 0, "отклонённый запрос не должен доходить до БД");
});

// ── F2/F4: отдельный репозиторий организации ──────────────────────────────────

test("F2: список организаций видит только неудалённые и сохраняет параметры", async () => {
  const db = createFakeDb();
  const repo = organizationRepository(db);

  await repo.list({ orderBy: { createdAt: "desc" }, take: 5 });
  const call = db.firstCall("findMany");
  assert.deepEqual(whereOf(call), { deletedAt: null });
  assert.deepEqual(call?.args?.orderBy, { createdAt: "desc" });
  assert.equal(call?.args?.take, 5);
});

test("F2: список организаций не позволяет переопределить фильтр удалённых", async () => {
  const db = createFakeDb();
  const repo = organizationRepository(db);

  await assert.rejects(() => repo.list({ where: { deletedAt: "2020-01-01" } }), InvalidArgumentError);
  assert.equal(db.calls.length, 0);
});

test("F2: чтение организации видит только неудалённую", async () => {
  const db = createFakeDb();
  const repo = organizationRepository(db);

  await repo.getById(ORG_A);
  assert.deepEqual(whereOf(db.firstCall("findFirst")), { id: ORG_A, deletedAt: null });
});

test("F2: создание организации отклоняет поле organizationId", async () => {
  const db = createFakeDb();
  const repo = organizationRepository(db);

  await assert.rejects(() => repo.create({ name: "Новая", organizationId: ORG_A }), InvalidArgumentError);
  assert.equal(db.calls.length, 0);
});

test("F2: изменение организации идёт одним запросом по неудалённой записи", async () => {
  const db = createFakeDb();
  const repo = organizationRepository(db);

  await repo.update(ORG_A, { name: "Переименована" });
  const call = db.calls.find((entry) => entry.method === "updateMany");
  assert.deepEqual(whereOf(call), { id: ORG_A, deletedAt: null });
  assert.deepEqual(call?.args?.data, { name: "Переименована" });
});

test("F2: изменение организации отклоняет поле organizationId", async () => {
  const db = createFakeDb();
  const repo = organizationRepository(db);

  await assert.rejects(() => repo.update(ORG_A, { organizationId: ORG_B }), InvalidArgumentError);
  assert.equal(db.calls.length, 0);
});

test("F2: изменение отсутствующей или удалённой организации отказывает", async () => {
  const db = createFakeDb();
  db.affected = 0;
  const repo = organizationRepository(db);

  await assert.rejects(() => repo.update(ORG_A, { name: "x" }), NotFoundInScopeError);
});

test("F2/F4: мягкое удаление организации помечает только неудалённую запись", async () => {
  const db = createFakeDb();
  const repo = organizationRepository(db);
  const now = new Date("2026-01-02T03:04:05.000Z");

  const count = await repo.softRemove(ORG_A, now);
  assert.equal(count, 1);
  const call = db.calls.find((entry) => entry.method === "updateMany");
  assert.deepEqual(whereOf(call), { id: ORG_A, deletedAt: null });
  assert.deepEqual(call?.args?.data, { deletedAt: now });
});

test("F2: мягкое удаление уже удалённой организации отказывает", async () => {
  const db = createFakeDb();
  db.affected = 0;
  const repo = organizationRepository(db);

  await assert.rejects(
    () => repo.softRemove(ORG_A, new Date("2026-01-02T03:04:05.000Z")),
    NotFoundInScopeError,
  );
});

test("F2: мягкое удаление отклоняет некорректную дату", async () => {
  const db = createFakeDb();
  const repo = organizationRepository(db);

  await assert.rejects(() => repo.softRemove(ORG_A, new Date("not-a-date")), InvalidArgumentError);
  assert.equal(db.calls.length, 0);
});

// ── F5: идентичность и статус пакета импорта задаёт функция ───────────────────

test("F5: старт пакета отклоняет id, статус, организацию и отметки времени", async () => {
  const db = createFakeDb();
  const base = { batchKey: "batch-1", backupHash: "a".repeat(64) };

  for (const forbidden of ["id", "organizationId", "status", "startedAt", "finishedAt"]) {
    await assert.rejects(
      () => startImportBatch(db, orgScope(ORG_A), { ...base, [forbidden]: "x" }),
      InvalidArgumentError,
      `поле ${forbidden} должно отклоняться`,
    );
  }
  assert.equal(db.calls.length, 0, "отклонённые запуски не должны доходить до БД");
});

test("F5: старт пакета требует batchKey и backupHash", async () => {
  const db = createFakeDb();

  await assert.rejects(() => startImportBatch(db, orgScope(ORG_A), { backupHash: "a".repeat(64) }), InvalidArgumentError);
  await assert.rejects(() => startImportBatch(db, orgScope(ORG_A), { batchKey: "" }), InvalidArgumentError);
  await assert.rejects(() => startImportBatch(db, orgScope(ORG_A), { batchKey: "batch-1" }), InvalidArgumentError);
  assert.equal(db.calls.length, 0);
});

test("F5: завершение пакета отклоняет смену идентичности", async () => {
  const db = createFakeDb();
  const base = { status: "completed" };

  for (const forbidden of ["id", "batchKey", "backupHash", "startedAt", "finishedAt"]) {
    await assert.rejects(
      () => finishImportBatch(db, orgScope(ORG_A), "batch-1", { ...base, [forbidden]: "x" }),
      InvalidArgumentError,
      `поле ${forbidden} должно отклоняться`,
    );
  }
  assert.equal(db.calls.length, 0);
});

test("F5: завершение пакета принимает только финальный статус", async () => {
  const db = createFakeDb();

  for (const bad of [undefined, null, "", "started", "running", "COMPLETED", "archived"]) {
    await assert.rejects(
      () => finishImportBatch(db, orgScope(ORG_A), "batch-1", { status: bad }),
      InvalidArgumentError,
      `статус ${JSON.stringify(bad)} должен отклоняться`,
    );
  }
  assert.equal(db.calls.length, 0);
});

test("F5: завершение пакета пропускает только разрешённые поля", async () => {
  const db = createFakeDb();

  await finishImportBatch(db, orgScope(ORG_A), "batch-1", {
    status: "failed",
    counts: { purchase: 3 },
    checksums: { purchase: "b".repeat(64) },
    backupFormatVersion: 1,
    unexpected: "ignored",
  });
  const call = db.calls.find((entry) => entry.method === "updateMany");
  const data = call?.args?.data as Record<string, unknown>;
  assert.equal(data.status, "failed");
  assert.deepEqual(data.counts, { purchase: 3 });
  assert.deepEqual(data.checksums, { purchase: "b".repeat(64) });
  assert.equal(data.backupFormatVersion, 1);
  assert.equal("unexpected" in data, false, "неизвестные поля не должны попадать в запрос");
  assert.ok(data.finishedAt instanceof Date);
});
