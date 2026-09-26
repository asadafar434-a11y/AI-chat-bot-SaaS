// Копия данных — файлом: всё, что лежит в браузере, — закупки с текстами документов, реквизиты, образцы.
// Модуль без зависимостей: формат проверяют тесты без сборки (npm test). Чтение и запись баз — в backup.ts.

export const BACKUP_FORMAT = "tender-lawyer-backup";
export const BACKUP_VERSION = 1;

// Ключи в хранилищах без keyPath: документы закупки — по номеру закупки, настройки — по имени.
export type Dump = {
  purchases: { id: string }[];
  documents: [string, unknown[]][];
  settings: [string, unknown][];
  samples: { id: string }[];
};

export type Backup = Dump & { format: typeof BACKUP_FORMAT; version: number; savedAt: string };

// Из настроек в копию и обратно идут только реквизиты: остальное браузер заведёт сам.
const SETTING_KEYS = new Set(["profile", "profile-meta"]);

export const buildBackup = (dump: Dump, now = new Date()): Backup => ({
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION,
  savedAt: now.toISOString(),
  purchases: dump.purchases,
  documents: dump.documents,
  settings: dump.settings.filter(([key]) => SETTING_KEYS.has(key)),
  samples: dump.samples,
});

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const withId = (x: unknown): x is { id: string } => isObject(x) && typeof x.id === "string" && x.id.length > 0;

export type Parsed = { ok: true; dump: Dump } | { ok: false; reason: string };

// Файл выбирает пользователь — берём только то, что похоже на нашу копию, остальное отбрасываем.
export function parseBackup(raw: unknown): Parsed {
  if (!isObject(raw) || raw.format !== BACKUP_FORMAT) return { ok: false, reason: "Это не копия данных «Тендерного юриста»." };
  if (raw.version !== BACKUP_VERSION) return { ok: false, reason: "Копия сделана другой версией приложения — её пока не прочитать." };
  const list = (x: unknown) => (Array.isArray(x) ? x : []);
  const purchases = list(raw.purchases).filter(withId);
  const samples = list(raw.samples).filter(withId);
  const documents = list(raw.documents).filter(
    (e): e is [string, unknown[]] => Array.isArray(e) && typeof e[0] === "string" && Array.isArray(e[1])
  );
  const settings = list(raw.settings).filter(
    (e): e is [string, unknown] => Array.isArray(e) && typeof e[0] === "string" && SETTING_KEYS.has(e[0]) && isObject(e[1])
  );
  if (!purchases.length && !samples.length && !settings.length) return { ok: false, reason: "В копии нет данных." };
  return { ok: true, dump: { purchases, documents, settings, samples } };
}

// Реквизиты вписаны, если заполнено хоть одно поле.
export const profileFilled = (profile: unknown) =>
  isObject(profile) && Object.values(profile).some((value) => typeof value === "string" && value.trim() !== "");

// Что уже есть в этом браузере: номера закупок и образцов, вписаны ли реквизиты.
export type Present = { purchases: Set<string>; samples: Set<string>; profile: boolean };

// Загрузка копии ничего не затирает: добавляет закупки и образцы, которых здесь нет, и реквизиты, если здесь они пустые.
// Так старую копию можно загрузить и поверх свежих данных — пропавшее вернётся, сделанное после копии останется.
export function missingFrom(dump: Dump, present: Present): Dump {
  const purchases = dump.purchases.filter((p) => !present.purchases.has(p.id));
  const added = new Set(purchases.map((p) => p.id));
  return {
    purchases,
    documents: dump.documents.filter(([id]) => added.has(id)),
    settings: present.profile ? [] : dump.settings,
    samples: dump.samples.filter((s) => !present.samples.has(s.id)),
  };
}
