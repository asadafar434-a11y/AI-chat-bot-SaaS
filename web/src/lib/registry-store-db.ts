import "server-only";
import type { BatchResult, ModelDelegate, QueryArgs } from "../server/db/db-client.ts";
import type {
  BeginDatasetInput,
  RecordChange,
  RegistryChangeRow,
  RegistrySearchQuery,
  RegistrySearchResult,
  RegistryStore,
} from "./registry-store.ts";
import type {
  RegistryBasis,
  RegistryDatasetInfo,
  RegistryFlags,
  RegistryImportReport,
  RegistryImportStatus,
  RegistryKind,
  RegistryRecordData,
  StoredRegistryRecord,
} from "./registry-types.ts";

// Реестр в PostgreSQL (таблицы RegistryDataset, RegistryRecord, RegistryChange; миграция S13). Простые обращения идут через
// делегаты Prisma, поиск — параметризованным SQL: значения из документов в текст запроса не попадают, только в параметры.

type Creating = ModelDelegate & { createMany(args: QueryArgs): Promise<BatchResult> };

export type RegistryDb = {
  registryDataset: ModelDelegate;
  registryRecord: Creating;
  registryChange: Creating;
  $queryRawUnsafe<T = unknown>(sql: string, ...values: unknown[]): Promise<T>;
};

const BATCH = 1000;

const toDate = (value: string | null): Date | null => (value ? new Date(`${value}T00:00:00.000Z`) : null);
const fromDate = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};
const iso = (value: unknown): string | null => (value instanceof Date ? value.toISOString() : value ? String(value) : null);

type RecordRow = Record<string, unknown>;

const recordOf = (row: RecordRow): StoredRegistryRecord => ({
  id: String(row.id),
  registryKind: row.registryKind as RegistryKind,
  registryNumber: String(row.registryNumber),
  status: row.status as "active" | "absent",
  enterpriseName: String(row.enterpriseName),
  inn: String(row.inn),
  ogrn: (row.ogrn as string | null) ?? null,
  productName: String(row.productName),
  okpd2: String(row.okpd2),
  tnved: (row.tnved as string | null) ?? null,
  madeBy: (row.madeBy as string | null) ?? null,
  digitalPassport: (row.digitalPassport as string | null) ?? null,
  primaryNumber: (row.primaryNumber as string | null) ?? null,
  addedAt: fromDate(row.addedAt),
  validUntil: fromDate(row.validUntil),
  validUntilMin: fromDate(row.validUntilMin),
  terminatedAt: fromDate(row.terminatedAt),
  points: (row.points as number | null) ?? null,
  percent: (row.percent as number | null) ?? null,
  conformity: (row.conformity as string | null) ?? null,
  department: (row.department as string | null) ?? null,
  flags: row.flags as RegistryFlags,
  bases: row.bases as RegistryBasis[],
  rowHash: String(row.rowHash),
  firstSeenDatasetId: String(row.firstSeenDatasetId),
  lastSeenDatasetId: String(row.lastSeenDatasetId),
});

const dataOf = (record: RegistryRecordData) => ({
  registryKind: record.registryKind,
  registryNumber: record.registryNumber,
  enterpriseName: record.enterpriseName,
  inn: record.inn,
  ogrn: record.ogrn,
  productName: record.productName,
  okpd2: record.okpd2,
  tnved: record.tnved,
  madeBy: record.madeBy,
  digitalPassport: record.digitalPassport,
  primaryNumber: record.primaryNumber,
  addedAt: toDate(record.addedAt),
  validUntil: toDate(record.validUntil),
  validUntilMin: toDate(record.validUntilMin),
  terminatedAt: toDate(record.terminatedAt),
  points: record.points,
  percent: record.percent,
  conformity: record.conformity,
  department: record.department,
  flags: record.flags,
  bases: record.bases,
  rowHash: record.rowHash,
});

const datasetOf = (row: RecordRow): RegistryDatasetInfo => ({
  id: String(row.id),
  registryKind: row.registryKind as RegistryKind,
  formatVersion: String(row.formatVersion),
  fileName: String(row.fileName),
  fileSha256: String(row.fileSha256),
  exportedAt: iso(row.exportedAt),
  importedAt: iso(row.createdAt) ?? "",
  status: row.status as RegistryImportStatus,
  importedBy: (row.importedBy as string | null) ?? null,
  report: (row.report as RegistryImportReport | null) ?? null,
});

