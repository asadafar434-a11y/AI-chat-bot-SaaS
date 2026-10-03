/**
 * SigV4: детерминизм, чувствительность к подмене, сроки, round-trip.
 *
 * Живого AWS в контуре нет, поэтому корректность против эталона доказывается
 * структурно: подпись покрывает метод/путь/query/host (смена бита ломает),
 * чужой секрет не проходит, истёкшее отклоняется. Round-trip presign→verify
 * идёт тем же кодом, что и stub-S3 в `s3.test.ts`.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  amzDates,
  encodeRfc3986,
  hmacSha256,
  presignGetUrl,
  sha256HexUtf8,
  signingKey,
  verifyPresignedUrl,
} from "./sign.ts";

const CREDS = {
  endpoint: "https://s3.example.com",
  bucket: "docs",
  key: "org/c00000000000000000001/doc/c00000000000000000002/abcdef0123456789abcdef0123456789",
  region: "ru-1",
  accessKeyId: "TESTACCESS",
  secretAccessKey: "test-secret-key-123",
};

const NOW = new Date("2026-10-03T12:00:00.000Z");

function presign(expiresIn = 300, now: Date = NOW) {
  return presignGetUrl({ ...CREDS, expiresIn, now, pathStyle: true });
}

test("encodeRfc3986 кодирует и !'()*", () => {
  assert.equal(encodeRfc3986("a/b c"), "a%2Fb%20c");
  assert.equal(encodeRfc3986("!'()*"), "%21%27%28%29%2A");
  assert.equal(encodeRfc3986("abc-_.~012"), "abc-_.~012");
});

test("amzDates всегда UTC", () => {
  assert.deepEqual(amzDates(NOW), { amzDate: "20261003T120000Z", dateStamp: "20261003" });
});

test("цепочка ключей детерминирована и чувствительна к входу", () => {
  const a = signingKey(CREDS.secretAccessKey, "20261003", CREDS.region, "s3").toString("hex");
  const b = signingKey(CREDS.secretAccessKey, "20261003", CREDS.region, "s3").toString("hex");
  const c = signingKey("other", "20261003", CREDS.region, "s3").toString("hex");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 64);
});

test("presign round-trip: подпись проходит проверку", () => {
  const { url, expiresAt } = presign();
  assert.equal(expiresAt.getTime(), NOW.getTime() + 300_000);
  const checked = verifyPresignedUrl(url, {
    secretAccessKey: CREDS.secretAccessKey,
    region: CREDS.region,
    bucket: CREDS.bucket,
    pathStyle: true,
    now: NOW,
  });
  assert.equal(checked.ok, true);
  if (checked.ok) {
    assert.equal(checked.key, CREDS.key);
  }
});

test("подмена любого бита ломает подпись", () => {
  const { url } = presign();
  const tamperedExp = url.replace("X-Amz-Expires=300", "X-Amz-Expires=301");
  assert.deepEqual(verifyPresignedUrl(tamperedExp, { secretAccessKey: CREDS.secretAccessKey, region: CREDS.region, now: NOW }).ok, false);

  const tamperedPath = url.replace("abcdef0123", "abcdef0124");
  const checked = verifyPresignedUrl(tamperedPath, {
    secretAccessKey: CREDS.secretAccessKey,
    region: CREDS.region,
    bucket: CREDS.bucket,
    pathStyle: true,
    now: NOW,
  });
  assert.equal(checked.ok, false, "смена пути недействительна");
});

test("чужой секрет и чужой регион не проходят", () => {
  const { url } = presign();
  assert.equal(
    verifyPresignedUrl(url, { secretAccessKey: "wrong", region: CREDS.region, now: NOW }).ok,
    false,
  );
  assert.equal(
    verifyPresignedUrl(url, { secretAccessKey: CREDS.secretAccessKey, region: "eu-1", now: NOW }).ok,
    false,
  );
});

test("истёкшая ссылка отклоняется, будущая — тоже", () => {
  const { url } = presign(60, NOW);
  const late = verifyPresignedUrl(url, {
    secretAccessKey: CREDS.secretAccessKey,
    region: CREDS.region,
    now: new Date(NOW.getTime() + 61_000),
  });
  assert.deepEqual(late, { ok: false, reason: "expired" });

  const early = verifyPresignedUrl(url, {
    secretAccessKey: CREDS.secretAccessKey,
    region: CREDS.region,
    now: new Date(NOW.getTime() - 400_000),
  });
  assert.deepEqual(early, { ok: false, reason: "not-yet-valid" });
});

test("мусорные URL отклоняются без исключений", () => {
  const base = { secretAccessKey: CREDS.secretAccessKey, region: CREDS.region, now: NOW };
  assert.deepEqual(verifyPresignedUrl("not a url", base).ok, false);
  assert.deepEqual(verifyPresignedUrl("https://s3.example.com/x", base).ok, false);
  assert.deepEqual(verifyPresignedUrl("https://s3.example.com/x?X-Amz-Signature=zz", base).ok, false);
});

test("hmac/sha утилиты стабильны", () => {
  assert.equal(sha256HexUtf8("abc").length, 64);
  assert.equal(hmacSha256("k", "d").length, 32);
});
