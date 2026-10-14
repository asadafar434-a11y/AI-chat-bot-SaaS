// Решение «пускать ли запрос к ИИ или к чтению файлов» — без Auth.js и базы, чтобы его проверяли тесты (ai-auth.test.ts).
// Сам запрос сессии делает ai-guard.ts: он узнаёт, есть ли вход, и отдаёт сюда только итог.

export type AiAuthState = {
  /** Запрос пришёл с этого же сайта (защита от чужих страниц). */
  sameOrigin: boolean;
  /** Вход обязателен: на сервере задан AUTH_SECRET (хостинг или репетиция с базой). */
  sessionRequired: boolean;
  /** valid — человек вошёл; none — не вошёл; unavailable — проверить вход не удалось (база не ответила). */
  session: "valid" | "none" | "unavailable";
  /** Боевой режим сервера (next start). */
  production: boolean;
};

export type AiAuthDenial = { status: 401 | 503; text: string };

/**
 * null — пускаем. Иначе — отказ с кодом и текстом для человека.
 *
 * Если базу не удалось спросить, в боевом режиме НЕ пускаем (503): охранник платных запросов не должен открываться, когда ломается
 * база, — иначе на это время платным ИИ мог бы пользоваться любой посетитель. На компьютере разработчика без базы пускаем:
 * иначе нельзя ничего проверить.
 */
export function aiAuthDenial(state: AiAuthState): AiAuthDenial | null {
  if (!state.sameOrigin) return { status: 401, text: "Требуется вход" };
  if (!state.sessionRequired) return null;
  if (state.session === "valid") return null;
  if (state.session === "none") return { status: 401, text: "Требуется вход" };
  return state.production ? { status: 503, text: "Сервис временно недоступен — попробуйте через минуту." } : null;
}
