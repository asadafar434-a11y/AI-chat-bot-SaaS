// Согласия пользователя на этом устройстве — на обработку персональных данных и на передачу за рубеж — для текущей
// редакции текстов. Без них приложение не начинает работу, даже если вход без пароля. Сменилась редакция — спросим заново.
// Это не доказательство согласия для оператора (ч. 3 ст. 9 152-ФЗ): журнал согласий на сервере — решение владельца.
import { LEGAL_EDITION } from "./legal.ts";

export const CONSENT_KEY = "tl_consent";
export type ConsentRecord = { edition: string; processing: boolean; transfer: boolean; at: string };
type Store = Pick<Storage, "getItem" | "setItem">;

// Хранилище браузера бывает недоступно (частный режим, запрет сайту) — тогда согласие помнится до перезагрузки.
let inSession = false;
const browserStore = (): Store | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export function readConsent(store: Store | null = browserStore()): ConsentRecord | null {
  try {
    const raw = store?.getItem(CONSENT_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ConsentRecord>;
    if (typeof value.edition !== "string" || typeof value.at !== "string") return null;
    return { edition: value.edition, processing: value.processing === true, transfer: value.transfer === true, at: value.at };
  } catch {
    return null;
  }
}

export function hasConsent(store: Store | null = browserStore()): boolean {
  if (inSession) return true;
  const record = readConsent(store);
  return !!record && record.edition === LEGAL_EDITION && record.processing && record.transfer;
}

export function saveConsent(store: Store | null = browserStore(), now = new Date()): ConsentRecord {
  const record: ConsentRecord = { edition: LEGAL_EDITION, processing: true, transfer: true, at: now.toISOString() };
  inSession = true;
  try {
    store?.setItem(CONSENT_KEY, JSON.stringify(record));
  } catch {
    // Не записалось — согласие действует до перезагрузки страницы.
  }
  return record;
}

// Для тестов: забыть согласие этой вкладки.
export function forgetSessionConsent() {
  inSession = false;
}