const COLUMNS = [
  '"id"', '"registryKind"', '"registryNumber"', '"status"', '"enterpriseName"', '"inn"', '"ogrn"', '"productName"', '"okpd2"', '"tnved"', '"madeBy"',
  '"digitalPassport"', '"primaryNumber"',
  `to_char("addedAt", 'YYYY-MM-DD') AS "addedAt"`,
  `to_char("validUntil", 'YYYY-MM-DD') AS "validUntil"`,
  `to_char("validUntilMin", 'YYYY-MM-DD') AS "validUntilMin"`,
  `to_char("terminatedAt", 'YYYY-MM-DD') AS "terminatedAt"`,
  '"points"', '"percent"', '"conformity"', '"department"', '"flags"', '"bases"', '"rowHash"', '"firstSeenDatasetId"', '"lastSeenDatasetId"',
].join(", ");

/** Обозначение для сравнения: буквы и цифры, заглавные, латинские двойники — кириллицей. Совпадает с compact() из registry-text.ts. */
const COMPACT_SQL = `regexp_replace(translate(upper(replace(lower("productName" || ' ' || coalesce("madeBy", '')), 'ё', 'е')), 'ABCEHKMOPTXY', 'АВСЕНКМОРТХУ'), '[^[:alnum:]]+', '', 'g')`;

/** Цифры кода → начало записи ОКПД2 с точками: 31011 → «31.01.1» (группы 2-2-2-3). */
export function dottedPrefix(digits: string): string {
  const sizes = [2, 2, 2, 3];
  const parts: string[] = [];
  let at = 0;
  for (const size of sizes) {
    if (at >= digits.length) break;
    parts.push(digits.slice(at, at + size));
    at += size;
  }
  return parts.join(".");
}

