// Файловое хранилище за флагом: без STORAGE_ENABLED=1 эндпоинт тёмный (404) — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "./route.ts";

test("без флага загрузка недоступна", async () => {
  delete process.env.STORAGE_ENABLED;
  const res = await POST(new Request("http://localhost/x", { method: "POST" }));
  assert.equal(res.status, 404);
});
