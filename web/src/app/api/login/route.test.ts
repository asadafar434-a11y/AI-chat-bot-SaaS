// Вход по паролю: верный — метка входа, неверный — 401, сверх лимита попыток — 429 (аудит, п. 19) — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ACCESS_COOKIE, accessToken } from "../../../lib/access.ts";
import { LOGIN_PER_IP } from "../../../lib/rate-limit.ts";
import { POST } from "./route.ts";

const login = (password: string, ip: string) =>
  POST(
    new Request("http://localhost/api/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ password }),
    })
  );

test("верный пароль — метка входа в cookie, неверный — 401", async () => {
  process.env.ACCESS_PASSWORD = "секрет";
  try {
    const ok = await login(" секрет ", "203.0.113.1");
    assert.equal(ok.status, 204);
    assert.match(ok.headers.get("set-cookie") ?? "", new RegExp(`^${ACCESS_COOKIE}=${await accessToken("секрет")};.*HttpOnly`, "i"));
    const wrong = await login("пароль", "203.0.113.1");
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers.get("set-cookie"), null);
  } finally {
    delete process.env.ACCESS_PASSWORD;
  }
});

test("попыток с одного адреса — не больше лимита, даже с верным паролем; другой адрес не задет", async () => {
  process.env.ACCESS_PASSWORD = "секрет";
  try {
    const ip = "203.0.113.2";
    for (let i = 0; i < LOGIN_PER_IP[0].max; i++) assert.equal((await login("секрет", ip)).status, 204, `попытка ${i + 1}`);
    const over = await login("секрет", ip);
    assert.equal(over.status, 429);
    assert.ok(Number(over.headers.get("retry-after")) > 0);
    assert.match(await over.text(), /^Слишком много попыток входа — попробуйте через \d+ мин\.$/);
    assert.equal(over.headers.get("set-cookie"), null);
    assert.equal((await login("секрет", "203.0.113.3")).status, 204);
  } finally {
    delete process.env.ACCESS_PASSWORD;
  }
});

test("без пароля вход не нужен и не считается", async () => {
  delete process.env.ACCESS_PASSWORD;
  for (let i = 0; i < 20; i++) assert.equal((await login("", "203.0.113.4")).status, 204);
});
