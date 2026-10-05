/**
 * Файловый бэкенд StorageAdapter: локальная разработка и тесты.
 *
 * НЕ production: `config.ts` запрещает его при `NODE_ENV=production`.
 * Повторяет контракт S3-адаптера один к одному (ключи, TTL, bearer-ссылки),
 * чтобы интеграционные тесты проверяли настоящий flow, а не заглушку:
 * - объекты лежат файлами под корнем (`key` → путь, `..` невозможен —
 *   ключи генерирует сервер и проверяет `parseObjectKey`);
 * - рядом с объектом — sidecar `.meta.json` (`sizeBytes`, `sha256`,
 *   `contentType`), аналог S3 object metadata;
 * - подписанная ссылка — локальный URL с HMAC-токеном
 *   (`docId.exp hex-hmac`); проверяет `localDownloadRoute` ниже.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { parseObjectKey } from "./keys.ts";
import type { StorageAdapter, StoredObjectHead } from "./types.ts";

export type FsConfig = { dir: string; secret: string };

function safePath(root: string, key: string): string {
  const parsed = parseObjectKey(key);
  if (parsed.kind === "unknown") {
    throw new Error("fs: некорректный ключ объекта");
  }
  const full = resolve(join(root, ...key.split("/")));
  if (full !== resolve(root) && !full.startsWith(resolve(root) + sep)) {
    throw new Error("fs: выход за корень хранилища");
  }
  return full;
}

function signToken(secret: string, documentId: string, exp: number): string {
  return createHmac("sha256", secret).update(`${documentId}.${exp}`, "utf8").digest("hex");
}

/** Токен локальной ссылки: `base64url(documentId).exp.hex-hmac`. */
export function mintLocalToken(secret: string, documentId: string, exp: number): string {
  const id = Buffer.from(documentId, "utf8").toString("base64url");
  return `${id}.${exp}.${signToken(secret, documentId, exp)}`;
}

export type LocalTokenCheck =
  | { ok: true; documentId: string; expiresAt: Date }
  | { ok: false };

/** Проверка локального токена: подпись, срок, формат. Секрет никуда не пишется. */
export function checkLocalToken(secret: string, token: string, now: Date = new Date()): LocalTokenCheck {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false };
  }
  const [id, expRaw, sig] = parts;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp)) {
    return { ok: false };
  }
  let documentId: string;
  try {
    documentId = Buffer.from(id, "base64url").toString("utf8");
  } catch {
    return { ok: false };
  }
  if (!documentId) {
    return { ok: false };
  }
  const expected = signToken(secret, documentId, exp);
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false };
  }
  if (exp * 1000 <= now.getTime()) {
    return { ok: false };
  }
  return { ok: true, documentId, expiresAt: new Date(exp * 1000) };
}

export class FsStorageAdapter implements StorageAdapter {
  readonly backend = "fs";
  private readonly config: FsConfig;

  constructor(config: FsConfig) {
    this.config = config;
  }

  private file(key: string): string {
    return safePath(this.config.dir, key);
  }

  async putObject(key: string, bytes: Uint8Array, options: { contentType?: string; sha256?: string } = {}): Promise<void> {
    const file = this.file(key);
    await mkdir(file.slice(0, file.lastIndexOf(sep)), { recursive: true });
    await writeFile(file, bytes);
    await writeFile(
      `${file}.meta.json`,
      JSON.stringify({
        sizeBytes: bytes.length,
        sha256: options.sha256 ?? null,
        contentType: options.contentType ?? "application/octet-stream",
      }),
    );
  }

  async getObject(key: string): Promise<{ bytes: Uint8Array; contentType: string | null } | null> {
    const file = this.file(key);
    let bytes: Buffer;
    try {
      bytes = await readFile(file);
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") {
        return null;
      }
      throw error;
    }
    let contentType: string | null = null;
    try {
      const meta = JSON.parse(await readFile(`${file}.meta.json`, "utf8")) as { contentType?: unknown };
      contentType = typeof meta.contentType === "string" ? meta.contentType : null;
    } catch {
      contentType = null;
    }
    return { bytes: new Uint8Array(bytes), contentType };
  }

  async getSignedUrl(key: string, ttlSeconds: number): Promise<{ url: string; expiresIn: number }> {
    const parsed = parseObjectKey(key);
    if (parsed.kind === "unknown") {
      throw new Error("fs: некорректный ключ объекта");
    }
    const exp = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(ttlSeconds));
    const entityId = parsed.kind === "document" ? parsed.documentId : parsed.sampleId;
    const token = mintLocalToken(this.config.secret, entityId, exp);
    return { url: `/api/storage/local/${token}`, expiresIn: Math.max(0, exp - Math.floor(Date.now() / 1000)) };
  }

  async deleteObject(key: string): Promise<{ deleted: boolean }> {
    const file = this.file(key);
    try {
      await rm(file, { force: false });
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") {
        return { deleted: false };
      }
      throw error;
    }
    await rm(`${file}.meta.json`, { force: true });
    return { deleted: true };
  }

  async headObject(key: string): Promise<StoredObjectHead | null> {
    const file = this.file(key);
    let size: number;
    try {
      size = (await stat(file)).size;
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") {
        return null;
      }
      throw error;
    }
    let sha256: string | null = null;
    try {
      const meta = JSON.parse(await readFile(`${file}.meta.json`, "utf8")) as { sha256?: unknown };
      sha256 = typeof meta.sha256 === "string" ? meta.sha256 : null;
    } catch {
      sha256 = null;
    }
    return { exists: true, sizeBytes: size, sha256 };
  }

  async listObjects(prefix: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") {
          return;
        }
        throw error;
      }
      for (const entry of entries) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(join(dir, entry.name), childRel);
        } else if (!entry.name.endsWith(".meta.json") && childRel.startsWith(prefix)) {
          out.push(childRel);
        }
      }
    };
    await walk(resolve(this.config.dir), "");
    return out.sort();
  }
}
