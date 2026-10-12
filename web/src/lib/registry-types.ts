// Реестр промышленной продукции: общие типы. Даты в записях — строки «ГГГГ-ММ-ДД» (без времени и часового пояса),
// моменты — ISO-строки. Реестровый номер всегда строка: числом ведущие нули и буквы теряются.

export const REGISTRY_KINDS = ["gisp_rpp_719"] as const;
export type RegistryKind = (typeof REGISTRY_KINDS)[number];

export const REGISTRY_TITLES: Record<RegistryKind, string> = {
  gisp_rpp_719: "Реестр российской промышленной продукции (ГИСП, ПП 719)",
};

export const REGISTRY_SHORT: Record<RegistryKind, string> = {
  gisp_rpp_719: "РПП (ПП 719)",
};

export const isRegistryKind = (value: unknown): value is RegistryKind =>
  typeof value === "string" && (REGISTRY_KINDS as readonly string[]).includes(value);

/** Одно основание записи: строка выгрузки. У записи их бывает несколько, с разными сроками. */
export type RegistryBasis = {
  /** Вид основания: «СТ-1», «Акт экспертизы ТПП»… */
  name: string | null;
  number: string | null;
  date: string | null;
  validUntil: string | null;
  /** Дата внесения, как она стоит в этой строке выгрузки. */
  addedAt: string | null;
  /** Срок действия записи, как он стоит в этой строке выгрузки. */
  recordValidUntil: string | null;
  conclusionNumber: string | null;
  conclusionUrl: string | null;
};

export type RegistryFlags = { ai: boolean; highTech: boolean; trustedPak: boolean };

/** Запись реестра в том виде, в котором она сравнивается и сохраняется. */
export type RegistryRecordData = {
  registryKind: RegistryKind;
  registryNumber: string;
  enterpriseName: string;
  inn: string;
  ogrn: string | null;
  productName: string;
  okpd2: string;
  tnved: string | null;
  madeBy: string | null;
  digitalPassport: string | null;
  primaryNumber: string | null;
  addedAt: string | null;
  /** Самая поздняя дата окончания среди оснований. */
  validUntil: string | null;
  /** Самая ранняя. Отличается от validUntil — у записи несколько оснований с разными сроками. */
  validUntilMin: string | null;
  terminatedAt: string | null;
  points: number | null;
  percent: number | null;
  conformity: string | null;
  department: string | null;
  flags: RegistryFlags;
  bases: RegistryBasis[];
  rowHash: string;
};

export type RegistryRecordStatus = "active" | "absent";

export type StoredRegistryRecord = RegistryRecordData & {
  id: string;
  status: RegistryRecordStatus;
  firstSeenDatasetId: string;
  lastSeenDatasetId: string;
};

export type RegistryImportStatus = "running" | "completed" | "failed";

export type RegistryImportReport = {
  rowsRead: number;
  rowsSkipped: number;
  rowsFailed: number;
  recordsAdded: number;
  recordsChanged: number;
  recordsUnchanged: number;
  recordsReturned: number;
  recordsAbsent: number;
  /** Номера с несколькими строками (основаниями) — собраны в одну запись. */
  multiRowRecords: number;
  /** Номера, у которых основания дают разные сроки действия. */
  differingValidity: number;
  warnings: Record<string, number>;
  /** Первые примеры ошибок и пропусков: строка файла и причина. */
  samples: { row: number; reason: string }[];
  /** Записи не помечены «отсутствует»: выгрузка выглядит неполной (см. registry-import.ts). */
  absentSkippedReason: string | null;
  /** Колонки файла, которых формат не знает: они не загружаются, но и не пропадают молча. */
  unknownColumns: string[];
  alreadyImported: boolean;
};

export type RegistryDatasetInfo = {
  id: string;
  registryKind: RegistryKind;
  formatVersion: string;
  fileName: string;
  fileSha256: string;
  /** Время выгрузки по данным самого файла. */
  exportedAt: string | null;
  importedAt: string;
  status: RegistryImportStatus;
  importedBy: string | null;
  report: RegistryImportReport | null;
};

export class RegistryError extends Error {
  code: "invalid_file" | "missing_columns" | "too_large" | "invalid_input" | "store_failed";
  constructor(code: RegistryError["code"], message: string) {
    super(message);
    this.name = "RegistryError";
    this.code = code;
  }
}

/** Как строка с номером выглядит в заявке. Закон называет номер «реестровой записью», поэтому слова близки к его тексту. */
export const REGISTRY_LINE_LABEL = "Номер реестровой записи в реестре российской промышленной продукции";
export const registryLine = (number: string): string => `${REGISTRY_LINE_LABEL}: ${number}`;

/** Допустимый вид номера в документе: цифры, буквы и дефис. Остальное в файл не пускаем. */
export const isSafeRegistryNumber = (value: unknown): value is string => typeof value === "string" && /^[\p{L}\p{N}\-]{1,40}$/u.test(value);

// Моменты времени (выгрузка, подтверждение выбора) хранятся в UTC, а показываются по Москве: так их видит владелец и так написано
// в самой выгрузке («11.10.2026, 01:00:10» — это 10.10 22:00 UTC).
const MSK_OFFSET_MS = 3 * 3600 * 1000;
export const moscowDay = (iso: string): string => new Date(Date.parse(iso) + MSK_OFFSET_MS).toISOString().slice(0, 10);
export const moscowTime = (iso: string): string => new Date(Date.parse(iso) + MSK_OFFSET_MS).toISOString().slice(11, 16);
