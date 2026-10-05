// Readiness-проба: проверяет БД; без доступной БД — 503. Форма ответа стабильна — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "./route.ts";

test("readiness: 200 при доступной БД или 503 при недоступной, форма ответа одна", async () => {
  const res = await GET();
  assert.ok(res.status === 200 || res.status === 503, `статус ${res.status}`);
  const body = (await res.json()) as { status?: string; checks?: { database?: string } };
  assert.ok(body.checks?.database === "ok" || body.checks?.database === "error");
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});
