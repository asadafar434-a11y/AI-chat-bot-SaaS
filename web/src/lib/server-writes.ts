// Клиентский гейт server writes S5: запрос на сервер уходит только при явном
// флаге сборки. Серверная сторона дополнительно проверяет свой флаг
// SERVER_WRITES, поэтому рассинхрон флагов даёт громкую ошибку, а не тишину.

/** Выполнять ли серверную половину dual-write (читается в момент вызова, а не импорта). */
export function serverWritesEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SERVER_WRITES === "1";
}

/**
 * Ошибка серверной половины dual-write. Бросается ПОСЛЕ успешной записи в
 * IndexedDB: legacy-состояние цело, сервер не подтверждён. Вызывающий код
 * показывает существующие UI-ошибки — маскировать запрещено.
 */
export class DualWriteError extends Error {
  readonly path: string;
  readonly status: number | null;

  constructor(path: string, status: number | null, message: string) {
    super(`DualWriteError: ${path} → ${status === null ? "сеть" : `HTTP ${status}`}: ${message}`);
    this.name = "DualWriteError";
    this.path = path;
    this.status = status;
  }
}

/**
 * POST/PUT/DELETE к `/api/writes`. Тела ошибок сервера — общие формулировки
 * без PII, но ответ всё равно обрезается до 200 знаков.
 */
export async function postServerWrite(path: string, method: string, body?: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new DualWriteError(path, null, error instanceof Error ? error.message : String(error));
  }
  if (response.ok) {
    return response.status === 204 ? null : await response.json().catch(() => null);
  }
  const text = await response.text().catch(() => "");
  throw new DualWriteError(path, response.status, text.slice(0, 200));
}

/**
 * Удаление через сервер. 404 здесь — не ошибка, а сходимость («там уже нет»):
 * целевое состояние «отсутствует» достигнуто на обеих сторонах. Остальные
 * статусы бросаются как обычно.
 */
export async function deleteServerWrite(path: string): Promise<void> {
  try {
    await postServerWrite(path, "DELETE");
  } catch (error) {
    if (error instanceof DualWriteError && error.status === 404) {
      return;
    }
    throw error;
  }
}
