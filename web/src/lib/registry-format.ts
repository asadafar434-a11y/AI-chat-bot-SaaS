import "server-only";
import { createHash } from "node:crypto";
import { isInn, isOkpd2 } from "@/lib/registry-text";
import { gispUrl, type RegistryBasis, type RegistryFlags, type RegistryKind, type RegistryRecordData } from "@/lib/registry-types";

// Формат выгрузок ГИСП: «Реестр российской промышленной продукции» (ПП 719) и выгрузка радиоэлектронной продукции. Колонки ищутся
// по названию в строке заголовков, а не по номеру столбца: порядок колонок в выгрузке может меняться, а у второго файла часть
// колонок называется иначе («Наименование предприятия», «ОКПД 2») и есть лишние (уровень, ссылки). Бизнес-логика этого файла не
// знает — она работает с RegistryRecordData. Новая версия формата — новое название колонки в списках ниже.

export const FORMAT_VERSION = "gisp-v2";

export type Cell = string | number | boolean | null | undefined;
export type RawRow = { rowNumber: number; cells: Cell[] };

const COLUMN_NAMES = {
  enterprise: "предприятие",
  inn: "инн",
  ogrn: "огрн",
  primaryNumber: "первичный регистрационный номер реестровой записи",
  registryNumber: "реестровый номер",
  digitalPassport: "номер цифрового паспорта",
  addedAt: "дата внесения в реестр",
  validUntil: "срок действия",
  terminatedAt: "фактическая дата прекращения действия реестровой записи",
  productName: "наименование продукции",
  okpd2: "окпд2",
  tnved: "тн вэд",
  madeBy: "изготовлена по",
  points: "баллы",
  percent: "процентный показатель",
  conformity: "о соответствии",
  ai: "искусственный интеллект",
  highTech: "высокотехнологичное оборудование",
  trustedPak: "доверенный пак",
  basisName: "основание: наименование",
  basisDate: "основание: дата",
  basisNumber: "основание: номер",
  basisValidUntil: "основание: срок действия",
  department: "заключение: департамент",
  conclusionNumber: "заключение: номер заключения",
  conclusionUrl: "заключение: документ",
  radioLevel: "уровень радиоэлектронной продукции",
  extractUrl: "ссылка на выписку из реестра",
  catalogUrl: "ссылка на каталог продукции",
} as const;

/** Другие названия тех же колонок: у выгрузки радиоэлектронной продукции они свои. */
const COLUMN_ALIASES: Record<string, ColumnKey> = {
  "наименование предприятия": "enterprise",
  "окпд 2": "okpd2",
};

export type ColumnKey = keyof typeof COLUMN_NAMES;

/** Без этих колонок запись не определить: импорт останавливается, а не угадывает. Названия — как в файле, для сообщения об ошибке. */
export const REQUIRED_COLUMN_LABELS = {
  enterprise: "Предприятие",
  inn: "ИНН",
  registryNumber: "Реестровый номер",
  productName: "Наименование продукции",
  okpd2: "ОКПД2",
  addedAt: "Дата внесения в реестр",
  validUntil: "Срок действия",
} as const;
export const REQUIRED_COLUMNS = Object.keys(REQUIRED_COLUMN_LABELS) as (keyof typeof REQUIRED_COLUMN_LABELS)[];

/** Колонки, которые формат знает, но которых могло не быть в старых выгрузках, — их отсутствие не ошибка. */
const KNOWN_IGNORED = new Set(["фактический адрес производителя", "адрес производственных помещений", "№ п/п"]);

