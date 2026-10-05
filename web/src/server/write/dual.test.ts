/**
 * Контракт dual-write стабилизации S5: обе стороны подтверждаются, частичный
 * отказ виден явно, ложного успеха нет. Сервер вызывается только после успеха
 * legacy; IndexedDB и PostgreSQL — не одна транзакция, и тип это показывает.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { dualWrite } from "./dual.ts";

test("обе стороны ok — общий успех", async () => {
  const calls: string[] = [];
  const res = await dualWrite({
    legacy: async () => {
      calls.push("legacy");
      return "L";
    },
    server: async () => {
      calls.push("server");
      return "S";
    },
  });

  assert.deepEqual(res, { ok: true, legacy: "L", server: "S" });
  assert.deepEqual(calls, ["legacy", "server"], "порядок: сначала legacy");
});

test("упал legacy — сервер не вызывается", async () => {
  let serverCalls = 0;
  const res = await dualWrite({
    legacy: async () => {
      throw new Error("idb locked");
    },
    server: async () => {
      serverCalls += 1;
      return "S";
    },
  });

  assert.deepEqual(res, { ok: false, legacy: "failed", server: "not-attempted", error: "idb locked" });
  assert.equal(serverCalls, 0);
});

test("упал сервер — явный частичный отказ, а не успех", async () => {
  const res = await dualWrite({
    legacy: async () => "L",
    server: async () => {
      throw new Error("pg unreachable");
    },
  });

  assert.deepEqual(res, { ok: false, legacy: "written", server: "failed", error: "pg unreachable" });
  assert.equal(res.ok, false, "общий успех не сообщается");
});

test("повтор после частичного отказа доводит операцию (идемпотентность вызывающего)", async () => {
  let attempts = 0;
  const server = async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error("timeout");
    }
    return "S";
  };
  const first = await dualWrite({ legacy: async () => "L", server });
  assert.equal(first.ok, false);
  const second = await dualWrite({ legacy: async () => "L", server });
  assert.deepEqual(second, { ok: true, legacy: "L", server: "S" });
});
