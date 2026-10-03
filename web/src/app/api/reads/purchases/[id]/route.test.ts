// Серверное чтение за флагом: без SERVER_READS=1 эндпоинт тёмный (404) — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "./route.ts";

const context = (id: string) => ({ params: Promise.resolve({ id }) });

test("без флага закупка недоступна", async () => {
  delete process.env.SERVER_READS;
  const res = await GET(new Request("http://localhost/api/reads/purchases/pa"), context("pa"));
  assert.equal(res.status, 404);
});
