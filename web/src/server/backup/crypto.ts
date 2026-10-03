/**
 * Шифрование backup at rest: AES-256-GCM.
 *
 * Ключ приходит из окружения (`BACKUP_ENCRYPTION_KEY`, 64 hex-символа = 32 байта)
 * и НЕ хранится внутри артефакта backup. IV и GCM-тег не являются секретами и
 * лежат в манифесте.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { BackupError } from "./types.ts";

export const ENCRYPTION_ALGORITHM = "aes-256-gcm" as const;

export function parseEncryptionKey(keyHex: string | undefined): Buffer {
  const value = (keyHex ?? "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new BackupError("encryption-key", "BACKUP_ENCRYPTION_KEY: нужен hex из 64 символов (32 байта)");
  }
  return Buffer.from(value, "hex");
}

export function encryptPayload(payload: unknown, key: Buffer): { ciphertext: Buffer; iv: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

export function decryptPayload<T>(ciphertext: Buffer, key: Buffer, ivB64: string, tagB64: string): T {
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  try {
    const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch {
    throw new BackupError("decrypt", "payload не расшифровывается: неверный ключ или повреждённый файл");
  }
}
