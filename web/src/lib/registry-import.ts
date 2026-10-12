import "server-only";
import { FORMAT_VERSION, REQUIRED_COLUMN_LABELS, exportedAtFrom, isHeaderRow, mergeRows, parseRow, resolveHeader, type HeaderMap, type ParsedRow, type RawRow } from "@/lib/registry-format";
import type { RegistryStore } from "@/lib/registry-store";
import {
  RegistryError,
  type RegistryDatasetInfo,
  type RegistryImportReport,
  type RegistryKind,
  type RegistryRecordData,
  type StoredRegistryRecord,
} from "@/lib/registry-types";

// Импорт выгрузки реестра. Правила:
// 1. Запись определяет реестровый номер, а не название товара: одинаковые названия записи не сливают.
// 2. Повторный импорт того же файла ничего не меняет; другого файла — добавляет новое, обновляет изменившееся (с записью в
//    журнал), а пропавшее помечает absent, а не удаляет.
// 3. Не хватает обязательной колонки — импорт останавливается до записи. Плохая строка — пропускается с причиной в отчёте.
// 4. Обрезанный файл не должен «погасить» реестр: если в выгрузке меньше половины действующих записей, пропавшие не помечаются.

export const DEFAULT_MAX_ROWS = 1_500_000;
const BATCH = 1000;
const SAMPLE_LIMIT = 30;
const HEADER_SEARCH_ROWS = 10;
const SHRINK_LIMIT = 0.5;

export type ImportInput = {
  registryKind: RegistryKind;
  fileName: string;
  fileSha256: string;
  rows: AsyncIterable<RawRow>;
  /** Сколько строк заявлено в самом файле (размер листа): расхождение с прочитанным попадает в отчёт. */
  declaredRows?: number | null | (() => number | null);
  importedBy?: string | null;
  now?: Date;
  /** Разрешить пометить записи absent, даже если выгрузка выглядит неполной. */
  allowShrink?: boolean;
  maxRows?: number;
};

export type ImportResult = { dataset: RegistryDatasetInfo; report: RegistryImportReport };

const emptyReport = (): RegistryImportReport => ({
  rowsRead: 0,
  rowsSkipped: 0,
  rowsFailed: 0,
  recordsAdded: 0,
  recordsChanged: 0,
  recordsUnchanged: 0,
  recordsReturned: 0,
  recordsAbsent: 0,
  multiRowRecords: 0,
  differingValidity: 0,
  warnings: {},
  samples: [],
  absentSkippedReason: null,
  unknownColumns: [],
  alreadyImported: false,
});

const isBlank = (row: RawRow) => row.cells.every((c) => c === null || c === undefined || (typeof c === "string" && c.trim() === ""));

/** Что изменилось: только изменившиеся поля, до и после. */
export function diffRecord(before: RegistryRecordData, after: RegistryRecordData): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const out = { before: {} as Record<string, unknown>, after: {} as Record<string, unknown> };
  for (const key of Object.keys(after) as (keyof RegistryRecordData)[]) {
    if (key === "rowHash") continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      out.before[key] = before[key];
      out.after[key] = after[key];
    }
  }
  return out;
}

