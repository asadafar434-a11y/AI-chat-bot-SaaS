// Заголовки безопасности из next.config.ts (аудит, п. 20) — npm test. Что они блокируют в браузере — чужие картинки,
// скрипты, запросы и встраивание во фрейм — проверено вручную в Chromium, здесь — что политика не ослабла.
import assert from "node:assert/strict";
import { test } from "node:test";
import config from "../next.config.ts";

// Заголовки общего правила — для всех адресов сайта.
async function securityHeaders(): Promise<Map<string, string>> {
  const rules = (await config.headers?.()) ?? [];
  const rule = rules.find((r) => r.source === "/:path*");
  assert.ok(rule, "нет общего правила для всех адресов");
  return new Map(rule.headers.map((h) => [h.key.toLowerCase(), h.value]));
}

test("политика содержимого: только свой сайт, без фреймов, без чужих картинок и запросов", async () => {
  const csp = (await securityHeaders()).get("content-security-policy") ?? "";
  const directives = new Map(csp.split(";").map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));
  assert.deepEqual(directives.get("default-src"), ["'self'"]);
  assert.deepEqual(directives.get("connect-src"), ["'self'"]);
  assert.deepEqual(directives.get("img-src"), ["'self'", "blob:", "data:"]);
  assert.deepEqual(directives.get("frame-ancestors"), ["'none'"]);
  assert.deepEqual(directives.get("object-src"), ["'none'"]);
  assert.deepEqual(directives.get("base-uri"), ["'self'"]);
  assert.deepEqual(directives.get("form-action"), ["'self'"]);
  // Ни одного чужого адреса и «*» — ни в одной директиве; eval — только в next dev.
  assert.doesNotMatch(csp, /https?:|\*/);
  assert.doesNotMatch(csp, /unsafe-eval/);
});

test("остальные заголовки и без X-Powered-By", async () => {
  const headers = await securityHeaders();
  assert.equal(headers.get("x-frame-options"), "DENY");
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("referrer-policy"), "same-origin");
  assert.match(headers.get("permissions-policy") ?? "", /camera=\(\), microphone=\(\), geolocation=\(\)/);
  assert.equal(config.poweredByHeader, false);
});
