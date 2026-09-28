// Распознавать ли сканы и фото через ИИ. Картинка уходит в ИИ в США как есть: персональные данные на ней метками
// не заменяются. Выключили — сканы не читаются, текстовые PDF и Word — как обычно. Настройка — в этом браузере.
export const SCAN_OCR_KEY = "tl_ocr";
type Store = Pick<Storage, "getItem" | "setItem">;

const browserStore = (): Store | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export function readScanOcr(store: Store | null = browserStore()): boolean {
  try {
    return store?.getItem(SCAN_OCR_KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveScanOcr(on: boolean, store: Store | null = browserStore()) {
  try {
    store?.setItem(SCAN_OCR_KEY, on ? "on" : "off");
  } catch {
    // Не записалось — настройка действует, пока открыта страница.
  }
}
