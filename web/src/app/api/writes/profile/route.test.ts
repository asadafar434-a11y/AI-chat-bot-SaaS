// Серверная запись за флагом: без SERVER_WRITES=1 эндпоинт тёмный (404) — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PUT } from "./route.ts";

test("без флага недоступно", async () => {
  delete process.env.SERVER_WRITES;
  const res = await PUT(new Request("http://localhost/x", { method: "PUT" }));
  assert.equal(res.status, 404);
});
