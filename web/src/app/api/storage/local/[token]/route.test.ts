// Локальная раздача существует только для fs-бэкенда — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "./route.ts";

test("без fs-бэкенда локальная раздача недоступна", async () => {
  delete process.env.STORAGE_BACKEND;
  const res = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ token: "x" }) });
  assert.equal(res.status, 404);
});
