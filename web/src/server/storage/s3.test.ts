/**
 * S3-протокол против in-process stub: подпись проверяется пересчётом,
 * чужой секрет и подмена — 403, бакет приватный (прямой GET без подписи — 403).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { S3StorageAdapter } from "./s3.ts";
import { startStubS3 } from "./testing/stub-s3.ts";

const SECRET = "stub-secret-key";
const WRONG = "wrong-secret-key";

function client(url: string, secret: string = SECRET): S3StorageAdapter {
  return new S3StorageAdapter({
    endpoint: url,
    region: "ru-1",
    bucket: "docs",
    accessKeyId: "TESTID",
    secretAccessKey: secret,
    pathStyle: true,
  });
}

const KEY = "org/c00000000000000000001/doc/c00000000000000000002/abcdef0123456789abcdef0123456789";

test("put → head → signed download → verify bytes → delete", async () => {
  const stub = await startStubS3({ bucket: "docs", region: "ru-1", secretAccessKey: SECRET });
  try {
    const s3 = client(stub.url);
    const bytes = new TextEncoder().encode("содержимое файла");
    await s3.putObject(KEY, bytes, { contentType: "application/pdf", sha256: "abc" });

    const head = await s3.headObject(KEY);
    assert.deepEqual(head, { exists: true, sizeBytes: bytes.length, sha256: "abc" });

    const { url, expiresIn } = await s3.getSignedUrl(KEY, 300);
    assert.ok(expiresIn > 0 && expiresIn <= 300);
    assert.ok(!url.includes(SECRET), "секрет не попадает в ссылку");
    const downloaded = await (await fetch(url)).arrayBuffer();
    assert.deepEqual(Buffer.from(downloaded), Buffer.from(bytes), "байты сошлись");

    assert.deepEqual(await s3.deleteObject(KEY), { deleted: true });
    assert.equal(await s3.headObject(KEY), null);
    assert.deepEqual(await s3.deleteObject(KEY), { deleted: false }, "повторный delete определён");
  } finally {
    await stub.close();
  }
});

test("чужой секрет не проходит нигде", async () => {
  const stub = await startStubS3({ bucket: "docs", region: "ru-1", secretAccessKey: SECRET });
  try {
    const evil = client(stub.url, WRONG);
    await assert.rejects(() => evil.putObject(KEY, new Uint8Array([1])), /403/);
    await assert.rejects(() => evil.deleteObject(KEY), /403/);
    await assert.rejects(() => evil.headObject(KEY), /403/);
    const { url } = await evil.getSignedUrl(KEY, 300);
    assert.equal((await fetch(url)).status, 403, "чужая подписанная ссылка недействительна");
  } finally {
    await stub.close();
  }
});

test("прямой доступ без подписи запрещён, подмена подписи видна", async () => {
  const stub = await startStubS3({ bucket: "docs", region: "ru-1", secretAccessKey: SECRET });
  try {
    const s3 = client(stub.url);
    await s3.putObject(KEY, new TextEncoder().encode("x"));
    assert.equal((await fetch(`${stub.url}/docs/${KEY}`)).status, 403, "бакет приватный");

    const { url } = await s3.getSignedUrl(KEY, 300);
    const tampered = url.replace(/X-Amz-Expires=\d+/, "X-Amz-Expires=301");
    assert.equal((await fetch(tampered)).status, 403, "подмена query недействительна");
  } finally {
    await stub.close();
  }
});

test("listObjects видит только свой префикс (reconciliation)", async () => {
  const stub = await startStubS3({ bucket: "docs", region: "ru-1", secretAccessKey: SECRET });
  try {
    const s3 = client(stub.url);
    await s3.putObject("org/c00000000000000000001/doc/d1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", new Uint8Array([1]));
    await s3.putObject("org/c00000000000000000002/doc/d2/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", new Uint8Array([2]));
    const mine = await s3.listObjects("org/c00000000000000000001/");
    assert.equal(mine.length, 1);
    assert.ok(mine[0].includes("d1"));
  } finally {
    await stub.close();
  }
});
