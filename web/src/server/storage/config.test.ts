/**
 * Конфигурация хранилища: TTL, неполная S3-конфигурация — явная ошибка,
 * fs-бэкенд запрещён в production, фабрика выбирает реализацию.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createStorageAdapter, signedUrlTtlSeconds, storageConfigFromEnv } from "./config.ts";
import { StorageError } from "./types.ts";

const s3env: Record<string, string> = {
  STORAGE_BACKEND: "s3",
  S3_ENDPOINT: "https://s3.example.com",
  S3_REGION: "ru-1",
  S3_BUCKET: "docs",
  S3_ACCESS_KEY_ID: "id",
  S3_SECRET_ACCESS_KEY: "secret",
};

test("TTL: default, явное, мусор, границы", () => {
  assert.equal(signedUrlTtlSeconds({}), 300);
  assert.equal(signedUrlTtlSeconds({ S3_SIGNED_URL_TTL_SECONDS: "60" }), 60);
  assert.equal(signedUrlTtlSeconds({ S3_SIGNED_URL_TTL_SECONDS: "мусор" }), 300);
  assert.equal(signedUrlTtlSeconds({ S3_SIGNED_URL_TTL_SECONDS: "0" }), 1);
  assert.equal(signedUrlTtlSeconds({ S3_SIGNED_URL_TTL_SECONDS: "99999999" }), 86400);
});

test("неполная S3-конфигурация — явная ошибка, а не тихий fallback", () => {
  const { S3_BUCKET: _drop, ...partial } = s3env;
  void _drop;
  assert.throws(() => storageConfigFromEnv(partial), (e: unknown) => {
    assert.ok(e instanceof StorageError);
    assert.match(e.message, /S3_BUCKET/);
    return true;
  });
});

test("fs-бэкенд запрещён в production без явного opt-in", () => {
  const base = {
    NODE_ENV: "production",
    STORAGE_BACKEND: "fs",
    STORAGE_FS_DIR: "/tmp/x",
    STORAGE_FS_SECRET: "s",
  };
  assert.throws(() => storageConfigFromEnv(base), /production/);
  assert.deepEqual(storageConfigFromEnv({ ...base, STORAGE_FS_ALLOW_PRODUCTION: "1" }), {
    backend: "fs",
    dir: "/tmp/x",
    secret: "s",
  });
});

test("без конфигурации вообще — явная ошибка", () => {
  assert.throws(() => storageConfigFromEnv({}), StorageError);
});

test("фабрика возвращает реализацию по конфигурации", () => {
  assert.equal(
    createStorageAdapter({ backend: "s3", endpoint: s3env.S3_ENDPOINT, region: "ru-1", bucket: "docs", accessKeyId: "id", secretAccessKey: "secret", pathStyle: true }).backend,
    "s3",
  );
  assert.equal(createStorageAdapter({ backend: "fs", dir: "/tmp/x", secret: "s" }).backend, "fs");
});
