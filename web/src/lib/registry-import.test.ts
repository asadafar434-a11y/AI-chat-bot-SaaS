// Импорт выгрузки реестра: разбор, повторы, изменения между выгрузками, отказ на плохом файле — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FIXTURE_HEADER, PREFACE, asRows, fixtureRow } from "./registry-fixtures.ts";
import { importRegistry } from "./registry-import.ts";
import { createMemoryRegistryStore } from "./registry-store.ts";
import { RegistryError } from "./registry-types.ts";

const run = (store: ReturnType<typeof createMemoryRegistryStore>, sha: string, rows: ReturnType<typeof fixtureRow>[], extra: Partial<Parameters<typeof importRegistry>[1]> = {}) =>
  importRegistry(store, { registryKind: "gisp_rpp_719", fileName: "fixture.xlsx", fileSha256: sha, rows: asRows(PREFACE, rows), now: new Date("2026-10-12T00:00:00Z"), ...extra });

test("выгрузка читается: записи, время выгрузки из первой строки, отчёт со счётчиками", async () => {
  const store = createMemoryRegistryStore();
  const { dataset, report } = await run(store, "a1", [fixtureRow({ number: "00000001" }), fixtureRow({ number: "00000002", name: "Тестовый стол" })]);
  assert.equal(store.records.size, 2);
  assert.equal(report.rowsRead, 2);
  assert.equal(report.recordsAdded, 2);
  assert.equal(dataset.exportedAt, "2026-10-10T22:00:10.000Z", "11.10.2026 01:00:10 по Москве");
  assert.equal(dataset.status, "completed");
  assert.equal(dataset.formatVersion, "gisp-v2");
});

test("реестровый номер остаётся строкой: ведущие нули не теряются", async () => {
  const store = createMemoryRegistryStore();
  await run(store, "a2", [fixtureRow({ number: "00000123" })]);
  assert.ok(store.records.has("gisp_rpp_719\n00000123"));
  assert.equal([...store.records.values()][0].registryNumber, "00000123");
});

test("пять записей с одинаковым названием и разными номерами — пять записей, не одна", async () => {
  const store = createMemoryRegistryStore();
  const rows = [1, 2, 3, 4, 5].map((n) => fixtureRow({ number: `0000010${n}`, name: "Тестовый шкаф для одежды", enterprise: `ТЕСТОВОЕ ПРЕДПРИЯТИЕ №${n}`, inn: `990000000${n}` }));
  const { report } = await run(store, "a3", rows);
  assert.equal(store.records.size, 5);
  assert.equal(report.recordsAdded, 5);
  assert.equal(new Set([...store.records.values()].map((r) => r.inn)).size, 5);
});

test("один номер в двух строках с разными основаниями — одна запись, основания и оба срока сохранены", async () => {
  const store = createMemoryRegistryStore();
  const { report } = await run(store, "a4", [
    fixtureRow({ number: "00000200", added: "2023-05-01", until: "2027-01-22", basisNumber: "ТЕСТ-СТ-1", basisName: "СТ-1" }),
    fixtureRow({ number: "00000200", added: "2026-09-01", until: "2029-10-09", basisNumber: "ТЕСТ-АКТ-2", basisName: "Акт экспертизы ТПП" }),
  ]);
  const record = store.records.get("gisp_rpp_719\n00000200")!;
  assert.equal(store.records.size, 1);
  assert.equal(record.bases.length, 2);
  assert.equal(record.validUntil, "2029-10-09");
  assert.equal(record.validUntilMin, "2027-01-22");
  assert.equal(report.multiRowRecords, 1);
  assert.equal(report.differingValidity, 1, "разные сроки действия у оснований попадают в отчёт");
});

test("тот же номер у другого предприятия не вливается в запись, а попадает в отчёт", async () => {
  const store = createMemoryRegistryStore();
  const { report } = await run(store, "a5", [
    fixtureRow({ number: "00000300", inn: "9900000001", added: "2026-09-01" }),
    fixtureRow({ number: "00000300", inn: "9900000002", enterprise: "ДРУГОЕ ТЕСТОВОЕ ПРЕДПРИЯТИЕ", added: "2026-08-01" }),
  ]);
  assert.equal(store.records.size, 1);
  assert.equal(store.records.get("gisp_rpp_719\n00000300")!.inn, "9900000001");
  assert.equal(report.rowsSkipped, 1);
  assert.match(report.samples[0].reason, /другого предприятия/);
});

