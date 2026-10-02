import { NO_ANTI_DUMPING, PLAIN_FORM } from "@/lib/tp";

// Формат записей в браузере. Закупки, документы и реквизиты лежат в IndexedDB, а их структура меняется от версии
// к версии приложения. Поэтому у каждой записи есть номер формата v: при чтении старая запись проходит миграции
// по порядку — 1 → 2 → … → текущий, — а записывается всегда текущий формат. Записи без номера — первый формат:
// так сохранено всё, что было до его появления.
//
// Изменили структуру записи — добавьте миграцию в конец её списка: номер формата вырастет сам.
// Номер формата живёт только в базе: читающий код получает запись без него.

type Row = Record<string, unknown>;
export type Migration = (row: Row) => Row;

const MIGRATIONS = {
  purchase: [
    // 1 → 2. Первые черновики ТП хранились списком пунктов — такие закупки открываются как ТП без формы заказчика.
    (p) => (Array.isArray(p.tp) ? { ...p, tp: { form: PLAIN_FORM, goods: [], items: p.tp, antiDumping: NO_ANTI_DUMPING } } : p),
  ],
  // Тексты документов закупки.
  document: [],
  myDocument: [
    // 1 → 2. Сначала здесь лежали только образцы ТП — без видов и описания.
    (d) => ({
      ...d,
      kinds: Array.isArray(d.kinds) && d.kinds.length > 0 ? d.kinds : ["tp"],
      about: typeof d.about === "string" ? d.about : "",
    }),
  ],
  profile: [],
  profileMeta: [],
  // Факты базы доказательств компании (evidence-base.ts).
  fact: [],
} satisfies Record<string, Migration[]>;

export type RecordKind = keyof typeof MIGRATIONS;

export const formatOf = (kind: RecordKind) => MIGRATIONS[kind].length + 1;

// Запись новее приложения сохранила вкладка с более свежей версией, а эта открыта давно. Такую запись старый код
// может понять неверно, а сохранив — испортить, поэтому он её не читает и просит обновить страницу.
export class NewerDataError extends Error {
  constructor() {
    super("Данные сохранены более новой версией приложения — обновите страницу.");
    this.name = "NewerDataError";
  }
}

const versionOf = (raw: unknown) => {
  const v = (raw as Row | null)?.v;
  return typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : 1;
};

export const isNewer = (kind: RecordKind, raw: unknown) => versionOf(raw) > formatOf(kind);

// Запись — в текущий формат: миграции с её номера и до конца списка. Номер формата наружу не выходит.
export function migrate<T>(raw: unknown, migrations: readonly Migration[]): T {
  const from = versionOf(raw);
  if (from > migrations.length + 1) throw new NewerDataError();
  const row: Row = { ...(raw as Row) };
  delete row.v;
  return migrations.slice(from - 1).reduce((acc, step) => step(acc), row) as T;
}

// Из базы — в текущий формат.
export const fromStore = <T>(kind: RecordKind, raw: unknown): T => migrate<T>(raw, MIGRATIONS[kind]);

// В базу — с номером текущего формата.
export const toStore = <T extends object>(kind: RecordKind, record: T): T & { v: number } => ({ ...record, v: formatOf(kind) });
