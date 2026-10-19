import { STORES, transaction } from "@/lib/db";

// Excel-бланки заказчика, как они пришли: в них приложение вписывает реквизиты и сведения о товарах (lib/xlsx-form.ts). Лежат в браузере, отдельной базой:
// «Удалить все данные» стирает её вместе с остальными. Файл берётся из закупки при загрузке; на другом устройстве его нет — тогда бланк добавляют заново.
const FORMS = STORES.forms;

export const MAX_FORM_BYTES = 3 * 1024 * 1024;
/** Вписывать умеем только в файлы нового формата (.xlsx, .xlsm); старый .xls — другой формат. */
export const isOpenXmlName = (name: string) => /\.xls[xm]$/i.test(name);

export type StoredForm = { id: string; purchaseId: string; name: string; size: number; savedAt: string; bytes: ArrayBuffer; prices?: Record<string, string> };
export type FormMeta = { name: string; size: number; savedAt: string };

const keyOf = (purchaseId: string, name: string) => `${purchaseId}/${name}`;

export async function saveForm(purchaseId: string, name: string, bytes: ArrayBuffer): Promise<void> {
  // Тот же файл добавили ещё раз (новая версия): введённые цены остаются.
  const before = await transaction<StoredForm | undefined>([FORMS], "readonly", (tx) => tx.objectStore(FORMS).get(keyOf(purchaseId, name)));
  const record: StoredForm = {
    id: keyOf(purchaseId, name),
    purchaseId,
    name,
    size: bytes.byteLength,
    savedAt: new Date().toISOString(),
    bytes,
    ...(before?.prices && { prices: before.prices }),
  };
  await transaction<void>([FORMS], "readwrite", (tx) => {
    tx.objectStore(FORMS).put(record);
  });
}

export async function listForms(purchaseId: string): Promise<FormMeta[]> {
  const all = await transaction<StoredForm[]>([FORMS], "readonly", (tx) => tx.objectStore(FORMS).getAll());
  return all
    .filter((f) => f.purchaseId === purchaseId)
    .map(({ name, size, savedAt }) => ({ name, size, savedAt }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

export async function getForm(purchaseId: string, name: string): Promise<Uint8Array | undefined> {
  const record = await transaction<StoredForm | undefined>([FORMS], "readonly", (tx) => tx.objectStore(FORMS).get(keyOf(purchaseId, name)));
  return record ? new Uint8Array(record.bytes) : undefined;
}

export async function deleteForm(purchaseId: string, name: string): Promise<void> {
  await transaction<void>([FORMS], "readwrite", (tx) => {
    tx.objectStore(FORMS).delete(keyOf(purchaseId, name));
  });
}

export async function deleteFormsOf(purchaseId: string): Promise<void> {
  const all = await transaction<StoredForm[]>([FORMS], "readonly", (tx) => tx.objectStore(FORMS).getAll());
  const mine = all.filter((f) => f.purchaseId === purchaseId);
  if (mine.length === 0) return;
  await transaction<void>([FORMS], "readwrite", (tx) => {
    for (const f of mine) tx.objectStore(FORMS).delete(f.id);
  });
}

/** Сохраняет файлы Excel из загруженного: большие и не Excel пропускает. Ошибки хранилища не мешают закупке: бланк можно добавить позже. */
export async function saveExcelFiles(purchaseId: string, files: File[]): Promise<string[]> {
  const saved: string[] = [];
  for (const file of files) {
    if (!isOpenXmlName(file.name) || file.size > MAX_FORM_BYTES) continue;
    try {
      await saveForm(purchaseId, file.name, await file.arrayBuffer());
      saved.push(file.name);
    } catch {
      // хранилище не отвечает — закупка остаётся как есть
    }
  }
  return saved;
}

// Цены за единицу, которые участник ввёл сам для строк бланка (ключ «лист!ячейка» → число как написано): лежат рядом с файлом, в той же базе.
export type StoredPrices = Record<string, string>;

export async function getPrices(purchaseId: string, name: string): Promise<StoredPrices> {
  const record = await transaction<StoredForm | undefined>([FORMS], "readonly", (tx) => tx.objectStore(FORMS).get(keyOf(purchaseId, name)));
  return record?.prices ?? {};
}

export async function savePrices(purchaseId: string, name: string, prices: StoredPrices): Promise<void> {
  const record = await transaction<StoredForm | undefined>([FORMS], "readonly", (tx) => tx.objectStore(FORMS).get(keyOf(purchaseId, name)));
  if (!record) return;
  await transaction<void>([FORMS], "readwrite", (tx) => {
    tx.objectStore(FORMS).put({ ...record, prices });
  });
}
