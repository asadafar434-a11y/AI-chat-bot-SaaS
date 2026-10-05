// Файловое хранилище за флагом: без STORAGE_ENABLED=1 эндпоинт тёмный (404) — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "./route.ts";

test("без флага выдача ссылок недоступна", async () => {
  delete process.env.STORAGE_ENABLED;
  const res = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: "x" }) });
  assert.equal(res.status, 404);
});
