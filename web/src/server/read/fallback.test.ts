/**
 * Контракт контролируемого fallback (этап S4): источник всегда явный, смеси
 * источников не бывает, каждое срабатывание логируется без персональных данных.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { withFallback } from "./fallback.ts";

const isEmpty = (list: string[]) => list.length === 0;
const describe = (list: string[]) => ({ count: list.length });

function logger() {
  const lines: string[] = [];
  return { lines, log: (line: string) => void lines.push(line) };
}

test("серверные данные возвращаются без fallback и без логов", async () => {
  const logs = logger();
  let legacyCalls = 0;
  const res = await withFallback({
    server: async () => ["a"],
    legacy: async () => {
      legacyCalls += 1;
      return ["a", "b"];
    },
    isEmpty,
    describe,
    log: logs.log,
  });

  assert.deepEqual(res, { source: "postgres", data: ["a"], note: "postgres" });
  assert.equal(legacyCalls, 0, "legacy не вызывается");
  assert.equal(logs.lines.length, 0, "нечего логировать");
});

test("пустой сервер — явный fallback на legacy с пометкой", async () => {
  const logs = logger();
  const res = await withFallback({
    server: async () => [],
    legacy: async () => ["a"],
    isEmpty,
    describe,
    log: logs.log,
  });

  assert.deepEqual(res, { source: "indexeddb", data: ["a"], note: "postgres-empty" });
  assert.equal(logs.lines.length, 2, "пустота сервера и использование legacy залогированы");
  const events = logs.lines.map((l) => (JSON.parse(l) as { event: string }).event);
  assert.deepEqual(events, ["read-fallback", "read-fallback"]);
});

test("ошибка сервера — fallback, а не падение; смесь не возвращается", async () => {
  const logs = logger();
  const res = await withFallback({
    server: async () => {
      throw new Error("база недоступна");
    },
    legacy: async () => ["a"],
    isEmpty,
    describe,
    log: logs.log,
  });

  assert.deepEqual(res, { source: "indexeddb", data: ["a"], note: "postgres-error" });
  assert.ok(logs.lines.some((l) => l.includes("база недоступна")), "причина залогирована");
  assert.ok(!logs.lines.some((l) => l.includes('"a"')), "значения данных в лог не попадают");
});

test("пусто везде — явное none", async () => {
  const logs = logger();
  const res = await withFallback({
    server: async () => null,
    legacy: async () => null,
    isEmpty: (data: null) => data === null,
    describe: () => ({}),
    log: logs.log,
  });

  assert.deepEqual(res, { source: "none", data: null, note: "both-empty" });
});