export async function importRegistry(store: RegistryStore, input: ImportInput): Promise<ImportResult> {
  const now = input.now ?? new Date();
  const kind = input.registryKind;

  const previous = await store.findDataset(kind, input.fileSha256);
  if (previous && previous.status === "completed" && previous.report) {
    return { dataset: previous, report: { ...previous.report, alreadyImported: true } };
  }

  // 1. Заголовок: ищем среди первых строк; до него — время выгрузки.
  const iterator = input.rows[Symbol.asyncIterator]();
  let header: HeaderMap | null = null;
  let exportedAt: string | null = null;
  for (let scanned = 0; scanned < HEADER_SEARCH_ROWS && !header; scanned++) {
    const next = await iterator.next();
    if (next.done) break;
    const cells = next.value.cells;
    if (isHeaderRow(cells)) {
      header = resolveHeader(cells);
      break;
    }
    for (const cell of cells) {
      if (typeof cell === "string" && /выгрузк/i.test(cell)) exportedAt ??= exportedAtFrom(cell);
    }
  }
  if (!header) throw new RegistryError("invalid_file", "В файле не найдена строка заголовков («Реестровый номер», «ОКПД2»): это не выгрузка реестра.");
  if (header.missing.length) {
    throw new RegistryError("missing_columns", `В файле нет обязательных колонок: ${header.missing.map((key) => `«${REQUIRED_COLUMN_LABELS[key]}»`).join(", ")}. Формат ${FORMAT_VERSION} не подходит — загрузка остановлена.`);
  }

  const report = emptyReport();
  report.unknownColumns = header.unknown;
  const warn = (tag: string) => (report.warnings[tag] = (report.warnings[tag] ?? 0) + 1);
  const sample = (row: number, reason: string) => {
    if (report.samples.length < SAMPLE_LIMIT) report.samples.push({ row, reason });
  };

  const dataset = await store.beginDataset({
    registryKind: kind,
    formatVersion: FORMAT_VERSION,
    fileName: input.fileName,
    fileSha256: input.fileSha256,
    exportedAt,
    importedBy: input.importedBy ?? null,
    now,
  });

  try {
    // 2. Строки → разобранные строки, сгруппированные по реестровому номеру.
    const groups = new Map<string, ParsedRow[]>();
    const maxRows = input.maxRows ?? DEFAULT_MAX_ROWS;
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      const raw = next.value;
      if (isBlank(raw)) {
        report.rowsSkipped++;
        continue;
      }
      report.rowsRead++;
      if (report.rowsRead > maxRows) throw new RegistryError("too_large", `В файле больше ${maxRows} строк: загрузка остановлена.`);
      const parsed = parseRow(header, raw);
      if (!parsed.ok) {
        report.rowsFailed++;
        sample(raw.rowNumber, parsed.reason);
        continue;
      }
      for (const w of parsed.row.warnings) warn(w);
      const list = groups.get(parsed.row.registryNumber);
      if (list) list.push(parsed.row);
      else groups.set(parsed.row.registryNumber, [parsed.row]);
    }
    const declared = typeof input.declaredRows === "function" ? input.declaredRows() : input.declaredRows;
    if (declared && declared > 0) {
      // Заявленный размер листа включает строки до заголовка и сам заголовок.
      const readTotal = report.rowsRead + report.rowsSkipped;
      if (Math.abs(declared - readTotal) > HEADER_SEARCH_ROWS + 1) warn("число_строк_не_совпало");
    }

    // 3. Строки → записи.
    const records: RegistryRecordData[] = [];
    for (const rows of groups.values()) {
      const merged = mergeRows(kind, rows);
      if (rows.length > 1) report.multiRowRecords++;
      if (merged.record.validUntil !== merged.record.validUntilMin) report.differingValidity++;
      for (const rejected of merged.rejected) {
        report.rowsSkipped++;
        sample(rejected.rowNumber, `${rejected.registryNumber}: тот же номер у другого предприятия (ИНН ${rejected.inn}) — в запись не влит`);
      }
      records.push(merged.record);
    }
    if (records.length === 0) throw new RegistryError("invalid_file", "В файле нет ни одной корректной записи реестра.");

    // 4. Сверка с базой пачками.
    const activeBefore = await store.countActive(kind);
    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH);
      const existing = await store.getByNumbers(kind, batch.map((r) => r.registryNumber));
      const toInsert: RegistryRecordData[] = [];
      const unchanged: StoredRegistryRecord[] = [];
      for (const record of batch) {
        const old = existing.get(record.registryNumber);
        if (!old) {
          toInsert.push(record);
        } else if (old.rowHash === record.rowHash) {
          unchanged.push(old);
        } else {
          const change = diffRecord(old, record);
          await store.updateRecord(old.id, record, dataset.id, change);
          report.recordsChanged++;
          if (old.status === "absent") report.recordsReturned++;
        }
      }
      if (toInsert.length) await store.insertRecords(dataset.id, toInsert);
      report.recordsAdded += toInsert.length;
      if (unchanged.length) {
        report.recordsReturned += await store.markSeen(dataset.id, unchanged);
        report.recordsUnchanged += unchanged.length;
      }
    }

    // 5. Пропавшие записи — absent, но не из явно неполной выгрузки.
    if (activeBefore > 0 && records.length < activeBefore * SHRINK_LIMIT && !input.allowShrink) {
      report.absentSkippedReason = `В выгрузке ${records.length} записей, а действующих было ${activeBefore}: файл выглядит неполным, пропавшие записи не помечены. Запустите с --allow-shrink, если так и задумано.`;
    } else {
      report.recordsAbsent = await store.markAbsentNotSeen(kind, dataset.id);
    }

    await store.finishDataset(dataset.id, "completed", report, new Date());
    return { dataset: { ...dataset, status: "completed", report }, report };
  } catch (error) {
    // Падение не оставляет выгрузку «в процессе»: статус и причина видны потом.
    const message = error instanceof Error ? error.message : String(error);
    report.samples.push({ row: 0, reason: `импорт остановлен: ${message.slice(0, 300)}` });
    await store.finishDataset(dataset.id, "failed", report, new Date()).catch(() => undefined);
    throw error;
  }
}
