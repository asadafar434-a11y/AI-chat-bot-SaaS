/**
 * Удаление объектов S6, привязанных к строке (исходник, текст, карта) — best-effort.
 * Общий помощник для удаления/замены строк (S5) и полного удаления данных (P1).
 * Без хранилища — no-op: строки всё равно удаляются, а объекты уберёт сверка S8.
 */
import type { StorageAdapter } from "./types.ts";

type Row = Record<string, unknown>;

export async function deleteRowObjects(storage: StorageAdapter | undefined, row: Row): Promise<void> {
  if (!storage) {
    return;
  }
  for (const key of [row.storageKey, row.textKey, row.mapKey]) {
    if (typeof key === "string" && key) {
      await storage.deleteObject(key);
    }
  }
}