const normHeader = (value: Cell): string =>
  String(value ?? "")
    .replace(/[ \s]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е");

export type HeaderMap = { columns: Partial<Record<ColumnKey, number>>; unknown: string[]; missing: (keyof typeof REQUIRED_COLUMN_LABELS)[] };

/** Строка заголовков → номера колонок. Колонки, которых формат не знает, не теряются молча: они попадают в unknown. */
export function resolveHeader(cells: Cell[]): HeaderMap {
  const byName = new Map<string, ColumnKey>();
  for (const [key, name] of Object.entries(COLUMN_NAMES) as [ColumnKey, string][]) byName.set(name, key);
  for (const [name, key] of Object.entries(COLUMN_ALIASES)) byName.set(name, key);
  const columns: Partial<Record<ColumnKey, number>> = {};
  const unknown: string[] = [];
  cells.forEach((cell, index) => {
    const name = normHeader(cell);
    if (!name) return;
    const key = byName.get(name);
    if (key && columns[key] === undefined) columns[key] = index;
    else if (!key && !KNOWN_IGNORED.has(name)) unknown.push(String(cell).trim());
  });
  return { columns, unknown, missing: REQUIRED_COLUMNS.filter((key) => columns[key] === undefined) };
}

/** Строка заголовков — первая из начальных строк, где есть «Реестровый номер» и «ОКПД2» («ОКПД 2»). */
export function isHeaderRow(cells: Cell[]): boolean {
  const names = new Set(cells.map(normHeader));
  return names.has(COLUMN_NAMES.registryNumber) && (names.has(COLUMN_NAMES.okpd2) || names.has("окпд 2"));
}

/** «Время выгрузки: 11.10.2026, 01:00:10» → момент. В файле нет часового пояса, принят московский. */
export function exportedAtFrom(text: string): string | null {
  const match = /(\d{2})\.(\d{2})\.(\d{4})(?:,?\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(text);
  if (!match) return null;
  const [, d, m, y, hh = "00", mm = "00", ss = "00"] = match;
  const iso = `${y}-${m}-${d}T${hh}:${mm}:${ss}+03:00`;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  const year = Number(y);
  return year >= 2020 && year <= 2100 ? new Date(time).toISOString() : null;
}

/** Дата ячейки: число Excel, «дд.мм.гггг» или «гггг-мм-дд» → «ГГГГ-ММ-ДД». Всё прочее — null. */
export function dateOf(cell: Cell): string | null {
  if (cell === null || cell === undefined || cell === "") return null;
  if (typeof cell === "number" && Number.isFinite(cell) && cell > 20000 && cell < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(cell) * 86400000).toISOString().slice(0, 10);
  }
  if (typeof cell === "string") {
    const text = cell.trim();
    const dotted = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    const [y, m, d] = dotted ? [dotted[3], dotted[2], dotted[1]] : iso ? [iso[1], iso[2], iso[3]] : [];
    if (!y) return null;
    const time = Date.UTC(Number(y), Number(m) - 1, Number(d));
    const back = new Date(time).toISOString().slice(0, 10);
    return back === `${y}-${m}-${d}` && Number(y) >= 1990 && Number(y) <= 2100 ? back : null;
  }
  return null;
}

const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const cleanText = (cell: Cell): string => (cell === null || cell === undefined ? "" : String(cell)).replace(control, "").replace(/[ \t ]+/g, " ").trim();
const nullable = (cell: Cell): string | null => cleanText(cell) || null;
const bool = (cell: Cell): boolean => cell === true || (typeof cell === "string" && ["true", "1", "да"].includes(cell.trim().toLowerCase()));
const numberOf = (cell: Cell): number | null => {
  if (cell === null || cell === undefined || cell === "") return null;
  const value = typeof cell === "number" ? cell : Number(String(cell).replace(",", ".").trim());
  return Number.isFinite(value) ? value : null;
};

/** Одна строка выгрузки после разбора. */
export type ParsedRow = {
  rowNumber: number;
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
  validUntil: string | null;
  terminatedAt: string | null;
  points: number | null;
  percent: number | null;
  conformity: string | null;
  department: string | null;
  flags: RegistryFlags;
  basis: RegistryBasis;
  warnings: string[];
};

export type RowResult = { ok: true; row: ParsedRow } | { ok: false; reason: string };

const LIMITS = { enterprise: 600, productName: 1000, tnved: 300, madeBy: 2000, digitalPassport: 40, primaryNumber: 60, department: 200, ogrn: 15 } as const;

/** Разбор одной строки по найденным колонкам. Нет обязательного значения — строка отклоняется с причиной, а не заполняется догадкой. */
export function parseRow(header: HeaderMap, raw: RawRow): RowResult {
  const warnings: string[] = [];
  const at = (key: ColumnKey): Cell => (header.columns[key] === undefined ? undefined : raw.cells[header.columns[key]!]);
  const clip = (value: string | null, max: number, field: string): string | null => {
    if (value !== null && value.length > max) {
      warnings.push(`длина:${field}`);
      return value.slice(0, max);
    }
    return value;
  };

  const numberCell = at("registryNumber");
  if (typeof numberCell === "number") warnings.push("номер_числом");
  const registryNumber = cleanText(typeof numberCell === "number" ? String(numberCell) : numberCell);
  if (!registryNumber) return { ok: false, reason: "пустой реестровый номер" };
  if (registryNumber.length > 40 || /\s/.test(registryNumber)) return { ok: false, reason: `некорректный реестровый номер: «${registryNumber.slice(0, 40)}»` };
  if (!/^\d{8}$/.test(registryNumber)) warnings.push("формат_номера");

  const enterpriseName = clip(cleanText(at("enterprise")), LIMITS.enterprise, "предприятие");
  if (!enterpriseName) return { ok: false, reason: `${registryNumber}: пустое предприятие` };
  const inn = cleanText(at("inn")).replace(/\s+/g, "");
  if (!inn) return { ok: false, reason: `${registryNumber}: пустой ИНН` };
  if (inn.length > 12) return { ok: false, reason: `${registryNumber}: некорректный ИНН` };
  if (!isInn(inn)) warnings.push("формат_инн");
  const productName = clip(cleanText(at("productName")), LIMITS.productName, "наименование");
  if (!productName) return { ok: false, reason: `${registryNumber}: пустое наименование продукции` };
  const okpd2 = cleanText(at("okpd2"));
  if (!okpd2) return { ok: false, reason: `${registryNumber}: пустой ОКПД2` };
  if (okpd2.length > 20) return { ok: false, reason: `${registryNumber}: некорректный ОКПД2` };
  if (!isOkpd2(okpd2)) warnings.push("формат_окпд2");

  const dated = (key: ColumnKey, label: string): string | null => {
    const cell = at(key);
    const value = dateOf(cell);
    if (value === null && cell !== null && cell !== undefined && cell !== "") warnings.push(`дата:${label}`);
    return value;
  };
  const addedAt = dated("addedAt", "внесения");
  const validUntil = dated("validUntil", "срок действия");
  if (!addedAt) warnings.push("нет_даты_внесения");
  if (!validUntil) warnings.push("нет_срока_действия");
  const terminatedAt = dated("terminatedAt", "прекращения");

  // Уровень и ссылки есть не во всех выгрузках; ссылка на чужой сайт в запись не попадает.
  const level = clip(nullable(at("radioLevel")), 60, "уровень");
  const linked = (key: ColumnKey, label: string): string | null => {
    const cell = at(key);
    const url = gispUrl(cell);
    if (!url && cell !== null && cell !== undefined && cell !== "") warnings.push(`ссылка:${label}`);
    return url;
  };
  const extractUrl = linked("extractUrl", "выписка");
  const catalogUrl = linked("catalogUrl", "каталог");

  const basis: RegistryBasis = {
    name: nullable(at("basisName")),
    number: nullable(at("basisNumber")),
    date: dated("basisDate", "основания"),
    validUntil: dated("basisValidUntil", "срок основания"),
    addedAt,
    recordValidUntil: validUntil,
    conclusionNumber: nullable(at("conclusionNumber")),
    conclusionUrl: nullable(at("conclusionUrl")),
  };

  return {
    ok: true,
    row: {
      rowNumber: raw.rowNumber,
      registryNumber,
      enterpriseName,
      inn,
      ogrn: clip(nullable(at("ogrn")), LIMITS.ogrn, "огрн"),
      productName,
      okpd2,
      tnved: clip(nullable(at("tnved")), LIMITS.tnved, "тнвэд"),
      madeBy: clip(nullable(at("madeBy")), LIMITS.madeBy, "изготовлена по"),
      digitalPassport: clip(nullable(at("digitalPassport")), LIMITS.digitalPassport, "паспорт"),
      primaryNumber: clip(nullable(at("primaryNumber")), LIMITS.primaryNumber, "первичный номер"),
      addedAt,
      validUntil,
      terminatedAt,
      points: numberOf(at("points")),
      percent: numberOf(at("percent")),
      conformity: nullable(at("conformity")),
      department: clip(nullable(at("department")), LIMITS.department, "департамент"),
      flags: {
        ai: bool(at("ai")),
        highTech: bool(at("highTech")),
        trustedPak: bool(at("trustedPak")),
        ...(level && { radioLevel: level }),
        ...(extractUrl && { extractUrl }),
        ...(catalogUrl && { catalogUrl }),
      },
      basis,
      warnings,
    },
  };
}

const maxDate = (values: (string | null)[]): string | null => values.reduce<string | null>((best, v) => (v && (!best || v > best) ? v : best), null);
const minDate = (values: (string | null)[]): string | null => values.reduce<string | null>((best, v) => (v && (!best || v < best) ? v : best), null);

const byBasis = (a: RegistryBasis, b: RegistryBasis) =>
  (a.addedAt ?? "").localeCompare(b.addedAt ?? "") || (a.number ?? "").localeCompare(b.number ?? "") || (a.name ?? "").localeCompare(b.name ?? "");

export type MergeResult = {
  record: RegistryRecordData;
  /** Строки, которые не слились с остальными: у них другое предприятие. Номер один, а производитель разный — это не одна запись. */
  rejected: ParsedRow[];
};

/**
 * Строки одного реестрового номера → одна запись. Описание берётся из строки с самой поздней датой внесения; сроки и основания
 * собираются со всех строк. Строка другого производителя в запись не вливается — она возвращается в rejected.
 */
export function mergeRows(kind: RegistryKind, rows: ParsedRow[]): MergeResult {
  const sorted = [...rows].sort((a, b) => (a.addedAt ?? "").localeCompare(b.addedAt ?? "") || a.rowNumber - b.rowNumber);
  const primary = sorted[sorted.length - 1];
  const same = sorted.filter((r) => r.inn === primary.inn);
  const rejected = sorted.filter((r) => r.inn !== primary.inn);
  const bases = same.map((r) => r.basis).sort(byBasis);
  const data: Omit<RegistryRecordData, "rowHash"> = {
    registryKind: kind,
    registryNumber: primary.registryNumber,
    enterpriseName: primary.enterpriseName,
    inn: primary.inn,
    ogrn: primary.ogrn,
    productName: primary.productName,
    okpd2: primary.okpd2,
    tnved: primary.tnved,
    madeBy: primary.madeBy,
    digitalPassport: primary.digitalPassport,
    primaryNumber: primary.primaryNumber,
    addedAt: minDate(same.map((r) => r.addedAt)),
    validUntil: maxDate(same.map((r) => r.validUntil)),
    validUntilMin: minDate(same.map((r) => r.validUntil)),
    terminatedAt: maxDate(same.map((r) => r.terminatedAt)),
    points: primary.points,
    percent: primary.percent,
    conformity: primary.conformity,
    department: primary.department,
    flags: {
      ai: same.some((r) => r.flags.ai),
      highTech: same.some((r) => r.flags.highTech),
      trustedPak: same.some((r) => r.flags.trustedPak),
      // Уровень и ссылки — из той же строки, что и описание записи.
      ...(primary.flags.radioLevel && { radioLevel: primary.flags.radioLevel }),
      ...(primary.flags.extractUrl && { extractUrl: primary.flags.extractUrl }),
      ...(primary.flags.catalogUrl && { catalogUrl: primary.flags.catalogUrl }),
    },
    bases,
  };
  return { record: { ...data, rowHash: hashRecord(data) }, rejected };
}

/** Отпечаток сведений записи: одинаковые сведения дают одинаковый отпечаток независимо от порядка строк в файле. */
export function hashRecord(data: Omit<RegistryRecordData, "rowHash">): string {
  const keys = Object.keys(data).sort();
  const canonical = JSON.stringify(keys.map((key) => [key, (data as Record<string, unknown>)[key]]));
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
