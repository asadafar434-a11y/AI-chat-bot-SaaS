import { CONSENT_KEY } from "@/lib/consent";
import { deleteDatabases } from "@/lib/db";
import { SEEN_KEY } from "@/lib/notifications";
import { SCAN_OCR_KEY } from "@/lib/scan-setting";

// «Удалить все мои данные»: закупки с документами, реквизиты, образцы, настройки, отметки о прочитанных уведомлениях
// и отметка о согласии — всё, что сервис хранит в этом браузере. Сервер ничего не хранит; куки с отметкой о входе
// остаётся — в ней нет данных.
export async function wipeAll(): Promise<"done" | "blocked"> {
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
  return result;
}
