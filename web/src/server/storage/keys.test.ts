/**
 * Object keys: серверная генерация, неперебираемость, строгий разбор.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { documentObjectKey, parseObjectKey, sampleObjectKey } from "./keys.ts";

test("ключ имеет форму org/{org}/doc/{doc}/{random}", () => {
  const key = documentObjectKey("c00000000000000000001", "c00000000000000000002");
  assert.match(key, /^org\/c00000000000000000001\/doc\/c00000000000000000002\/[0-9a-f]{32}$/);
  assert.ok(!key.includes("..") && !key.includes(" "), "без путей и пробелов");
});

test("ключи уникальны даже для одного документа", () => {
  const a = documentObjectKey("c00000000000000000001", "c00000000000000000002");
  const b = documentObjectKey("c00000000000000000001", "c00000000000000000002");
  assert.notEqual(a, b, "случайный хвост");
});

test("разбор round-trip извлекает tenant и документ", () => {
  const key = documentObjectKey("c00000000000000000001", "c00000000000000000002");
  assert.deepEqual(parseObjectKey(key), {
    kind: "document",
    organizationId: "c00000000000000000001",
    documentId: "c00000000000000000002",
  });
});

test("чужие и битые ключи — unknown", () => {
  const bad = [
    "",
    "org/c1/doc",
    "org/c1/doc/d1",
    "org/c1/doc/d1/r/extra",
    "org/c1/file/d1/abcdef0123456789abcdef0123456789",
    "org/../doc/d1/abcdef0123456789abcdef0123456789",
    "org/c1/doc/d1/nothex!",
    "org/c1/doc/d1/abcdef",
    "http://evil/org/c1/doc/d1/abcdef0123456789abcdef0123456789",
  ];
  for (const key of bad) {
    assert.deepEqual(parseObjectKey(key), { kind: "unknown" }, key || "(пусто)");
  }
});

test("ключ образца имеет форму org/{org}/sample/{sample}/{random} и разбирается обратно", () => {
  const key = sampleObjectKey("c00000000000000000001", "c00000000000000000003");
  assert.match(key, /^org\/c00000000000000000001\/sample\/c00000000000000000003\/[0-9a-f]{32}$/);
  assert.deepEqual(parseObjectKey(key), {
    kind: "sample",
    organizationId: "c00000000000000000001",
    sampleId: "c00000000000000000003",
  });
  assert.throws(() => sampleObjectKey("c1", ""), /некорректный sampleId/);
});

test("пользовательский ввод в генерацию не проходит", () => {
  assert.throws(() => documentObjectKey("../x", "d"), /некорректный organizationId/);
  assert.throws(() => documentObjectKey("c1", ""), /некорректный documentId/);
  assert.throws(() => documentObjectKey("c1", "a/b"), /некорректный documentId/);
});
