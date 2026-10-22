// Режим «ИИ включён / выключен» (переключатель в шапке меню). Выключено — программа не обращается к языковым моделям: разбор документов, черновики ТП, проверка заявки, чат,
// поиск противоречий и распознавание сканов не запускаются, а всё остальное (расчёты, правила, аналитика, поиск по реестрам, бесплатный поиск в интернете) работает как обычно.
// По умолчанию включён, чтобы прежняя работа не изменилась: каждый платный запрос по-прежнему только по кнопке. Настройка — в этом браузере.
export const AI_MODE_KEY = "tl_ai";
export const AI_MODE_EVENT = "tl-ai-mode";
export const AI_OFF_MESSAGE = "ИИ выключен. Включите переключатель «ИИ» в шапке меню — и этот запрос станет доступен.";

type Store = Pick<Storage, "getItem" | "setItem">;

const browserStore = (): Store | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

// Если браузер не даёт писать в хранилище, выбор действует, пока открыта страница.
let memory: boolean | null = null;

export function readAiEnabled(store: Store | null = browserStore()): boolean {
  try {
    const saved = store?.getItem(AI_MODE_KEY);
    if (saved === "off") return false;
    if (saved === "on") return true;
  } catch {
    // Нет доступа к хранилищу — берём выбор текущей страницы или значение по умолчанию.
  }
  return memory ?? true;
}

export function saveAiEnabled(on: boolean, store: Store | null = browserStore()) {
  memory = on;
  try {
    store?.setItem(AI_MODE_KEY, on ? "on" : "off");
  } catch {
    // Не записалось — действует выбор текущей страницы.
  }
  try {
    window.dispatchEvent(new Event(AI_MODE_EVENT));
  } catch {
    // Вне браузера (тесты, сервер) подписчиков нет.
  }
}

/** Подписка на смену режима: в этой вкладке (событие) и в других вкладках (storage). Возвращает отписку. */
export function subscribeAiMode(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === AI_MODE_KEY) listener();
  };
  window.addEventListener(AI_MODE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(AI_MODE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Ошибка «ИИ выключен»: показывается пользователю как обычная ошибка запроса, с подсказкой, где включить. */
export class AiOffError extends Error {
  constructor() {
    super(AI_OFF_MESSAGE);
    this.name = "AiOffError";
  }
}

/** Все обращения к модели проходят через эту проверку (lib/purchase.ts, aiHeaders): выключен — запрос не уходит. */
export function assertAiEnabled(store: Store | null = browserStore()) {
  if (!readAiEnabled(store)) throw new AiOffError();
}
