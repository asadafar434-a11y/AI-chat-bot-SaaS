/**
 * Утилиты для собственных POST-обработчиков: проверка источника и чтение cookie.
 *
 * CSRF-защита Auth.js покрывает его собственные маршруты, но не наши обработчики.
 * Поэтому они сами требуют совпадения `Origin` с адресом запроса: иначе чужой сайт мог
 * бы отправить форму от имени вошедшего пользователя.
 */

/** `true`, если `Origin` отсутствует (не-браузер) или совпадает с адресом запроса. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

/** Достаёт значение cookie из заголовка `Cookie` без зависимости от NextRequest. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) {
      continue;
    }
    if (part.slice(0, index).trim() === name) {
      const value = part.slice(index + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return null;
}
