/**
 * Нормализация email.
 *
 * Email — идентификатор входа и адрес восстановления, поэтому он приводится к одному
 * виду до любого обращения к БД. Иначе `User@Example.com` и `user@example.com` стали бы
 * двумя разными аккаунтами, а поиск «существует ли пользователь» — обходимым сменой
 * регистра.
 */

import { AuthError } from "./errors.ts";

// Намеренно нестрогая проверка: задача — отсечь заведомо непригодное значение, а не
// реализовать RFC 5322. Слишком строгое выражение отвергало бы рабочие адреса.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const EMAIL_MAX_LENGTH = 320;

export function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new AuthError("invalid_argument", "email не передан");
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > EMAIL_MAX_LENGTH || !EMAIL.test(normalized)) {
    throw new AuthError("invalid_argument", "некорректный email");
  }
  return normalized;
}

/** Форма без исключения: удобна там, где нельзя раскрывать причину отказа. */
export function tryNormalizeEmail(value: unknown): string | null {
  try {
    return normalizeEmail(value);
  } catch {
    return null;
  }
}
