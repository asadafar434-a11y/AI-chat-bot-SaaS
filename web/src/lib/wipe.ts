import { notifyDataChanged } from "@/lib/data-events";
import { CONSENT_KEY } from "@/lib/consent";
import { deleteDatabases } from "@/lib/db";
import { SEEN_KEY } from "@/lib/notifications";
import { SCAN_OCR_KEY } from "@/lib/scan-setting";
import { postServerWrite, serverWritesEnabled } from "@/lib/server-writes";

// «Удалить все мои данные»: серверное удаление (PostgreSQL + S6) — источник истины,
// затем очистка локального зеркала этого браузера (IndexedDB, настройки, согласие).
// Сервер сам решает объём по роли: owner — данные организации, member — только личные.
// При включённой серверной записи ошибка сервера пробрасывается: локальное зеркало не
// очищается, чтобы не создать видимость успешного удаления.
export async function wipeAll(): Promise<"done" | "blocked"> {
  if (serverWritesEnabled()) {
    await postServerWrite("/api/writes/wipe", "POST", {});
  }
  const result = await deleteDatabases();
  for (const [store, key] of [
    [() => window.localStorage, CONSENT_KEY],
    [() => window.localStorage, SCAN_OCR_KEY],
    [() => window.localStorage, SEEN_KEY],
  ] as const) {
    try {
      store().removeItem(key);
    } catch {
      // Хранилище недоступно — в нём и нечего удалять.
    }
  }
  notifyDataChanged();
  return result;
}
