/**
 * Fs-бэкенд: тот же контракт адаптера на локальных файлах (dev/test).
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { checkLocalToken, FsStorageAdapter, mintLocalToken } from "./fs.ts";

const KEY = "org/c00000000000000000001/doc/c00000000000000000002/abcdef0123456789abcdef0123456789";

async function backend() {
  const dir = await mkdtemp(join(tmpdir(), "s6-fs-"));
  const fs = new FsStorageAdapter({ dir, secret: "local-secret" });
  return { dir, fs };
}

test("put → head → delete; токены round-trip", async () => {
  const { dir, fs } = await backend();
  try {
    const bytes = new TextEncoder().encode("локальный файл");
    await fs.putObject(KEY, bytes, { contentType: "text/plain", sha256: "abc" });
    assert.deepEqual(await fs.headObject(KEY), { exists: true, sizeBytes: bytes.length, sha256: "abc" });

    const { url, expiresIn } = await fs.getSignedUrl(KEY, 300);
    assert.ok(url.startsWith("/api/storage/local/"));
    assert.ok(expiresIn > 0 && expiresIn <= 300);
    const token = url.split("/").pop() ?? "";
    const checked = checkLocalToken("local-secret", token);
    assert.equal(checked.ok, true);

    assert.deepEqual(await fs.deleteObject(KEY), { deleted: true });
    assert.equal(await fs.headObject(KEY), null);
    assert.deepEqual(await fs.deleteObject(KEY), { deleted: false });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("токены: чужой секрет, подмена, срок", async () => {
  const exp = Math.floor(Date.now() / 1000) + 300;
  const token = mintLocalToken("local-secret", "doc1", exp);
  assert.equal(checkLocalToken("local-secret", token).ok, true);
  assert.equal(checkLocalToken("wrong", token).ok, false);
  assert.equal(checkLocalToken("local-secret", `${token}x`).ok, false);
  assert.equal(checkLocalToken("local-secret", "мусор").ok, false);
  assert.equal(
    checkLocalToken("local-secret", mintLocalToken("local-secret", "doc1", Math.floor(Date.now() / 1000) - 1)).ok,
    false,
    "истёкший токен недействителен",
  );
});

test("выход за корень и битые ключи отклоняются", async () => {
  const { dir, fs } = await backend();
  try {
    await assert.rejects(() => fs.putObject("../../etc/x", new Uint8Array([1])), /некорректный ключ/);
    await assert.rejects(() => fs.getSignedUrl("мусор", 60), /некорректный ключ/);
    assert.equal(await fs.headObject("org/c00000000000000000001/doc/d1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("listObjects видит только свой префикс и не видит метаданные", async () => {
  const { dir, fs } = await backend();
  try {
    await fs.putObject("org/c00000000000000000001/doc/d1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", new Uint8Array([1]));
    await fs.putObject("org/c00000000000000000002/doc/d2/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", new Uint8Array([2]));
    assert.deepEqual(await fs.listObjects("org/c00000000000000000001/"), [
      "org/c00000000000000000001/doc/d1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
