/**
 * In-memory `StorageAdapter` для модульных проверок (только тесты).
 *
 * Повторяет контракт S6-адаптера без сети и файлов: те же ключи, тот же
 * `getObject`/`putObject`, тот же «отсутствующий объект — null». Хранит байты,
 * contentType и sha256 в памяти процесса; между тестами объекты не разделяются.
 */

import { sha256HexBytes } from "../sign.ts";
import type { StorageAdapter, StoredObjectHead } from "../types.ts";

type Entry = { bytes: Uint8Array; contentType: string | null; sha256: string | null };

export type MemoryStorage = StorageAdapter & { readonly entries: Map<string, Entry> };

export function memoryStorage(): MemoryStorage {
  const entries = new Map<string, Entry>();
  return {
    backend: "memory",
    entries,
    async putObject(key, bytes, options) {
      entries.set(key, {
        bytes: new Uint8Array(bytes),
        contentType: options?.contentType ?? null,
        sha256: options?.sha256 ?? sha256HexBytes(bytes),
      });
    },
    async getObject(key) {
      const entry = entries.get(key);
      return entry ? { bytes: new Uint8Array(entry.bytes), contentType: entry.contentType } : null;
    },
    async getSignedUrl(key, ttlSeconds) {
      return { url: `memory://${key}?ttl=${ttlSeconds}`, expiresIn: ttlSeconds };
    },
    async deleteObject(key) {
      return { deleted: entries.delete(key) };
    },
    async headObject(key): Promise<StoredObjectHead | null> {
      const entry = entries.get(key);
      return entry ? { exists: true, sizeBytes: entry.bytes.length, sha256: entry.sha256 } : null;
    },
    async listObjects(prefix) {
      return [...entries.keys()].filter((key) => key.startsWith(prefix)).sort();
    },
  };
}
