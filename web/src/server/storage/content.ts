/**
 * Мелкие помощники чтения/записи производного содержимого в S6 (S11-R0).
 *
 * Текст документа/образца и карта (`DocMap`) — крупные производные от файла
 * данные. В PostgreSQL лежат только ключи (`textKey`/`mapKey`), само содержимое
 * — в объектном хранилище через `StorageAdapter`. Эти функции не создают второй
 * storage: только кодируют/декодируют JSON и текст поверх существующего адаптера.
 *
 * Правила:
 * - отсутствующий объект — `null`, а не исключение (у legacy-строк ключа может не быть);
 * - ошибка хранилища не глотается молча там, где содержимое обязательно (запись),
 *   и превращается в `null` при необязательном чтении (метаданные важнее текста);
 * - содержимое в логи не пишется: только ключ и результат.
 */

import type { StorageAdapter } from "./types.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Текст объекта либо `null`: нет ключа, нет объекта или хранилище недоступно. */
export async function readObjectText(storage: StorageAdapter | undefined, key: string | null): Promise<string | null> {
  if (!storage || typeof key !== "string" || key.length === 0) {
    return null;
  }
  try {
    const object = await storage.getObject(key);
    return object ? decoder.decode(object.bytes) : null;
  } catch {
    return null;
  }
}

/** JSON объекта либо `null`: нет ключа, нет объекта, хранилище недоступно или битый JSON. */
export async function readObjectJson<T>(storage: StorageAdapter | undefined, key: string | null): Promise<T | null> {
  const text = await readObjectText(storage, key);
  if (text === null) {
    return null;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Запись текста. Ошибка хранилища пробрасывается: молча потерять содержимое нельзя. */
export function putObjectText(storage: StorageAdapter, key: string, text: string): Promise<void> {
  return storage.putObject(key, encoder.encode(text), { contentType: "text/plain; charset=utf-8" });
}

/** Запись JSON. Ошибка хранилища пробрасывается: молча потерять содержимое нельзя. */
export function putObjectJson(storage: StorageAdapter, key: string, value: unknown): Promise<void> {
  return storage.putObject(key, encoder.encode(JSON.stringify(value)), { contentType: "application/json" });
}
