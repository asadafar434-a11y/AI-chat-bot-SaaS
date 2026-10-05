import { notifyDataChanged } from "@/lib/data-events";
import { formatOf, type RecordKind } from "@/lib/data-format";
import { buildBackup, missingFrom, profileFilled, type Backup, type Dump } from "@/lib/backup-format";
import { STORES, transaction } from "@/lib/db";
import { fetchDocumentMetas, fetchFacts, fetchProfile, fetchPurchases, fetchSamples, serverReadsEnabled } from "@/lib/server-reads";
import { postServerWrite, serverWritesEnabled } from "@/lib/server-writes";

// Копия данных. Правила — что попадает в копию и что из неё записывается — в backup-format.ts.
//
// S11 Final Read Cutover: авторитетные данные лежат на сервере (PostgreSQL + S6), поэтому
// «Сохранить копию» собирает копию из серверного чтения, а «Загрузить копию» дополнительно
// переносит её на сервер через существующий конвейер S3 (`/api/writes/import`). IndexedDB
// остаётся зеркалом S5 dual-write и локальным восстановлением. Серверного фолбэка нет.

// Номер формата записи — как `toStore` в data-format.ts: копия переносится без ложных миграций.
const withVersion = <T extends object>(kind: RecordKind, record: T): T & { v: number } => ({ ...record, v: formatOf(kind) });

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

export type ExportCounts = { purchases: number; samples: number; facts: number; profile: boolean };

// Копия из серверного чтения: закупки, документы с текстом и картой из S6, образцы, факты,
// реквизиты и метаданные профиля. Документ без текста в S6 в копию не попадает — «пустого»
// документа в файле не появляется.
async function exportServerBackup(): Promise<{ backup: Backup } & ExportCounts> {
  const [purchases, samples, facts, profileResponse] = await Promise.all([
    fetchPurchases(),
    fetchSamples(),
    fetchFacts(),
    fetchProfile(),
  ]);

  const documents: [string, unknown[]][] = [];
  for (const purchase of purchases) {
    const metas = await fetchDocumentMetas(purchase.id);
    documents.push([
      purchase.id,
      metas
        .filter((meta) => meta.text !== null)
        .map((meta) =>
          withVersion("document", {
            name: meta.name,
            text: meta.text,
            ...(meta.scan && { scan: true }),
            ...(meta.map && { map: meta.map }),
          }),
        ),
    ]);
  }

  const settings: [string, unknown][] = [];
  const profile = profileFilled(profileResponse.profile);
  if (profile) {
    settings.push(["profile", withVersion("profile", profileResponse.profile)]);
  }
  settings.push([
    "profile-meta",
    withVersion("profileMeta", { sources: profileResponse.meta.sources, suggestions: profileResponse.meta.suggestions }),
  ]);

  const dump: Dump = {
    purchases: purchases.map((purchase) => withVersion("purchase", purchase)),
    documents,
    settings,
    samples: samples.map((sample) =>
      withVersion("myDocument", {
        id: sample.id,
        name: sample.name ?? "",
        text: sample.text ?? "",
        addedAt: sample.addedAt ?? "",
        kinds: sample.kinds,
        about: sample.about,
        ...(sample.scan && { scan: true }),
        ...(sample.map && { map: sample.map }),
      }),
    ),
    facts: facts.map((fact) => withVersion("fact", fact)),
  };

  return {
    backup: buildBackup(dump),
    purchases: purchases.length,
    samples: samples.length,
    facts: facts.length,
    profile,
  };
}

async function exportLocalBackup(): Promise<{ backup: Backup } & ExportCounts> {
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

export async function exportBackup(): Promise<{ backup: Backup } & ExportCounts> {
  return serverReadsEnabled() ? exportServerBackup() : exportLocalBackup();
}

// Записывает из копии только то, чего в браузере нет: ничего из сделанного здесь не затирается.
// Записи кладутся как есть, со своим номером формата: старые догонят текущий формат при чтении (data-format.ts).
async function restoreLocalBackup(dump: Dump): Promise<ExportCounts> {
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
  return {
    purchases: add.purchases.length,
    samples: add.samples.length,
    facts: add.facts.length,
    profile: add.settings.some(([key]) => key === "profile"),
  };
}

/**
 * Загрузка копии: локально (S5-зеркало) и — при включённой серверной записи — на сервер
 * существующим конвейером S3 (`/api/writes/import`), чтобы данные стали видны серверному
 * чтению на любом устройстве. Повтор идемпотентен: эквивалентные записи не перезаписываются.
 */
export async function restoreBackup(dump: Dump): Promise<ExportCounts> {
  const added = await restoreLocalBackup(dump);
  if (serverWritesEnabled()) {
    await postServerWrite("/api/writes/import", "PUT", { backup: buildBackup(dump) });
  }
  notifyDataChanged();
  return added;
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
