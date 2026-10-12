// Тестовые данные реестра. Номера вида «00000001» не бывают настоящими (настоящие начинаются с «10…»), а предприятия
// названы «ТЕСТОВОЕ»: фикстуру нельзя принять за реальную запись и подставить в заявку.
import type { Cell, RawRow } from "@/lib/registry-format";
import { hashRecord } from "@/lib/registry-format";
import { createMemoryRegistryStore } from "@/lib/registry-store";
import type { RegistryBasis, RegistryKind, RegistryRecordData, StoredRegistryRecord } from "@/lib/registry-types";

export const FIXTURE_HEADER = [
  "Предприятие",
  "ИНН",
  "ОГРН",
  "Фактический адрес производителя",
  "Адрес производственных помещений",
  "Первичный регистрационный номер реестровой записи",
  "Реестровый номер",
  "Номер цифрового паспорта",
  "Дата внесения в реестр",
  "Срок действия",
  "Фактическая дата прекращения действия реестровой записи",
  "Наименование продукции",
  "ОКПД2",
  "ТН ВЭД",
  "Изготовлена по",
  "Баллы",
  "Процентный показатель",
  "О соответствии",
  "Искусственный интеллект",
  "Высокотехнологичное оборудование",
  "Доверенный ПАК",
  "Основание: Наименование",
  "Основание: Дата",
  "Основание: Номер",
  "Основание: Срок действия",
  "Заключение: Департамент",
  "Заключение: Номер заключения",
  "Заключение: Документ",
];

/** Число Excel для даты «ГГГГ-ММ-ДД». */
export const serial = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
};

export type FixtureRowInput = {
  number: string;
  name?: string;
  enterprise?: string;
  inn?: string;
  okpd2?: string;
  madeBy?: string;
  added?: string;
  until?: string;
  basisNumber?: string;
  basisName?: string;
  basisDate?: string;
  points?: number;
};

/** Строка выгрузки в порядке колонок настоящего файла. */
export function fixtureRow(input: FixtureRowInput): Cell[] {
  const cells: Cell[] = FIXTURE_HEADER.map(() => undefined);
  const set = (name: string, value: Cell) => (cells[FIXTURE_HEADER.indexOf(name)] = value);
  set("Предприятие", input.enterprise ?? 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ "ПЕРВОЕ"');
  set("ИНН", input.inn ?? "9900000001");
  set("ОГРН", "9990000000001");
  set("Реестровый номер", input.number);
  set("Дата внесения в реестр", serial(input.added ?? "2026-09-01"));
  set("Срок действия", serial(input.until ?? "2029-09-01"));
  set("Наименование продукции", input.name ?? "Тестовое кресло офисное");
  set("ОКПД2", input.okpd2 ?? "31.01.12.160");
  set("ТН ВЭД", "9401 30 000 0");
  set("Изготовлена по", input.madeBy);
  set("Баллы", input.points);
  set("Искусственный интеллект", false);
  set("Высокотехнологичное оборудование", false);
  set("Доверенный ПАК", false);
  set("Основание: Наименование", input.basisName ?? "СТ-1");
  set("Основание: Дата", serial(input.basisDate ?? input.added ?? "2026-09-01"));
  set("Основание: Номер", input.basisNumber ?? `ТЕСТ-${input.number}`);
  set("Заключение: Департамент", "Тестовый департамент");
  return cells;
}

/** Строки как их отдаёт читатель файла: сначала строки до заголовка, потом заголовок, потом данные. */
export async function* asRows(preface: Cell[][], rows: Cell[][], header: Cell[] = FIXTURE_HEADER): AsyncGenerator<RawRow> {
  let rowNumber = 0;
  for (const cells of [...preface, header, ...rows]) yield { rowNumber: ++rowNumber, cells };
}

export const PREFACE: Cell[][] = [["Время выгрузки: 11.10.2026, 01:00:10"], []];

const emptyBasis: RegistryBasis = {
  name: "СТ-1",
  number: "ТЕСТ-1",
  date: "2026-09-01",
  validUntil: null,
  addedAt: "2026-09-01",
  recordValidUntil: "2029-09-01",
  conclusionNumber: null,
  conclusionUrl: null,
};

/** Запись реестра для проверки сопоставления. Всё, что не задано, — пусто, а не придумано. */
export function fixtureRecord(over: Partial<RegistryRecordData> & { registryNumber: string } & Partial<Pick<StoredRegistryRecord, "status" | "id">>): StoredRegistryRecord {
  const { status, id, ...rest } = over;
  const data: Omit<RegistryRecordData, "rowHash"> = {
    registryKind: "gisp_rpp_719",
    enterpriseName: 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ "ПЕРВОЕ"',
    inn: "9900000001",
    ogrn: null,
    productName: "Тестовое кресло офисное",
    okpd2: "31.01.12.160",
    tnved: null,
    madeBy: null,
    digitalPassport: null,
    primaryNumber: null,
    addedAt: "2026-09-01",
    validUntil: "2029-09-01",
    validUntilMin: "2029-09-01",
    terminatedAt: null,
    points: null,
    percent: null,
    conformity: null,
    department: null,
    flags: { ai: false, highTech: false, trustedPak: false },
    bases: [emptyBasis],
    ...rest,
  };
  return { ...data, rowHash: hashRecord(data), id: id ?? `rec-${data.registryNumber}`, status: status ?? "active", firstSeenDatasetId: "ds1", lastSeenDatasetId: "ds1" };
}

/** Хранилище с одной загруженной выгрузкой и заданными записями. */
export async function seededStore(records: StoredRegistryRecord[], exportedAt = "2026-10-10T22:00:10.000Z", kind: RegistryKind = "gisp_rpp_719", into = createMemoryRegistryStore()) {
  const store = into;
  const dataset = await store.beginDataset({
    registryKind: kind,
    formatVersion: "gisp-v2",
    fileName: "fixture.xlsx",
    fileSha256: `fixture-sha-${kind}`,
    exportedAt,
    importedBy: "тест",
    now: new Date(exportedAt),
  });
  await store.insertRecords(dataset.id, records);
  // Вставка всегда делает запись действующей; пропавшие из выгрузки (absent) выставляем отдельно.
  for (const r of records) {
    const key = `${r.registryKind}\n${r.registryNumber}`;
    if (r.status === "absent") store.records.set(key, { ...store.records.get(key)!, status: "absent" });
  }
  await store.finishDataset(
    dataset.id,
    "completed",
    {
      rowsRead: records.length, rowsSkipped: 0, rowsFailed: 0, recordsAdded: records.length, recordsChanged: 0, recordsUnchanged: 0, recordsReturned: 0,
      recordsAbsent: 0, multiRowRecords: 0, differingValidity: 0, warnings: {}, samples: [], absentSkippedReason: null, unknownColumns: [], alreadyImported: false,
    },
    new Date(exportedAt),
  );
  return store;
}
