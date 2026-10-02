/**
 * Ошибки аутентификации и авторизации.
 *
 * Отдельный от persistence-слоя тип: `NotFoundInScopeError` отвечает на вопрос «есть ли
 * запись в этой организации», а `AuthError` — на вопрос «имеет ли право этот запрос».
 * Смешивать их нельзя: коды ошибок уходят в HTTP-статус, и подмена «нет доступа» на
 * «нет записи» (или наоборот) сама по себе является утечкой.
 */

export type AuthErrorCode =
  | "unauthenticated"
  | "invalid_credentials"
  | "forbidden"
  | "conflict"
  | "invalid_argument"
  | "invalid_invitation"
  | "invalid_token";

const STATUS: Record<AuthErrorCode, number> = {
  unauthenticated: 401,
  invalid_credentials: 401,
  forbidden: 403,
  conflict: 409,
  invalid_argument: 400,
  invalid_invitation: 400,
  invalid_token: 400,
};

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message: string) {
    super(`AuthError(${code}): ${message}`);
    this.name = "AuthError";
    this.code = code;
  }

  get status(): number {
    return STATUS[this.code];
  }
}

/** Одинаковый отказ для неверного пароля и для несуществующего пользователя. */
export function invalidCredentials(): AuthError {
  return new AuthError("invalid_credentials", "неверный email или пароль");
}

export function unauthenticated(message = "требуется вход"): AuthError {
  return new AuthError("unauthenticated", message);
}
