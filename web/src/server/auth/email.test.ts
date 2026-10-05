import assert from "node:assert/strict";
import test from "node:test";

import { EMAIL_MAX_LENGTH, normalizeEmail, tryNormalizeEmail } from "./email.ts";
import { AuthError } from "./errors.ts";

test("normalizeEmail приводит к нижнему регистру и убирает пробелы", () => {
  assert.equal(normalizeEmail("  User@Example.COM "), "user@example.com");
});

test("normalizeEmail отвергает заведомо непригодные значения", () => {
  for (const value of ["", "   ", "no-at-sign", "a@b", "a@b.", "@example.com", "a b@example.com", 42, undefined]) {
    assert.throws(() => normalizeEmail(value), AuthError, `значение ${JSON.stringify(value)}`);
  }
});

test("normalizeEmail соблюдает верхнюю границу длины", () => {
  const local = "a".repeat(EMAIL_MAX_LENGTH);
  assert.throws(() => normalizeEmail(`${local}@example.com`), AuthError);
});

test("tryNormalizeEmail возвращает null вместо исключения", () => {
  assert.equal(tryNormalizeEmail("bad"), null);
  assert.equal(tryNormalizeEmail(undefined), null);
  assert.equal(tryNormalizeEmail("ok@example.com"), "ok@example.com");
});
