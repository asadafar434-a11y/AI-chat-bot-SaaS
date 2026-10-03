/**
 * Backup/restore объектов S6-хранилища с проверкой контрольных сумм.
 *
 * Каждый объект: bytes + sha256 + size + contentType. При backup хеш
 * пересчитывается по байтам и сверяется с метаданными; нечитаемый объект
 * попадает в `mismatches` (manifest/validation это явно отметит), молчаливо
 * неполного backup не бывает.
 */

import { sha256HexBytes } from "../storage/sign.ts";
import type { StorageAdapter } from "../storage/types.ts";
import type { BackupObject } from "./types.ts";

export async function collectObjects(
  storage: StorageAdapter,
  prefix = "org/",
): Promise<{ objects: BackupObject[]; mismatches: string[] }> {
  const keys = (await storage.listObjects(prefix)).sort();
  const objects: BackupObject[] = [];
  const mismatches: string[] = [];

  for (const key of keys) {
    const head = await storage.headObject(key);
    const got = await storage.getObject(key);
    if (!got) {
      mismatches.push(key);
      continue;
    }
    const sha256 = sha256HexBytes(got.bytes);
    if (head?.sha256 && head.sha256 !== sha256) {
      mismatches.push(key);
    }
    objects.push({
      key,
      sha256,
      size: got.bytes.length,
      contentType: got.contentType,
      data: Buffer.from(got.bytes).toString("base64"),
    });
  }

  return { objects, mismatches };
}

export async function restoreObjects(
  storage: StorageAdapter,
  objects: BackupObject[],
): Promise<{ restored: number; checksumsOk: boolean }> {
  let restored = 0;
  let checksumsOk = true;
  for (const object of objects) {
    const bytes = new Uint8Array(Buffer.from(object.data, "base64"));
    if (sha256HexBytes(bytes) !== object.sha256) {
      checksumsOk = false;
    }
    await storage.putObject(object.key, bytes, {
      ...(object.contentType ? { contentType: object.contentType } : {}),
      sha256: object.sha256,
    });
    restored += 1;
  }
  return { restored, checksumsOk };
}

export async function verifyObjects(storage: StorageAdapter, objects: BackupObject[]): Promise<boolean> {
  for (const object of objects) {
    const got = await storage.getObject(object.key);
    if (!got || sha256HexBytes(got.bytes) !== object.sha256) {
      return false;
    }
  }
  return true;
}
