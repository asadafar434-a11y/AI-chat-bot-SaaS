/**
 * Конфигурация хранилища из окружения + фабрика адаптера.
 *
 * Переменные (плейсхолдеры уже есть в `.env.example`):
 * - `STORAGE_BACKEND`: `s3` (production) или `fs` (локальная разработка/тесты);
 * - `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
 *   `S3_SECRET_ACCESS_KEY`, `S3_SIGNED_URL_TTL_SECONDS`, `S3_FORCE_PATH_STYLE`;
 * - `STORAGE_FS_DIR`: корень fs-бэкенда (только dev/test, не production);
 * - `STORAGE_FS_SECRET`: HMAC-секрет локальных ссылок (dev/test).
 *
 * Правила:
 * - неполная S3-конфигурация — явная ошибка конфигурации, а не тихий fallback;
 * - fs-бэкенд запрещён при `NODE_ENV=production`, кроме явного
 *   `STORAGE_FS_ALLOW_PRODUCTION=1` (staging/smoke, не боевой production);
 * - TTL подписанных URL централизовано ограничен: 1..86400 секунд.
 */

import { FsStorageAdapter } from "./fs.ts";
import { S3StorageAdapter } from "./s3.ts";
import { StorageError, type StorageAdapter } from "./types.ts";

export const DEFAULT_SIGNED_URL_TTL_SECONDS = 300;
export const MAX_SIGNED_URL_TTL_SECONDS = 86400;

/** TTL подписанных URL: явное значение из окружения либо default; мусор — default. */
export function signedUrlTtlSeconds(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.S3_SIGNED_URL_TTL_SECONDS);
  if (!Number.isFinite(raw)) {
    return DEFAULT_SIGNED_URL_TTL_SECONDS;
  }
  return Math.min(MAX_SIGNED_URL_TTL_SECONDS, Math.max(1, Math.floor(raw)));
}

export type StorageConfig =
  | {
    backend: "s3";
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    pathStyle: boolean;
  }
  | { backend: "fs"; dir: string; secret: string };

export function storageConfigFromEnv(env: Record<string, string | undefined> = process.env): StorageConfig {
  if (env.STORAGE_BACKEND === "s3") {
    const endpoint = (env.S3_ENDPOINT ?? "").trim();
    const region = (env.S3_REGION ?? "").trim();
    const bucket = (env.S3_BUCKET ?? "").trim();
    const accessKeyId = (env.S3_ACCESS_KEY_ID ?? "").trim();
    const secretAccessKey = (env.S3_SECRET_ACCESS_KEY ?? "").trim();
    const missing = [
      ["S3_ENDPOINT", endpoint],
      ["S3_REGION", region],
      ["S3_BUCKET", bucket],
      ["S3_ACCESS_KEY_ID", accessKeyId],
      ["S3_SECRET_ACCESS_KEY", secretAccessKey],
    ]
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length > 0) {
      throw new StorageError("config", `неполная конфигурация S3: нет ${missing.join(", ")}`);
    }
    return {
      backend: "s3",
      endpoint,
      region,
      bucket,
      accessKeyId,
      secretAccessKey,
      pathStyle: env.S3_FORCE_PATH_STYLE !== "0",
    };
  }
  if (env.NODE_ENV === "production" && env.STORAGE_FS_ALLOW_PRODUCTION !== "1") {
    throw new StorageError("config", "fs-бэкенд запрещён в production: нужен STORAGE_BACKEND=s3");
  }
  const dir = (env.STORAGE_FS_DIR ?? "").trim();
  const secret = (env.STORAGE_FS_SECRET ?? "").trim();
  if (!dir || !secret) {
    throw new StorageError("config", "нужен STORAGE_BACKEND=s3 либо STORAGE_FS_DIR + STORAGE_FS_SECRET");
  }
  return { backend: "fs", dir, secret };
}

/** Адаптер по конфигурации. Креды остаются внутри адаптера. */
export function createStorageAdapter(config?: StorageConfig): StorageAdapter {
  const resolved = config ?? storageConfigFromEnv();
  if (resolved.backend === "s3") {
    return new S3StorageAdapter(resolved);
  }
  return new FsStorageAdapter(resolved);
}

/**
 * Адаптер, если хранилище вообще настроено; иначе `undefined`.
 *
 * Нужен путям, которые читают метаданные и без S6 (S11-R0): отсутствие
 * `STORAGE_BACKEND` — это не ошибка, просто содержимое в объектном хранилище
 * не появится. Неполная конфигурация уже выбранного бэкенда по-прежнему
 * отвергается явно (`storageConfigFromEnv`), а не превращается в тихий `undefined`.
 */
export function optionalStorageAdapter(env: Record<string, string | undefined> = process.env): StorageAdapter | undefined {
  if (!env.STORAGE_BACKEND) {
    return undefined;
  }
  return createStorageAdapter(storageConfigFromEnv(env));
}