export function createDbRegistryStore(db: RegistryDb): RegistryStore {
  return {
    async findDataset(kind, fileSha256) {
      const row = (await db.registryDataset.findFirst({ where: { registryKind: kind, fileSha256 } })) as RecordRow | null;
      return row ? datasetOf(row) : null;
    },
    async beginDataset(input: BeginDatasetInput) {
      const existing = (await db.registryDataset.findFirst({ where: { registryKind: input.registryKind, fileSha256: input.fileSha256 } })) as RecordRow | null;
      if (existing) {
        await db.registryDataset.updateMany({
          where: { id: existing.id },
          data: { status: "running", report: null, exportedAt: input.exportedAt ? new Date(input.exportedAt) : null, importedBy: input.importedBy, finishedAt: null },
        });
        return { ...datasetOf(existing), status: "running", report: null, exportedAt: input.exportedAt, importedBy: input.importedBy };
      }
      const row = (await db.registryDataset.create({
        data: {
          registryKind: input.registryKind,
          formatVersion: input.formatVersion,
          fileName: input.fileName.slice(0, 500),
          fileSha256: input.fileSha256,
          exportedAt: input.exportedAt ? new Date(input.exportedAt) : null,
          importedBy: input.importedBy,
          status: "running",
        },
      })) as RecordRow;
      return datasetOf(row);
    },
    async finishDataset(id, status, report, now) {
      await db.registryDataset.updateMany({ where: { id }, data: { status, report, finishedAt: now } });
    },
    async latestDataset(kind) {
      const row = (await db.registryDataset.findFirst({
        where: { registryKind: kind, status: "completed" },
        orderBy: [{ exportedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      })) as RecordRow | null;
      return row ? datasetOf(row) : null;
    },

    async getByNumbers(kind, numbers) {
      const out = new Map<string, StoredRegistryRecord>();
      for (let i = 0; i < numbers.length; i += BATCH) {
        const rows = (await db.registryRecord.findMany({ where: { registryKind: kind, registryNumber: { in: numbers.slice(i, i + BATCH) } } })) as RecordRow[];
        for (const row of rows) out.set(String(row.registryNumber), recordOf(row));
      }
      return out;
    },
    async getByNumber(kind, number) {
      const row = (await db.registryRecord.findFirst({ where: { registryKind: kind, registryNumber: number } })) as RecordRow | null;
      return row ? recordOf(row) : null;
    },
    async insertRecords(datasetId, records) {
      for (let i = 0; i < records.length; i += BATCH) {
        await db.registryRecord.createMany({
          data: records.slice(i, i + BATCH).map((r) => ({ ...dataOf(r), status: "active", firstSeenDatasetId: datasetId, lastSeenDatasetId: datasetId })),
        });
      }
    },
    async updateRecord(id: string, data: RegistryRecordData, datasetId: string, change: RecordChange) {
      await db.registryRecord.updateMany({ where: { id }, data: { ...dataOf(data), status: "active", lastSeenDatasetId: datasetId } });
      await db.registryChange.create({ data: { recordId: id, datasetId, kind: "changed", before: change.before, after: change.after } });
    },
    async markSeen(datasetId, records) {
      let returned = 0;
      for (let i = 0; i < records.length; i += BATCH) {
        const slice = records.slice(i, i + BATCH);
        await db.registryRecord.updateMany({ where: { id: { in: slice.map((r) => r.id) } }, data: { status: "active", lastSeenDatasetId: datasetId } });
        const back = slice.filter((r) => r.status === "absent");
        if (back.length) {
          await db.registryChange.createMany({ data: back.map((r) => ({ recordId: r.id, datasetId, kind: "returned" })) });
          returned += back.length;
        }
      }
      return returned;
    },
    async countActive(kind) {
      return db.registryRecord.count({ where: { registryKind: kind, status: "active" } });
    },
    async markAbsentNotSeen(kind, datasetId) {
      const rows = (await db.registryRecord.findMany({
        where: { registryKind: kind, status: "active", NOT: { lastSeenDatasetId: datasetId } },
        select: { id: true },
      })) as { id: string }[];
      for (let i = 0; i < rows.length; i += BATCH) {
        const ids = rows.slice(i, i + BATCH).map((r) => r.id);
        await db.registryRecord.updateMany({ where: { id: { in: ids } }, data: { status: "absent" } });
        await db.registryChange.createMany({ data: ids.map((recordId) => ({ recordId, datasetId, kind: "absent" })) });
      }
      return rows.length;
    },

    async search(query: RegistrySearchQuery): Promise<RegistrySearchResult> {
      const params: unknown[] = [query.registryKind];
      const where: string[] = ['"registryKind" = $1'];
      let rank = "";
      const add = (value: unknown) => {
        params.push(value);
        return `$${params.length}`;
      };
      if (query.inn) where.push(`"inn" = ${add(query.inn)}`);
      const digits = query.okpd2Prefix?.replace(/\D/g, "");
      if (digits) where.push(`"okpd2" LIKE ${add(`${dottedPrefix(digits)}%`)}`);
      const words = (query.nameWords ?? []).flatMap((w) => w.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
      if (words.length) {
        const q = add(words.join(" & "));
        where.push(`to_tsvector('russian', "productName") @@ to_tsquery('russian', ${q})`);
        rank = `ts_rank_cd(to_tsvector('russian', "productName"), to_tsquery('russian', ${q})) DESC, `;
      }
      for (const word of (query.enterpriseWords ?? []).flatMap((w) => w.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])) {
        where.push(`position(${add(word.replace(/ё/g, "е"))} in replace(lower("enterpriseName"), 'ё', 'е')) > 0`);
      }
      if (query.standardRef) where.push(`position(${add(query.standardRef)} in ${COMPACT_SQL}) > 0`);
      if (query.modelRef) where.push(`position(${add(query.modelRef)} in ${COMPACT_SQL}) > 0`);
      const clause = where.join(" AND ");
      const limit = add(Math.max(1, Math.min(500, Math.floor(query.limit))));
      const records = await db.$queryRawUnsafe<RecordRow[]>(
        `SELECT ${COLUMNS} FROM "RegistryRecord" WHERE ${clause} ORDER BY ${rank}("status" = 'active') DESC, "registryNumber" ASC LIMIT ${limit}`,
        ...params,
      );
      const counted = await db.$queryRawUnsafe<{ n: bigint | number }[]>(`SELECT count(*) AS n FROM "RegistryRecord" WHERE ${clause}`, ...params.slice(0, -1));
      return { records: records.map(recordOf), total: Number(counted[0]?.n ?? 0) };
    },
    async history(recordId) {
      const rows = (await db.registryChange.findMany({ where: { recordId }, orderBy: { createdAt: "asc" } })) as RecordRow[];
      return rows.map(
        (r): RegistryChangeRow => ({
          id: String(r.id),
          recordId: String(r.recordId),
          datasetId: String(r.datasetId),
          kind: r.kind as RegistryChangeRow["kind"],
          before: (r.before as Record<string, unknown> | null) ?? null,
          after: (r.after as Record<string, unknown> | null) ?? null,
          createdAt: iso(r.createdAt) ?? "",
        }),
      );
    },
  };
}
