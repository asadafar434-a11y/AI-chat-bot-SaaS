import assert from "node:assert/strict";
import test from "node:test";

import { isSameOrigin, readCookie } from "./request.ts";

function request(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

test("isSameOrigin разрешает отсутствующий Origin и совпадающий источник", () => {
  assert.equal(isSameOrigin(request("https://app.test/api/auth/login")), true);
  assert.equal(
    isSameOrigin(request("https://app.test/api/auth/login", { origin: "https://app.test" })),
    true,
  );
});

test("isSameOrigin отвергает чужой источник и мусор", () => {
  assert.equal(
    isSameOrigin(request("https://app.test/api/auth/login", { origin: "https://evil.test" })),
    false,
  );
  assert.equal(
    isSameOrigin(request("https://app.test/api/auth/login", { origin: "not a url" })),
    false,
  );
});

test("readCookie достаёт значение и декодирует его", () => {
  const header = "a=1; authjs.session-token=abc123; b=2";
  assert.equal(readCookie(header, "authjs.session-token"), "abc123");
  assert.equal(readCookie(header, "missing"), null);
  assert.equal(readCookie(null, "authjs.session-token"), null);
});

test("readCookie разбирает закодированное значение", () => {
  assert.equal(readCookie("token=a%2Fb%2Bc", "token"), "a/b+c");
});
