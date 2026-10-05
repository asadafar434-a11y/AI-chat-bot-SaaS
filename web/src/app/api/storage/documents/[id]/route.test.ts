// Файловое хранилище за флагом: без STORAGE_ENABLED=1 эндпоинт тёмный (404) — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DELETE } from "./route.ts";

test("без флага удаление недоступно", async () => {
  delete process.env.STORAGE_ENABLED;
  const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), {
    params: Promise.resolve({ id: "x" }),
  });
  assert.equal(res.status, 404);
});
