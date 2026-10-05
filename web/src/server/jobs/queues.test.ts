import assert from "node:assert/strict";
import test from "node:test";

import {
  getQueueDefinition,
  isRetryable,
  PermanentJobError,
  QUEUE_NAMES,
  QUEUE_REGISTRY,
  RetryableJobError,
  validatePayload,
} from "./queues.ts";

test("реестр содержит ровно реальные очереди, без universal default", () => {
  assert.deepEqual([...QUEUE_NAMES].sort(), ["document.extract", "storage.reconcile"]);
  assert.equal(QUEUE_NAMES.includes("default" as never), false);
  assert.equal(Object.keys(QUEUE_REGISTRY).length, QUEUE_NAMES.length);
});

test("у каждой очереди заданы schema, retry, timeout, concurrency, idempotency", () => {
  for (const name of QUEUE_NAMES) {
    const def = getQueueDefinition(name);
    assert.equal(def.name, name);
    assert.ok(def.payloadSchema, `${name}: schema`);
    assert.ok(def.retryPolicy.maxRetries >= 0, `${name}: retry`);
    assert.ok(def.retryPolicy.backoffSeconds >= 0, `${name}: backoff`);
    assert.ok(def.retryPolicy.backoffMaxSeconds >= def.retryPolicy.backoffSeconds, `${name}: backoffMax`);
    assert.ok(def.timeoutSeconds > 0, `${name}: timeout`);
    assert.ok(def.concurrency >= 1, `${name}: concurrency`);
    assert.ok(def.pollIntervalMs >= 0, `${name}: pollInterval`);
    assert.ok(def.idempotency.length > 0, `${name}: idempotency`);
  }
});

test("validatePayload принимает корректные payload", () => {
  const rec = validatePayload("storage.reconcile", {
    organizationId: "c00000000000000000001",
    requestId: "req-1",
    operationVersion: 1,
  });
  assert.equal(rec.ok, true);

  const ext = validatePayload("document.extract", {
    documentId: "doc-1",
    organizationId: "c00000000000000000001",
    operationVersion: 1,
  });
  assert.equal(ext.ok, true);
});

test("validatePayload отклоняет лишние/недостающие/неверные поля", () => {
  assert.equal(validatePayload("storage.reconcile", {}).ok, false);
  assert.equal(
    validatePayload("storage.reconcile", {
      organizationId: "c1",
      requestId: "r1",
      operationVersion: 2,
    }).ok,
    false,
    "другая версия операции",
  );
  // Лишнее поле — попытка протащить секрет/чужой scope мимо серверного контракта.
  const extra = validatePayload("document.extract", {
    documentId: "d1",
    organizationId: "c1",
    operationVersion: 1,
    signedUrl: "https://evil",
  });
  assert.equal(extra.ok, false);
  if (!extra.ok) {
    assert.match(extra.error, /signedUrl/);
  }
  assert.equal(validatePayload("document.extract", null).ok, false);
  assert.equal(validatePayload("document.extract", "строка").ok, false);
});

test("классификация ошибок: permanent не повторяется, остальное — да", () => {
  assert.equal(isRetryable(new PermanentJobError("unsupported", "формат")), false);
  assert.equal(isRetryable(new RetryableJobError("network", "таймаут")), true);
  assert.equal(isRetryable(new Error("неожиданная")), true);
});
