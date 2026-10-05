/**
 * Канонический JSON и sha256 для контрольных сумм переноса.
 *
 * Требование: одна и та же запись, прочитанная из копии и из PostgreSQL (где
 * порядок ключей в JSONB не гарантируется), обязана давать один хеш. Поэтому
 * ключи объектов сортируются рекурсивно, а массивы сохраняют порядок —
 * порядок элементов массива является данными.
 */

import { createHash } from "node:crypto";

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) {
        out[key] = sortKeys(entry);
      }
    }
    return out;
  }
  return value;
}

/** Детерминированная сериализация: те же данные — та же строка, независимо от порядка ключей. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/** sha256 в hex по UTF-8 байтам строки. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Контрольная сумма одной записи: хеш её канонической формы. */
export function recordChecksum(record: unknown): string {
  return sha256Hex(stableStringify(record));
}

/**
 * Контрольная сумма набора записей: хеш отсортированных построчных хешей.
 * Порядок строк не влияет, состав — влияет.
 */
export function setChecksum(checksums: readonly string[]): string {
  return sha256Hex([...checksums].sort().join("\n"));
}
