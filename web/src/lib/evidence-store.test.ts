// Хранение базы доказательств: чтение записей в текущем формате и «тот же факт» — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { makeFact } from "./evidence-base.ts";
import { mergeNewFacts, readFact, sameFact } from "./evidence-store.ts";

const NOW = new Date("2026-10-02T10:00:00Z");
const f = (input: Parameters<typeof makeFact>[0], id: string) => makeFact(input, NOW, id);

test("запись из базы читается в текущем виде: недостающее — по умолчанию, вписанное человеком — подтверждено", () => {
  const read = readFact({ id: "a", kind: "license", title: "Лицензия", v: 1 });
  assert.deepEqual(read, {
    id: "a", kind: "license", title: "Лицензия", fields: {}, measures: [], validity: {}, source: { type: "manual" },
    origin: "human", confirmed: true, createdAt: "", updatedAt: "",
  });
  const ai = readFact({ id: "b", kind: "equipment", title: "Зал", origin: "ai", confirmed: false, createdAt: "2026-10-01", updatedAt: "2026-10-02" });
  assert.deepEqual([ai?.origin, ai?.confirmed, ai?.createdAt, ai?.updatedAt], ["ai", false, "2026-10-01", "2026-10-02"]);
  assert.equal(readFact({ id: "c", kind: "equipment", title: "Зал", origin: "ai" })?.confirmed, false, "найденное ИИ без отметки — не подтверждено");
});

test("запись без названия, без номера или с неизвестным видом (от более новой версии) не читается и не ломает список", () => {
  assert.equal(readFact({ kind: "license", title: "Без номера" }), null);
  assert.equal(readFact({ id: "x", kind: "license" }), null);
  assert.equal(readFact({ id: "y", kind: "новый-вид", title: "Что-то" }), null);
  assert.throws(() => readFact({ id: "z", kind: "license", title: "Из будущего", v: 99 }), /более новой версией/);
});

test("тот же факт: по номеру, а без номера — по названию; разные виды — разные факты", () => {
  const a = f({ kind: "license", title: "Лицензия на образовательную деятельность", fields: { number: "Л035-00115" } }, "1");
  assert.equal(sameFact(a, f({ kind: "license", title: "Лицензия (скан)", fields: { number: "л035 00115" } }, "2")), true);
  assert.equal(sameFact(a, f({ kind: "license", title: "Лицензия на образовательную деятельность", fields: { number: "Л035-00999" } }, "3")), false);
  const noNumber = f({ kind: "equipment", title: "Актовый зал" }, "4");
  assert.equal(sameFact(noNumber, f({ kind: "equipment", title: "актовый  зал" }, "5")), true);
  assert.equal(sameFact(noNumber, f({ kind: "license", title: "Актовый зал" }, "6")), false);
  const contract = f({ kind: "experience", title: "Договор", fields: { contractNo: "2026-0342/15" } }, "7");
  assert.equal(sameFact(contract, f({ kind: "experience", title: "Договор с заказчиком", fields: { contractNo: "2026-0342/15" } }, "8")), true);
});

test("найденное ИИ добавляется, только если такого факта нет: повторный разбор не плодит копий, подтверждённое не затирается", () => {
  const mine = f({ kind: "license", title: "Лицензия", fields: { number: "123" } }, "m1");
  const again = f({ kind: "license", title: "Лицензия (из другого файла)", fields: { number: "123" }, origin: "ai" }, "a1");
  const fresh = f({ kind: "certificate", title: "ISO 9001", origin: "ai" }, "a2");
  const dup = f({ kind: "certificate", title: "iso 9001", origin: "ai" }, "a3");
  const merged = mergeNewFacts([mine], [again, fresh, dup]);
  assert.deepEqual(merged.add.map((x) => x.id), ["a2"]);
  assert.equal(merged.skipped, 2);
  assert.deepEqual(mergeNewFacts([], []), { add: [], skipped: 0 });
});
