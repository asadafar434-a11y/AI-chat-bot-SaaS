import assert from "node:assert/strict";
import test from "node:test";

import { AuthError, invalidCredentials, unauthenticated } from "./errors.ts";

test("AuthError несёт код и HTTP-статус", () => {
  const cases = [
    ["unauthenticated", 401],
    ["invalid_credentials", 401],
    ["forbidden", 403],
    ["conflict", 409],
    ["invalid_argument", 400],
    ["invalid_invitation", 400],
    ["invalid_token", 400],
  ] as const;

  for (const [code, status] of cases) {
    const error = new AuthError(code, "сообщение");
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    assert.equal(error.name, "AuthError");
    assert.ok(error instanceof Error);
  }
});

test("invalidCredentials не различает пользователя и пароль", () => {
  assert.equal(invalidCredentials().code, "invalid_credentials");
  assert.equal(invalidCredentials().status, 401);
});

test("unauthenticated имеет значение по умолчанию", () => {
  assert.equal(unauthenticated().code, "unauthenticated");
  assert.equal(unauthenticated().status, 401);
});
