// Вход по паролю и согласие перед работой — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { accessToken, closedWithoutPassword, sameToken } from "./access.ts";
import { CONSENT_KEY, forgetSessionConsent, hasConsent, readConsent, saveConsent } from "./consent.ts";
import { LEGAL_EDITION } from "./legal.ts";

test("без пароля на хостинге запросы к серверу закрыты, на своём компьютере — открыты", () => {
  assert.equal(closedWithoutPassword({ NODE_ENV: "production" }), true);
  assert.equal(closedWithoutPassword({ NODE_ENV: "production", OPEN_ACCESS: "1" }), false);
  assert.equal(closedWithoutPassword({ NODE_ENV: "development" }), false);
  assert.equal(closedWithoutPassword({ NODE_ENV: "production", OPEN_ACCESS: "yes" }), true);
});

test("метка входа зависит от пароля, сравнение без утечки длины", async () => {
  const a = await accessToken("длинный-пароль-1");
  assert.equal(a, await accessToken("длинный-пароль-1"));
  assert.notEqual(a, await accessToken("длинный-пароль-2"));
  assert.ok(sameToken(a, a));
  assert.equal(sameToken(a, a.slice(0, -1) + (a.endsWith("0") ? "1" : "0")), false);
  assert.equal(sameToken(a, a.slice(1)), false);
});

// Хранилище браузера — заглушкой.
function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

test("согласие: нет — спросим; дали — помним; новая редакция — спросим заново", () => {
  forgetSessionConsent();
  const store = memory();
  assert.equal(hasConsent(store), false);
  const record = saveConsent(store, new Date("2026-09-26T10:00:00Z"));
  assert.deepEqual(readConsent(store), record);
  assert.equal(record.edition, LEGAL_EDITION);
  forgetSessionConsent();
  assert.equal(hasConsent(store), true);

  store.setItem(CONSENT_KEY, JSON.stringify({ ...record, edition: "1 января 2020 г." }));
  assert.equal(hasConsent(store), false);
  store.setItem(CONSENT_KEY, JSON.stringify({ ...record, transfer: false }));
  assert.equal(hasConsent(store), false);
  store.setItem(CONSENT_KEY, "не JSON");
  assert.equal(readConsent(store), null);
});

test("хранилище недоступно — согласие действует до перезагрузки", () => {
  forgetSessionConsent();
  const broken = {
    getItem: () => {
      throw new Error("запрещено");
    },
    setItem: () => {
      throw new Error("запрещено");
    },
  };
  assert.equal(hasConsent(broken), false);
  saveConsent(broken);
  assert.equal(hasConsent(broken), true);
  forgetSessionConsent();
});
