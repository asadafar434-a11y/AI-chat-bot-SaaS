import assert from "node:assert/strict";
import test from "node:test";

import { generateToken, hashToken, INVITATION_TTL_MS, isExpired, PASSWORD_RESET_TTL_MS, sameHash } from "./tokens.ts";

test("generateToken даёт разные токены формата base64url", () => {
  const a = generateToken();
  const b = generateToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.ok(a.length >= 40, "256 бит энтропии в base64url");
});

test("hashToken детерминирован и не совпадает с токеном", () => {
  const token = generateToken();
  const hash = hashToken(token);
  assert.equal(hash, hashToken(token));
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, token, "в хранилище не должен попадать сам токен");
});

test("sameHash сравнивает за постоянное время и различает длину", () => {
  const hash = hashToken("x");
  assert.equal(sameHash(hash, hashToken("x")), true);
  assert.equal(sameHash(hash, hashToken("y")), false);
  assert.equal(sameHash(hash, hash.slice(0, -1)), false);
});

test("isExpired строго на границе", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(isExpired(new Date(now.getTime() + 1), now), false);
  assert.equal(isExpired(new Date(now.getTime()), now), true, "равенство считается истёкшим");
  assert.equal(isExpired(new Date(now.getTime() - 1), now), true);
});

test("TTL приглашения и сброса заданы и разумны", () => {
  assert.equal(INVITATION_TTL_MS > PASSWORD_RESET_TTL_MS, true);
  assert.equal(PASSWORD_RESET_TTL_MS, 60 * 60 * 1000);
});
