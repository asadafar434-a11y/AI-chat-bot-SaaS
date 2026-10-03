/**
 * Чтение артефакта backup: манифест + проверка целостности + расшифровка payload.
 * Общий код для restore и validate.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { decryptPayload } from "./crypto.ts";
import type { BackupManifest, BackupPayload } from "./types.ts";
import { BackupError } from "./types.ts";

export async function readBackupManifest(backupDir: string): Promise<BackupManifest> {
  let raw: string;
  try {
    raw = await readFile(join(backupDir, "manifest.json"), "utf8");
  } catch {
    throw new BackupError("manifest", `не найден manifest.json в ${backupDir}`);
  }
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(raw) as BackupManifest;
  } catch {
    throw new BackupError("manifest", "manifest.json не является JSON");
  }
  if (manifest.format !== "tender-lawyer-backup" || manifest.version !== 1) {
    throw new BackupError("manifest", "неизвестный формат или версия backup");
  }
  return manifest;
}

export async function readBackupPayload(
  backupDir: string,
  manifest: BackupManifest,
  encryptionKey: Buffer,
): Promise<BackupPayload> {
  const ciphertext = await readFile(join(backupDir, manifest.payload.file));
  const sha256 = createHash("sha256").update(ciphertext).digest("hex");
  if (sha256 !== manifest.payload.sha256 || ciphertext.length !== manifest.payload.bytes) {
    throw new BackupError("integrity", "payload backup повреждён (sha256/размер не совпали)");
  }
  return decryptPayload<BackupPayload>(
    ciphertext,
    encryptionKey,
    manifest.payload.encryption.iv,
    manifest.payload.encryption.tag,
  );
}
