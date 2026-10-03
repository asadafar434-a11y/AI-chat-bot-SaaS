// Серверное удаление за флагом: без SERVER_WRITES=1 эндпоинт тёмный (404) — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "./route.ts";

test("без флага wipe недоступно", async () => {
  delete process.env.SERVER_WRITES;
  const res = await POST(new Request("http://localhost/api/writes/wipe", { method: "POST" }));
  assert.equal(res.status, 404);
});
