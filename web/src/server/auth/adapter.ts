/**
 * Отзыв сессий мягко удалённых пользователей на уровне адаптера Auth.js.
 *
 * Корень проблемы: со стратегией `database` каждый вызов `auth()` разрешается через
 * `adapter.getSessionAndUser(sessionToken)` (`@auth/core/lib/actions/session.js`), а
 * `PrismaAdapter` делает там обычный `findUnique` по сессии с join пользователя и не
 * знает про наше поле `User.deletedAt`. Поэтому после мягкого удаления аккаунта его
 * старая сессия продолжала считаться действительной: `/api/auth/session` возвращал
 * пользователя, а `requireSession`/`requireOwner` пропускали запрос.
 *
 * Обёртка закрывает дыру в единственной точке, через которую Auth.js читает сессии:
 * если у пользователя `deletedAt != null`, возвращается `null` — и Auth.js считает
 * запрос анонимным (чистит cookie), а все серверные guards получают 401. Отдельные
 * обработчики менять не нужно: они и так строятся поверх `auth()`.
 *
 * Строка сессии при этом подчищается best-effort. Главный инвариант — невозможность
 * авторизации, а не удаление строки: даже если удаление не удалось (гонка с
 * параллельным выходом), возвращается `null`.
 *
 * Смысл `deletedAt` не меняется: поле только читается. Модуль чистый — рантайм-зависимостей
 * нет (только тип `Adapter`), поэтому проверяется модульными тестами без Next.js.
 */

import type { Adapter } from "next-auth/adapters";

/** Адаптер Auth.js, в котором сессии удалённых пользователей недействительны. */
export function withRevokedSessionsForDeletedUsers(base: Adapter): Adapter {
  const read = base.getSessionAndUser?.bind(base);
  if (!read) {
    return base;
  }
  return {
    ...base,
    async getSessionAndUser(sessionToken: string) {
      const result = await read(sessionToken);
      if (!result) {
        return null;
      }
      const deletedAt = (result.user as unknown as { deletedAt?: unknown } | null)?.deletedAt;
      if (!deletedAt) {
        return result;
      }
      try {
        await base.deleteSession?.(sessionToken);
      } catch {
        // Строка уже удалена параллельным запросом — инвариант уже выполнен.
      }
      return null;
    },
  };
}
