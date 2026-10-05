// Liveness-проба: отвечает 200 без сессии и без БД — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "./route.ts";

test("liveness: 200 и статус ok, без БД", async () => {
  const res = GET();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status?: string };
  assert.equal(body.status, "ok");
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});