test("плохие строки пропускаются с причиной, хорошие загружаются", async () => {
  const store = createMemoryRegistryStore();
  const noInn = fixtureRow({ number: "00000401" });
  noInn[FIXTURE_HEADER.indexOf("ИНН")] = "";
  const noNumber = fixtureRow({ number: "" });
  const { report } = await run(store, "a6", [fixtureRow({ number: "00000400" }), noInn, noNumber, new Array(28).fill(undefined)]);
  assert.equal(store.records.size, 1);
  assert.equal(report.rowsFailed, 2);
  assert.equal(report.rowsSkipped, 1, "пустая строка пропущена без ошибки");
  assert.ok(report.samples.some((s) => /пустой ИНН/.test(s.reason)));
  assert.ok(report.samples.some((s) => /пустой реестровый номер/.test(s.reason)));
});

test("странный формат ИНН, номера и ОКПД2 не отбрасывает строку, а считается в предупреждениях", async () => {
  const store = createMemoryRegistryStore();
  const { report } = await run(store, "a7", [fixtureRow({ number: "AB-77", inn: "12345", okpd2: "xx.yy" })]);
  assert.equal(store.records.size, 1);
  assert.equal(report.warnings["формат_номера"], 1);
  assert.equal(report.warnings["формат_инн"], 1);
  assert.equal(report.warnings["формат_окпд2"], 1);
});

test("в файле нет обязательной колонки — загрузка останавливается до записи, в базе ничего не появляется", async () => {
  const store = createMemoryRegistryStore();
  const header = FIXTURE_HEADER.filter((h) => h !== "Срок действия");
  await assert.rejects(
    importRegistry(store, { registryKind: "gisp_rpp_719", fileName: "x.xlsx", fileSha256: "m1", rows: asRows(PREFACE, [], header) }),
    (error: unknown) => error instanceof RegistryError && error.code === "missing_columns" && error.message.includes("«Срок действия»"),
  );
  assert.equal(store.records.size, 0);
  assert.equal(store.datasets.length, 0, "ни записей, ни выгрузки: файл не принят");
});

test("не выгрузка реестра (нет строки заголовков) — понятная ошибка", async () => {
  const store = createMemoryRegistryStore();
  async function* junk() {
    yield { rowNumber: 1, cells: ["что-то совсем другое"] };
    yield { rowNumber: 2, cells: ["a", "b", "c"] };
  }
  await assert.rejects(importRegistry(store, { registryKind: "gisp_rpp_719", fileName: "x.xlsx", fileSha256: "m2", rows: junk() }), (error: unknown) => error instanceof RegistryError && error.code === "invalid_file");
  assert.equal(store.datasets.length, 0);
});

test("колонки, которых формат не знает, не пропадают молча: они в отчёте", async () => {
  const store = createMemoryRegistryStore();
  const header = [...FIXTURE_HEADER, "Новая колонка 2027"];
  const { report } = await importRegistry(store, { registryKind: "gisp_rpp_719", fileName: "x.xlsx", fileSha256: "m3", rows: asRows(PREFACE, [[...fixtureRow({ number: "00000500" }), "x"]], header) });
  assert.deepEqual(report.unknownColumns, ["Новая колонка 2027"]);
});

test("повторный импорт того же файла ничего не меняет и не плодит записи", async () => {
  const store = createMemoryRegistryStore();
  await run(store, "same", [fixtureRow({ number: "00000600" }), fixtureRow({ number: "00000601" })]);
  const again = await run(store, "same", [fixtureRow({ number: "00000600" }), fixtureRow({ number: "00000601" })]);
  assert.equal(again.report.alreadyImported, true);
  assert.equal(store.records.size, 2);
  assert.equal(store.datasets.length, 1);
  assert.equal(store.changes.length, 0);
});

test("новая выгрузка с теми же данными: записи без изменений, журнал пуст", async () => {
  const store = createMemoryRegistryStore();
  const rows = () => [fixtureRow({ number: "00000700" }), fixtureRow({ number: "00000701" })];
  await run(store, "v1", rows());
  const second = await run(store, "v2", rows());
  assert.equal(second.report.recordsUnchanged, 2);
  assert.equal(second.report.recordsAdded, 0);
  assert.equal(second.report.recordsChanged, 0);
  assert.equal(store.changes.length, 0);
  assert.equal(store.datasets.length, 2);
});

