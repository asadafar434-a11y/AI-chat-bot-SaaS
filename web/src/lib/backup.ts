import { buildBackup, missingFrom, profileFilled, type Backup, type Dump } from "@/lib/backup-format";
import { STORES, transaction } from "@/lib/db";

// Копия данных браузера файлом и обратно. Правила — что попадает в копию и что из неё записывается — в backup-format.ts.

// Хранилища без keyPath: ключи и значения читаются в одной транзакции, чтобы пары не разъехались.
async function pairs(store: typeof STORES.documents | typeof STORES.settings): Promise<[string, unknown][]> {
  let keys: IDBRequest<IDBValidKey[]> | undefined;
  const values = await transaction<unknown[]>([store], "readonly", (tx) => {
    keys = tx.objectStore(store).getAllKeys();
    return tx.objectStore(store).getAll();
  });
  return keys!.result.map((key, i) => [String(key), values[i]]);
}

const ids = async (store: typeof STORES.purchases | typeof STORES.samples | typeof STORES.facts) =>
  new Set((await transaction<IDBValidKey[]>([store], "readonly", (tx) => tx.objectStore(store).getAllKeys())).map(String));

export async function exportBackup(): Promise<{ backup: Backup; purchases: number; samples: number; facts: number; profile: boolean }> {
  const [purchases, samples, facts, documents, settings] = await Promise.all([
    transaction<{ id: string }[]>([STORES.purchases], "readonly", (tx) => tx.objectStore(STORES.purchases).getAll()),
    transaction<{ id: string }[]>([STORES.samples], "readonly", (tx) => tx.objectStore(STORES.samples).getAll()),
    transaction<{ id: string }[]>([STORES.facts], "readonly", (tx) => tx.objectStore(STORES.facts).getAll()),
    pairs(STORES.documents),
    pairs(STORES.settings),
  ]);
  const dump: Dump = { purchases, samples, facts, documents: documents as [string, unknown[]][], settings };
  const profile = profileFilled(settings.find(([key]) => key === "profile")?.[1]);
  return { backup: buildBackup(dump), purchases: purchases.length, samples: samples.length, facts: facts.length, profile };
}

// Записывает из копии только то, чего в браузере нет: ничего из сделанного здесь не затирается.
// Записи кладутся как есть, со своим номером формата: старые догонят текущий формат при чтении (data-format.ts).
export async function restoreBackup(dump: Dump): Promise<{ purchases: number; samples: number; facts: number; profile: boolean }> {
  const [purchases, samples, facts, profile] = await Promise.all([
    ids(STORES.purchases),
    ids(STORES.samples),
    ids(STORES.facts),
    transaction<unknown>([STORES.settings], "readonly", (tx) => tx.objectStore(STORES.settings).get("profile")),
  ]);
  const add = missingFrom(dump, { purchases, samples, facts, profile: profileFilled(profile) });
  if (add.purchases.length) {
    await transaction<void>([STORES.purchases, STORES.documents], "readwrite", (tx) => {
      for (const p of add.purchases) tx.objectStore(STORES.purchases).put(p);
      for (const [id, docs] of add.documents) tx.objectStore(STORES.documents).put(docs, id);
    });
  }
  if (add.samples.length || add.settings.length) {
    await transaction<void>([STORES.settings, STORES.samples], "readwrite", (tx) => {
      for (const [key, value] of add.settings) tx.objectStore(STORES.settings).put(value, key);
      for (const s of add.samples) tx.objectStore(STORES.samples).put(s);
    });
  }
  if (add.facts.length) {
    await transaction<void>([STORES.facts], "readwrite", (tx) => {
      for (const f of add.facts) tx.objectStore(STORES.facts).put(f);
    });
  }
  return { purchases: add.purchases.length, samples: add.samples.length, facts: add.facts.length, profile: add.settings.some(([key]) => key === "profile") };
}

// Браузер не сотрёт данные сайта сам, если разрешит постоянное хранилище. Safari может стереть их,
// если сайт не открывать 7 дней, — от этого спасает только копия.
export async function askPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) await navigator.storage.persist?.();
  } catch {
    // Не дали — остаётся копия файлом.
  }
}
