// Связь страницы «Поиск закупок» с расширением Chrome «Тендекс — поиск закупок в ЕИС» (extension/eis-bridge). Расширение стоит у пользователя, открывает поиск ЕИС в фоновой вкладке,
// читает страницу и возвращает таблицу; наш сервер в ЕИС не ходит. Есть ли расширение, видно по атрибуту на <html>; поиск — сообщением в страницу, ответ — тоже сообщением.

export const EXTENSION_ATTR = "data-tl-eis-extension";

export type ExtensionResult = { tsv: string; pages: number; count: number };

type Listener = (e: MessageEvent) => void;
export type BridgeWindow = {
  location: { origin: string };
  postMessage: (message: unknown, targetOrigin: string) => void;
  addEventListener: (type: "message", listener: Listener) => void;
  removeEventListener: (type: "message", listener: Listener) => void;
};

type AttrDoc = { documentElement: { getAttribute: (name: string) => string | null } };

/** Версия расширения, если оно стоит и подключилось к этой странице; иначе null. */
export function extensionVersion(doc: AttrDoc | undefined = typeof document === "undefined" ? undefined : document): string | null {
  const v = doc?.documentElement.getAttribute(EXTENSION_ATTR);
  return v && v.trim() !== "" ? v.trim() : null;
}

const newRequestId = () => `eis-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Поиск в ЕИС через расширение: ссылка из eisOrdersUrl, страниц до трёх (по 50 закупок). Ошибка — словами, которые можно показать участнику. */
export function searchViaExtension(
  url: string,
  pages = 3,
  opts: { win?: BridgeWindow; timeoutMs?: number; newId?: () => string } = {},
): Promise<ExtensionResult> {
  const win = opts.win ?? (typeof window === "undefined" ? undefined : (window as unknown as BridgeWindow));
  if (!win) return Promise.reject(new Error("Нет окна браузера."));
  const id = (opts.newId ?? newRequestId)();
  const timeoutMs = opts.timeoutMs ?? 150_000;
  return new Promise<ExtensionResult>((resolve, reject) => {
    const done = (fn: () => void) => {
      clearTimeout(timer);
      win.removeEventListener("message", listener);
      fn();
    };
    const listener: Listener = (e) => {
      const d = e.data as { type?: string; requestId?: string; error?: string; tsv?: string; pages?: number; count?: number } | null;
      if (!d || d.type !== "TL_EIS_RESULT" || d.requestId !== id) return;
      if (d.error) return done(() => reject(new Error(d.error)));
      if (typeof d.tsv !== "string") return done(() => reject(new Error("Расширение вернуло пустой ответ.")));
      done(() => resolve({ tsv: d.tsv as string, pages: Number(d.pages) || 1, count: Number(d.count) || 0 }));
    };
    const timer = setTimeout(() => done(() => reject(new Error("Расширение не ответило за 2,5 минуты. Проверьте, что Chrome открыт и ЕИС доступен."))), timeoutMs);
    win.addEventListener("message", listener);
    win.postMessage({ type: "TL_EIS_SEARCH", requestId: id, url, pages }, win.location.origin);
  });
}
