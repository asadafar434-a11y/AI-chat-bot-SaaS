import { compact, lowerWords, stemWord } from "@/lib/registry-text";
import type {
  RegistryDatasetInfo,
  RegistryImportReport,
  RegistryImportStatus,
  RegistryKind,
  RegistryRecordData,
  StoredRegistryRecord,
} from "@/lib/registry-types";

// Хранилище реестра. Один интерфейс — две реализации: память (быстрые тесты) и PostgreSQL (registry-store-db.ts).
// Хранилище только достаёт кандидатов (полнота); решает, подходит ли кандидат, registry-match.ts (точность).

export type RegistryChangeRow = {
  id: string;
  recordId: string;
  datasetId: string;
  kind: "changed" | "absent" | "returned";
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
};

export type RegistrySearchQuery = {
  registryKind: RegistryKind;
  inn?: string;
  /** Начало кода ОКПД2: «31.01» — все записи ветки. */
  okpd2Prefix?: string;
  /** Слова названия (целиком, не основы): должны встретиться все. Падежи хранилище учитывает само. */
  nameWords?: string[];
  /** Слова названия производителя (целиком, без «ООО»): должны встретиться все. */
  enterpriseWords?: string[];
  /** Ссылка на ТУ или ГОСТ в сжатом виде (registry-text.compact): ищется в названии и в «Изготовлена по». */
  standardRef?: string;
  /** Обозначение модели в сжатом виде: ищется там же. */
  modelRef?: string;
  limit: number;
};

export type RegistrySearchResult = { records: StoredRegistryRecord[]; total: number };

export type BeginDatasetInput = {
  registryKind: RegistryKind;
  formatVersion: string;
  fileName: string;
  fileSha256: string;
  exportedAt: string | null;
  importedBy: string | null;
  now: Date;
};

export type RecordChange = { before: Record<string, unknown>; after: Record<string, unknown> };

export interface RegistryStore {
  findDataset(kind: RegistryKind, fileSha256: string): Promise<RegistryDatasetInfo | null>;
  /** Новая выгрузка в статусе running. Выгрузка того же файла, не дошедшая до конца, начинается заново. */
  beginDataset(input: BeginDatasetInput): Promise<RegistryDatasetInfo>;
  finishDataset(id: string, status: RegistryImportStatus, report: RegistryImportReport, now: Date): Promise<void>;
  /** Последняя успешно загруженная выгрузка реестра. */
  latestDataset(kind: RegistryKind): Promise<RegistryDatasetInfo | null>;

  getByNumbers(kind: RegistryKind, numbers: string[]): Promise<Map<string, StoredRegistryRecord>>;
  getByNumber(kind: RegistryKind, number: string): Promise<StoredRegistryRecord | null>;
  insertRecords(datasetId: string, records: RegistryRecordData[]): Promise<void>;
  /** Запись изменилась: новые сведения, отметка выгрузки и строка журнала. Возвращённая из absent запись снова active. */
  updateRecord(id: string, data: RegistryRecordData, datasetId: string, change: RecordChange): Promise<void>;
  /** Записи без изменений: отмечаем, что выгрузка их видела. Те, что были absent, возвращаются в active с записью в журнале. */
  markSeen(datasetId: string, records: StoredRegistryRecord[]): Promise<number>;
  countActive(kind: RegistryKind): Promise<number>;
  /** Записи, которых не было в этой выгрузке, становятся absent с записью в журнале. */
  markAbsentNotSeen(kind: RegistryKind, datasetId: string): Promise<number>;

  search(query: RegistrySearchQuery): Promise<RegistrySearchResult>;
  history(recordId: string): Promise<RegistryChangeRow[]>;
}

// ── Память ─────────────────────────────────────────────────────────────────────────────────────────

