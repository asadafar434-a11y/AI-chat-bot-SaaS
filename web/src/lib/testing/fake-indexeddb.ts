/**
 * Минимальный in-memory IndexedDB для тестов dual-write S5.
 *
 * Позволяет выполнять НАСТОЯЩИЕ функции хранилищ (`savePurchase`,
 * `saveMyDocuments`, …) в node: они идут через `transaction()` из `db.ts`,
 * которому достаточно `indexedDB.open`, транзакций на 1–2 хранилища и
 * `get/put/delete/getAll/getAllKeys`. Курсор не поддерживается (наши пути
 * его не используют) — обращение к нему бросает явно.
 *
 * Схема хранилищ зеркалит `DATABASES` из `db.ts:6-16`; расхождение сломает
 * тесты громко, а не тихо. `window` подменяется минимальным стабом только
 * ради `dispatchEvent`/`addEventListener`.
 */

type StoreRow = { key: unknown; value: unknown };

class FakeRequest {
  result: unknown = undefined;
  error: unknown = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
}

class FakeStore {
  readonly rows = new Map<unknown, unknown>();
  private readonly keyPath: string | undefined;

  constructor(keyPath: string | undefined) {
    this.keyPath = keyPath;
  }

  keyOf(value: unknown, explicit: unknown): unknown {
    if (explicit !== undefined) {
      return explicit;
    }
    if (this.keyPath !== undefined && value !== null && typeof value === "object") {
      return (value as Record<string, unknown>)[this.keyPath];
    }
    throw new Error("fake-indexeddb: нет ключа для put");
  }

  get(key: unknown): FakeRequest {
    const request = new FakeRequest();
    request.result = this.rows.get(key);
    return request;
  }

  getAll(): FakeRequest {
    const request = new FakeRequest();
    request.result = [...this.rows.values()];
    return request;
  }

  getAllKeys(): FakeRequest {
    const request = new FakeRequest();
    request.result = [...this.rows.keys()];
    return request;
  }

  put(value: unknown, key?: unknown): FakeRequest {
    const request = new FakeRequest();
    this.rows.set(this.keyOf(value, key), value);
    return request;
  }

  delete(key: unknown): FakeRequest {
    const request = new FakeRequest();
    this.rows.delete(key);
    return request;
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  error: unknown = null;

  private readonly stores: Map<string, FakeStore>;

  constructor(stores: Map<string, FakeStore>) {
    this.stores = stores;
  }

  objectStore(name: string): FakeStore {
    const store = this.stores.get(name);
    if (!store) {
      throw new Error(`fake-indexeddb: нет хранилища ${name}`);
    }
    return store;
  }
}

class FakeDatabase {
  readonly stores = new Map<string, FakeStore>();
  onversionchange: (() => void) | null = null;

  readonly objectStoreNames = {
    contains: (name: string): boolean => this.stores.has(name),
  };

  createObjectStore(name: string, options?: { keyPath?: string | null }): void {
    const keyPath = options?.keyPath;
    this.stores.set(name, new FakeStore(typeof keyPath === "string" ? keyPath : undefined));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  transaction(names: string[], _mode: string): FakeTransaction {
    for (const name of names) {
      if (!this.stores.has(name)) {
        throw new Error(`fake-indexeddb: нет хранилища ${name}`);
      }
    }
    const tx = new FakeTransaction(this.stores);
    // db.ts назначает oncomplete синхронно после run(tx): микрозадача
    // срабатывает уже после присваивания.
    queueMicrotask(() => tx.oncomplete?.());
    return tx;
  }

  close(): void {}
}

export type FakeIndexedDb = {
  /** Очистить все хранилища между тестами (соединения `db.ts` переживают сброс). */
  reset(): void;
  /** Содержимое хранилища для проверок. */
  rows(dbName: string, storeName: string): StoreRow[];
  /** Вернуть настоящие `indexedDB`/`window`. */
  uninstall(): void;
};

export function installFakeIndexedDB(): FakeIndexedDb {
  const previousIndexedDb = (globalThis as Record<string, unknown>).indexedDB;
  const previousWindow = (globalThis as Record<string, unknown>).window;
  const databases = new Map<string, FakeDatabase>();

  const open = (name: string) => {
    const request = new FakeRequest() as FakeRequest & {
      result: FakeDatabase;
      onupgradeneeded: (() => void) | null;
    };
    const existing = databases.get(name);
    if (existing) {
      queueMicrotask(() => {
        request.result = existing;
        request.onsuccess?.();
      });
      return request;
    }
    const created = new FakeDatabase();
    databases.set(name, created);
    queueMicrotask(() => {
      request.result = created;
      // Созданием хранилищ занимается обработчик вызывающего кода
      // (db.ts через createObjectStore), как в настоящем IndexedDB.
      request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  };

  (globalThis as Record<string, unknown>).indexedDB = { open };
  (globalThis as Record<string, unknown>).window = {
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  return {
    reset() {
      for (const db of databases.values()) {
        for (const store of db.stores.values()) {
          store.rows.clear();
        }
      }
    },
    rows(dbName: string, storeName: string): StoreRow[] {
      const store = databases.get(dbName)?.stores.get(storeName);
      if (!store) {
        return [];
      }
      return [...store.rows.entries()].map(([key, value]) => ({ key, value }));
    },
    uninstall() {
      (globalThis as Record<string, unknown>).indexedDB = previousIndexedDb;
      (globalThis as Record<string, unknown>).window = previousWindow;
    },
  };
}
