// Данные приложения лежат в IndexedDB этого браузера, в трёх базах: закупки с текстами документов — в одной, реквизиты
// и образцы участника — во второй, база доказательств компании (факты с источниками и сроками действия) — в третьей.
// Новые хранилища заводятся новой базой, а не повышением версии: обновление версии ждёт, пока закроются все старые вкладки,
// и может зависнуть.
// Формат самих записей — номер в каждой записи и миграции при чтении — в data-format.ts.
const DATABASES = {
  "tender-lawyer": [
    ["purchases", { keyPath: "id" }],
    ["documents", undefined],
  ],
  "tender-lawyer-me": [
    ["settings", undefined],
    ["samples", { keyPath: "id" }],
  ],
  "tender-lawyer-evidence": [["facts", { keyPath: "id" }]],
} as const satisfies Record<string, readonly (readonly [string, IDBObjectStoreParameters | undefined])[]>;

type DbName = keyof typeof DATABASES;
type StoreName = (typeof DATABASES)[DbName][number][0];

export const STORES = { purchases: "purchases", documents: "documents", settings: "settings", samples: "samples", facts: "facts" } as const;

const dbOf = (store: StoreName): DbName =>
  (Object.keys(DATABASES) as DbName[]).find((db) => DATABASES[db].some(([name]) => name === store))!;

const opening = new Map<DbName, Promise<IDBDatabase>>();

function open(name: DbName): Promise<IDBDatabase> {
  let promise = opening.get(name);
  if (!promise) {
    promise = new Promise<IDBDatabase>((resolve, reject) => {
      // Без номера версии: новая база создаётся первой версией, а существующая открывается той,
      // какая есть, — даже если её когда-то обновили.
      const request = indexedDB.open(name);
      request.onupgradeneeded = () => {
        for (const [store, options] of DATABASES[name]) {
          if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store, options);
        }
      };
      request.onsuccess = () => {
        // Если когда-нибудь база обновится в другой вкладке, эта не должна мешать обновлению.
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    }).catch((error) => {
      opening.delete(name);
      throw error;
    });
    opening.set(name, promise);
  }
  return promise;
}

// Сайдбар показывает закупки и «Мои данные» и перечитывает их после каждой записи.
const CHANGED = "tender-data-changed";

export function onDataChanged(listener: () => void) {
  window.addEventListener(CHANGED, listener);
  return () => window.removeEventListener(CHANGED, listener);
}

// Все хранилища одной транзакции должны лежать в одной базе.
export async function transaction<T>(
  stores: StoreName[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => IDBRequest<T> | void
): Promise<T> {
  const db = await open(dbOf(stores[0]));
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const request = run(tx);
    tx.oncomplete = () => {
      resolve(request ? request.result : (undefined as T));
      if (mode === "readwrite") window.dispatchEvent(new Event(CHANGED));
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// Удаляет все базы целиком — «Удалить все мои данные». Свои соединения закрываем сразу; открытые в других вкладках
// закроются сами (onversionchange), а если вкладка не отпускает базу — удаление дождётся её закрытия.
export async function deleteDatabases(): Promise<"done" | "blocked"> {
  for (const promise of opening.values()) {
    try {
      (await promise).close();
    } catch {
      // Не открылась — закрывать нечего.
    }
  }
  opening.clear();
  const results = await Promise.all(
    (Object.keys(DATABASES) as DbName[]).map(
      (name) =>
        new Promise<"done" | "blocked">((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve("done");
          request.onerror = () => reject(request.error);
          request.onblocked = () => resolve("blocked");
        })
    )
  );
  return results.includes("blocked") ? "blocked" : "done";
}