export function createMemoryRegistryStore(): RegistryStore & {
  records: Map<string, StoredRegistryRecord>;
  datasets: RegistryDatasetInfo[];
  changes: RegistryChangeRow[];
} {
  const datasets: RegistryDatasetInfo[] = [];
  const records = new Map<string, StoredRegistryRecord>();
  const changes: RegistryChangeRow[] = [];
  let seq = 0;
  const key = (kind: string, number: string) => `${kind}\n${number}`;
  const nextId = (prefix: string) => `${prefix}${++seq}`;
  const log = (recordId: string, datasetId: string, kind: RegistryChangeRow["kind"], before: Record<string, unknown> | null, after: Record<string, unknown> | null) =>
    changes.push({ id: nextId("chg"), recordId, datasetId, kind, before, after, createdAt: new Date().toISOString() });

  const stemsOf = (text: string) => new Set(lowerWords(text).map(stemWord));

  return {
    records,
    datasets,
    changes,
    async findDataset(kind, sha) {
      return datasets.find((d) => d.registryKind === kind && d.fileSha256 === sha) ?? null;
    },
    async beginDataset(input) {
      const existing = datasets.find((d) => d.registryKind === input.registryKind && d.fileSha256 === input.fileSha256);
      if (existing) {
        Object.assign(existing, { status: "running", report: null, exportedAt: input.exportedAt, importedBy: input.importedBy, importedAt: input.now.toISOString() });
        return existing;
      }
      const info: RegistryDatasetInfo = {
        id: nextId("ds"),
        registryKind: input.registryKind,
        formatVersion: input.formatVersion,
        fileName: input.fileName,
        fileSha256: input.fileSha256,
        exportedAt: input.exportedAt,
        importedAt: input.now.toISOString(),
        status: "running",
        importedBy: input.importedBy,
        report: null,
      };
      datasets.push(info);
      return info;
    },
    async finishDataset(id, status, report) {
      const info = datasets.find((d) => d.id === id);
      if (info) Object.assign(info, { status, report });
    },
    async latestDataset(kind) {
      const done = datasets.filter((d) => d.registryKind === kind && d.status === "completed");
      return done.sort((a, b) => (b.exportedAt ?? b.importedAt).localeCompare(a.exportedAt ?? a.importedAt))[0] ?? null;
    },
    async getByNumbers(kind, numbers) {
      const out = new Map<string, StoredRegistryRecord>();
      for (const number of numbers) {
        const found = records.get(key(kind, number));
        if (found) out.set(number, found);
      }
      return out;
    },
    async getByNumber(kind, number) {
      return records.get(key(kind, number)) ?? null;
    },
    async insertRecords(datasetId, list) {
      for (const data of list) {
        const k = key(data.registryKind, data.registryNumber);
        if (records.has(k)) throw new Error(`запись уже есть: ${data.registryNumber}`);
        records.set(k, { ...data, id: nextId("rec"), status: "active", firstSeenDatasetId: datasetId, lastSeenDatasetId: datasetId });
      }
    },
    async updateRecord(id, data, datasetId, change) {
      const current = [...records.values()].find((r) => r.id === id);
      if (!current) throw new Error("запись не найдена");
      records.set(key(current.registryKind, current.registryNumber), { ...current, ...data, status: "active", lastSeenDatasetId: datasetId });
      log(id, datasetId, "changed", change.before, change.after);
    },
    async markSeen(datasetId, list) {
      let returned = 0;
      for (const record of list) {
        const current = records.get(key(record.registryKind, record.registryNumber));
        if (!current) continue;
        if (current.status === "absent") {
          returned++;
          log(current.id, datasetId, "returned", null, null);
        }
        records.set(key(current.registryKind, current.registryNumber), { ...current, status: "active", lastSeenDatasetId: datasetId });
      }
      return returned;
    },
    async countActive(kind) {
      return [...records.values()].filter((r) => r.registryKind === kind && r.status === "active").length;
    },
    async markAbsentNotSeen(kind, datasetId) {
      let count = 0;
      for (const [k, record] of records) {
        if (record.registryKind === kind && record.status === "active" && record.lastSeenDatasetId !== datasetId) {
          records.set(k, { ...record, status: "absent" });
          log(record.id, datasetId, "absent", null, null);
          count++;
        }
      }
      return count;
    },
    async search(q) {
      const prefix = q.okpd2Prefix?.replace(/\D/g, "");
      const terms = (q.nameWords ?? []).map((w) => stemWord(w.toLowerCase().replace(/ё/g, "е")));
      const matched = [...records.values()].filter((r) => {
        if (r.registryKind !== q.registryKind) return false;
        if (q.inn && r.inn !== q.inn) return false;
        if (q.enterpriseWords?.length) {
          const name = r.enterpriseName.toLowerCase().replace(/ё/g, "е");
          if (!q.enterpriseWords.every((w) => name.includes(w.toLowerCase().replace(/ё/g, "е")))) return false;
        }
        if (prefix && !r.okpd2.replace(/\D/g, "").startsWith(prefix)) return false;
        if (terms.length) {
          const have = stemsOf(r.productName);
          if (!terms.every((t) => have.has(t))) return false;
        }
        const haystack = compact(`${r.productName} ${r.madeBy ?? ""}`);
        if (q.standardRef && !haystack.includes(q.standardRef)) return false;
        if (q.modelRef && !haystack.includes(q.modelRef)) return false;
        return true;
      });
      matched.sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || a.registryNumber.localeCompare(b.registryNumber));
      return { records: matched.slice(0, q.limit), total: matched.length };
    },
    async history(recordId) {
      return changes.filter((c) => c.recordId === recordId);
    },
  };
}
