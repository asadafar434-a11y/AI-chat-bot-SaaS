/**
 * Контролируемый dual-write стабилизации S5: та же бизнес-операция выполняется
 * сначала в IndexedDB (источник чтения production), затем в PostgreSQL.
 *
 * Честность частичного отказа — в типе результата, а не в документации:
 * - legacy упал → сервер не вызывается вообще (`server: "not-attempted"`);
 * - сервер упал → итог НЕ успех: `{ ok: false, legacy: "written", server: "failed" }`
 *   с текстом ошибки. Данные при этом не потеряны (legacy цел), а расхождение
 *   выявит reconciliation;
 * - IndexedDB и PostgreSQL заведомо НЕ одна атомарная транзакция: модуль так и
 *   называется, и код это показывает, а не прячет.
 *
 * Фоновых воркеров и ретраев нет сознательно (это S8): повтор — это явный
 * следующий вызов, идемпотентный по `legacyId` (POST → 409, PUT — та же запись).
 * Модуль без импортов: чистая оркестрация внедрённых функций.
 */

export type DualSide = "written" | "confirmed" | "failed" | "not-attempted";

export type DualResult<Legacy, Server> =
  | { ok: true; legacy: Legacy; server: Server }
  | { ok: false; legacy: DualSide; server: DualSide; error: string };

/**
 * Выполнить операцию в обоих хранилищах: сначала legacy, затем сервер.
 * Успех возвращается только при подтверждении обеих сторон.
 */
export async function dualWrite<Legacy, Server>(args: {
  legacy: () => Promise<Legacy>;
  server: () => Promise<Server>;
}): Promise<DualResult<Legacy, Server>> {
  let legacy: Legacy;
  try {
    legacy = await args.legacy();
  } catch (error) {
    return {
      ok: false,
      legacy: "failed",
      server: "not-attempted",
      error: error instanceof Error ? error.message : String(error),
    };
  }
  try {
    const server = await args.server();
    return { ok: true, legacy, server };
  } catch (error) {
    return {
      ok: false,
      legacy: "written",
      server: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
