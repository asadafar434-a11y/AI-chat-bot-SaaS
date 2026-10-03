// EIS Collector v1: unit-тесты ошибок и санитизации секретов. Запуск: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { EisError, errorText, isRetryableStatus, redactSecrets } from "../errors.ts";

test("errors: retryable HTTP-статусы", () => {
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(408), true);
  assert.equal(isRetryableStatus(200), false);
  assert.equal(isRetryableStatus(400), false);
  assert.equal(isRetryableStatus(401), false);
  assert.equal(isRetryableStatus(404), false);
});

test("errors: retryable коды ошибок", () => {
  assert.equal(new EisError("RATE_LIMITED", "rl").retryable, true);
  assert.equal(new EisError("SERVER_ERROR", "se").retryable, true);
  assert.equal(new EisError("TIMEOUT", "t").retryable, true);
  assert.equal(new EisError("AUTH_ERROR", "a").retryable, false);
  assert.equal(new EisError("SOAP_FAULT", "f").retryable, false);
  assert.equal(new EisError("VALIDATION_ERROR", "v").retryable, false);
});

test("errors: токен в SOAP-заголовке маскируется", () => {
  const msg = "<individualPerson_token>5d035886-secret</individualPerson_token> failed";
  const out = redactSecrets(msg);
  assert.ok(!out.includes("5d035886-secret"));
  assert.ok(out.includes("***"));
});

test("errors: секреты в разных формах маскируются", () => {
  assert.ok(!redactSecrets("auth_token: abc123 exploded").includes("abc123"));
  assert.ok(!redactSecrets("download https://host/x?token=tok999&v=1").includes("tok999"));
  assert.ok(!redactSecrets("Authorization: Bearer jwt.token.here").includes("jwt.token.here"));
  assert.ok(!redactSecrets("EIS_PASSWORD=hunter2 rest").includes("hunter2"));
  // Безобидный текст не трогаем.
  assert.equal(redactSecrets("tender 0373100130926000001 stored"), "tender 0373100130926000001 stored");
});

test("errors: errorText санитизирует cause и обычные Error", () => {
  const err = new EisError("NETWORK_ERROR", "boom", { cause: "token=tok999" });
  assert.ok(!errorText(err).includes("tok999"));
  assert.ok(errorText(err).startsWith("[NETWORK_ERROR]"));
  assert.ok(!errorText(new Error("EIS_SECRET_KEY=shhh")).includes("shhh"));
  assert.ok(!errorText("plain EIS_PASSWORD=pw").includes("pw"));
});
