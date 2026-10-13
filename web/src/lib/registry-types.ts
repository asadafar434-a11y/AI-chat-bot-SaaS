// Реестр промышленной продукции: общие типы. Даты в записях — строки «ГГГГ-ММ-ДД» (без времени и часового пояса),
// моменты — ISO-строки. Реестровый номер всегда строка: числом ведущие нули и буквы теряются.

export const REGISTRY_KINDS = ["gisp_rpp_719", "gisp_rep_878"] as const;
export type RegistryKind = (typeof REGISTRY_KINDS)[number];

export const REGISTRY_TITLES: Record<RegistryKind, string> = {
  gisp_rpp_719: "Реестр российской промышленной продукции (ГИСП, ПП 719)",
  gisp_rep_878: "Реестр российской радиоэлектронной продукции (ГИСП, ПП 878)",
};

export const REGISTRY_SHORT: Record<RegistryKind, string> = {
  gisp_rpp_719: "РПП (ПП 719)",
  gisp_rep_878: "РЭП (ПП 878)",
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

/**
 * Признаки и ссылки записи (один JSON-столбец, без отдельной миграции). Последние три есть не у всех выгрузок — их ключей в записи
 * нет, пока в файле нет колонки: так отпечаток записей, загруженных раньше, не меняется.
 */
export type RegistryFlags = {
  ai: boolean;
  highTech: boolean;
  trustedPak: boolean;
  /** «Уровень радиоэлектронной продукции»: «Уровень 1», «Уровень 2», «Нет уровня». */
  radioLevel?: string;
  /** Выписка из реестра на сайте ГИСП. Сохраняется только ссылка на gisp.gov.ru по https. */
  extractUrl?: string;
  catalogUrl?: string;
};

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
const REGISTRY_LINE_LABELS: Record<RegistryKind, string> = {
  gisp_rpp_719: REGISTRY_LINE_LABEL,
  gisp_rep_878: "Номер реестровой записи в реестре российской радиоэлектронной продукции",
};
/** Название реестра стоит в строке по виду реестра: номер РЭП не подписывается как номер РПП. Без вида — РПП. */
export const registryLine = (number: string, kind: RegistryKind = "gisp_rpp_719"): string => `${REGISTRY_LINE_LABELS[kind]}: ${number}`;

/**
 * Номер, который подобрала система, а человек ещё не проверил: в квадратных скобках, чтобы в документе он был выделен жёлтым и считался
 * незаполненным местом (итоговая проверка не пропустит), пока участник не выберет или не подтвердит номер.
 */
export const registryUnverifiedField = (number: string, options?: number): string =>
  `[ПРОВЕРЬТЕ номер реестровой записи: ${number} — подобран автоматически${options && options > 1 ? `, вариантов: ${options}` : ""}]`;
export const registryLineUnverified = (number: string, kind: RegistryKind = "gisp_rpp_719", options?: number): string =>
  `${REGISTRY_LINE_LABELS[kind]}: ${registryUnverifiedField(number, options)}`;

/** Ссылка из выгрузки годится для показа, только если это https-адрес на gisp.gov.ru: чужие адреса в интерфейс не попадают. */
export function gispUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && (url.hostname === "gisp.gov.ru" || url.hostname.endsWith(".gisp.gov.ru")) && value.length <= 400 ? url.href : null;
  } catch {
    return null;
  }
}

/** Допустимый вид номера в документе: цифры, буквы и дефис. Остальное в файл не пускаем. */
export const isSafeRegistryNumber = (value: unknown): value is string => typeof value === "string" && /^[\p{L}\p{N}\-]{1,40}$/u.test(value);

// Моменты времени (выгрузка, подтверждение выбора) хранятся в UTC, а показываются по Москве: так их видит владелец и так написано
// в самой выгрузке («11.10.2026, 01:00:10» — это 10.10 22:00 UTC).
const MSK_OFFSET_MS = 3 * 3600 * 1000;
export const moscowDay = (iso: string): string => new Date(Date.parse(iso) + MSK_OFFSET_MS).toISOString().slice(0, 10);
export const moscowTime = (iso: string): string => new Date(Date.parse(iso) + MSK_OFFSET_MS).toISOString().slice(11, 16);

/** Процентный показатель в реестре — доля от 0 до 1 (0,81): на экране — в процентах. */
export const percentText = (percent: number): string => `${String(Math.round(percent * 10000) / 100).replace(".", ",")} %`;

/** «Баллы: 135 · процентный показатель: 81 %». Нет ни того, ни другого — null: в записи их нет, и выдумывать нечего. */
export function scoreText(points: number | null | undefined, percent: number | null | undefined): string | null {
  const parts: string[] = [];
  if (points !== null && points !== undefined) parts.push(`баллы: ${points}`);
  if (percent !== null && percent !== undefined) parts.push(`процентный показатель: ${percentText(percent)}`);
  return parts.length ? parts.join(" · ") : null;
}
