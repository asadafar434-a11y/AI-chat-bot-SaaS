/**
 * Типы подсистемы backup/restore S9.
 *
 * Backup = manifest (открытый, без секретов) + зашифрованный payload
 * (SQL-дамп БД + объекты S6). Манифест позволяет установить, что забэкаплено,
 * не содержа секретов, токенов, signed URL и содержимого документов.
 */

export type BackupManifest = {
  format: "tender-lawyer-backup";
  version: 1;
  backupId: string;
  createdAt: string;
  /** Версия приложения/схемы, к которой относится backup. */
  appVersion: string;
  /** Откуда снят backup (только имена, без credentials). */
  source: { database: string; storageBackend: string };
  database: {
    tableCounts: Record<string, number>;
    sqlSha256: string;
    sqlBytes: number;
  };
  objects: {
    count: number;
    totalBytes: number;
    /** Хеш набора `key:sha256`, сортировка не важна. */
    checksum: string;
  };
  payload: {
    file: string;
    sha256: string;
    bytes: number;
    encryption: { algorithm: "aes-256-gcm"; iv: string; tag: string };
  };
  /**
   * Окно консистентности: БД и объектное хранилище снимаются не атомарно.
   * Указываются моменты снятия и явная оговорка.
   */
  consistency: {
    databaseAt: string;
    objectsAt: string;
    note: string;
  };
};

/** Расшифрованный payload backup. */
export type BackupPayload = {
  databaseSql: string;
  objects: BackupObject[];
};

export type BackupObject = {
  key: string;
  sha256: string;
  size: number;
  contentType: string | null;
  /** Содержимое в base64 (в production-потоке — по объекту отдельно). */
  data: string;
};

export type BackupValidation = {
  /** Объекты, на которые ссылается БД, но которых нет в backup. */
  missingObjects: string[];
  /** Объекты в backup, на которые БД не ссылается. */
  orphanObjects: string[];
  /** Расхождение размера/хеша при чтении объекта. */
  checksumMismatches: string[];
  ok: boolean;
};

export type RestoreResult = {
  backupId: string;
  database: string;
  tableCounts: Record<string, number>;
  objectsRestored: number;
  objectChecksumsOk: boolean;
};

export type RestoreValidationReport = {
  /** Счётчики после восстановления против манифеста. */
  tableCounts: Record<string, { expected: number; actual: number; match: boolean }>;
  countsMatch: boolean;
  /** Проверка контрольных сумм восстановленных объектов. */
  objectsMatch: boolean;
  /** Документы БД ссылаются на существующие объекты. */
  consistency: BackupValidation;
  ok: boolean;
};

export class BackupError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`BackupError(${code}): ${message}`);
    this.name = "BackupError";
    this.code = code;
  }
}
