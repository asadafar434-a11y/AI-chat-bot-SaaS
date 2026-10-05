/**
 * Абстракция объектного хранилища S6 (слой 4b, architecture.md).
 *
 * Правила:
 * - UI этот модуль не импортирует никогда: только серверные сервисы;
 * - credentials живут только здесь (читаются из окружения) и никогда не
 *   покидают сервер — в ответы/URL/логи попадают только подписи;
 * - публичных URL нет by construction: интерфейс не умеет их строить,
 *   скачивание — только через короткоживущий подписанный URL;
 * - ключи генерирует сервер (`keys.ts`), адаптер принимает готовый ключ.
 */

export type StoredObjectHead = {
  exists: boolean;
  sizeBytes: number | null;
  /** sha256 содержимого, если бэкенд его хранит/возвращает. */
  sha256: string | null;
};

/** Минимальные операции слоя файлов: put/get/get-signed/delete/head/list. */
export type StorageAdapter = {
  readonly backend: string;
  putObject(key: string, bytes: Uint8Array, options?: { contentType?: string; sha256?: string }): Promise<void>;
  /**
   * Читает объект целиком серверной стороной (для фоновых задач). Публичных
   * ссылок не выдаёт: скачивание клиенту — только через `getSignedUrl`.
   * Отсутствующий объект — `null`.
   */
  getObject(key: string): Promise<{ bytes: Uint8Array; contentType: string | null } | null>;
  /** Короткоживущий URL скачивания; bearer-возможность с TTL, не публичная ссылка. */
  getSignedUrl(key: string, ttlSeconds: number): Promise<{ url: string; expiresIn: number }>;
  deleteObject(key: string): Promise<{ deleted: boolean }>;
  headObject(key: string): Promise<StoredObjectHead | null>;
  /** Ключи под префиксом — только для reconciliation, не для request path. */
  listObjects(prefix: string): Promise<string[]>;
};

/** Ошибка хранилища с машиночитаемым кодом (в ответы уходит общий текст). */
export class StorageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`StorageError(${code}): ${message}`);
    this.name = "StorageError";
    this.code = code;
  }
}
