// Серверное чтение за флагом: без SERVER_READS=1 эндпоинт тёмный (404) — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "./route.ts";

test("без флага образцы недоступны", async () => {
  delete process.env.SERVER_READS;
  const res = await GET(new Request("http://localhost/api/reads/samples"));
  assert.equal(res.status, 404);
});