test("между выгрузками меняется характеристика и срок: запись обновляется, в журнале видно было и стало", async () => {
  const store = createMemoryRegistryStore();
  await run(store, "c1", [fixtureRow({ number: "00000800", name: "Тестовый стол 120 см", until: "2027-01-01" })]);
  const second = await run(store, "c2", [fixtureRow({ number: "00000800", name: "Тестовый стол 140 см", until: "2029-01-01" })]);
  assert.equal(second.report.recordsChanged, 1);
  const record = store.records.get("gisp_rpp_719\n00000800")!;
  assert.equal(record.productName, "Тестовый стол 140 см");
  const [change] = store.changes;
  assert.equal(change.kind, "changed");
  assert.equal(change.before?.productName, "Тестовый стол 120 см");
  assert.equal(change.after?.productName, "Тестовый стол 140 см");
  assert.equal(change.after?.validUntil, "2029-01-01");
});

test("запись пропала из новой выгрузки — absent (не удалена); вернулась — снова active, обе перемены в журнале", async () => {
  const store = createMemoryRegistryStore();
  const a = fixtureRow({ number: "00000900" });
  const b = fixtureRow({ number: "00000901" });
  await run(store, "p1", [a, b]);
  const dropped = await run(store, "p2", [a]);
  assert.equal(dropped.report.recordsAbsent, 1);
  assert.equal(store.records.get("gisp_rpp_719\n00000901")!.status, "absent");
  const back = await run(store, "p3", [a, b]);
  assert.equal(back.report.recordsReturned, 1);
  assert.equal(store.records.get("gisp_rpp_719\n00000901")!.status, "active");
  assert.deepEqual(store.changes.map((c) => c.kind), ["absent", "returned"]);
});

test("изменился реестровый номер товара — это другая запись: старая absent, новая добавлена; названия не склеивают", async () => {
  const store = createMemoryRegistryStore();
  await run(store, "n1", [fixtureRow({ number: "00001000", name: "Тестовый диван" })]);
  const next = await run(store, "n2", [fixtureRow({ number: "00001001", name: "Тестовый диван" })]);
  assert.equal(next.report.recordsAdded, 1);
  assert.equal(next.report.recordsAbsent, 1);
  assert.equal(store.records.size, 2);
});

test("обрезанная выгрузка не гасит реестр: пропавшие не помечаются, пока явно не разрешено", async () => {
  const store = createMemoryRegistryStore();
  const all = Array.from({ length: 10 }, (_, i) => fixtureRow({ number: `0000110${i}` }));
  await run(store, "t1", all);
  const cut = await run(store, "t2", all.slice(0, 3));
  assert.equal(cut.report.recordsAbsent, 0);
  assert.match(cut.report.absentSkippedReason ?? "", /неполным/);
  assert.equal([...store.records.values()].filter((r) => r.status === "absent").length, 0);
  const forced = await run(store, "t3", all.slice(0, 3), { allowShrink: true });
  assert.equal(forced.report.recordsAbsent, 7);
});

test("слишком большой файл останавливается, выгрузка помечается неудачной", async () => {
  const store = createMemoryRegistryStore();
  const rows = Array.from({ length: 5 }, (_, i) => fixtureRow({ number: `0000120${i}` }));
  await assert.rejects(run(store, "big", rows, { maxRows: 3 }), (error: unknown) => error instanceof RegistryError && error.code === "too_large");
  assert.equal(store.datasets[0].status, "failed");
  assert.equal(store.records.size, 0, "до записи дело не дошло");
});

test("неудачный импорт можно повторить тем же файлом", async () => {
  const store = createMemoryRegistryStore();
  const rows = () => Array.from({ length: 5 }, (_, i) => fixtureRow({ number: `0000130${i}` }));
  await assert.rejects(run(store, "retry", rows(), { maxRows: 3 }));
  const ok = await run(store, "retry", rows());
  assert.equal(ok.report.alreadyImported, false);
  assert.equal(store.records.size, 5);
  assert.equal(store.datasets.length, 1);
  assert.equal(store.datasets[0].status, "completed");
});

test("значения из файла — только данные: формула и разметка в названии сохраняются как текст", async () => {
  const store = createMemoryRegistryStore();
  await run(store, "inj", [fixtureRow({ number: "00001400", name: "=cmd|' /C calc'!A1 <script>alert(1)</script> '; DROP TABLE \"RegistryRecord\"; --" })]);
  assert.match([...store.records.values()][0].productName, /DROP TABLE/);
});
