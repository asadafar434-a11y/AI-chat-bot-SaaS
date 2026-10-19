import { hitStoreSource } from "@/lib/limit-stores";
import { clientIp, LOGIN_PER_IP, waitText } from "@/lib/rate-limit";
import { sharedLimiter } from "@/lib/shared-limits";
import { AuthError } from "@/server/auth/errors";
import { changePassword } from "@/server/auth/change-password";
import { requireSession } from "@/server/auth/guards";
import { isSameOrigin } from "@/server/auth/request";
import { getTransactionRunner } from "@/server/db/client";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const attempts = sharedLimiter("login-ip", LOGIN_PER_IP, hitStoreSource);

/**
 * Смена пароля из «Настроек»: PUT { current, next }. Только для вошедшего (сессия из cookie, а не из запроса), нужен текущий пароль.
 * Попытки ограничены тем же счётчиком, что и вход, неверный текущий пароль дополнительно задерживается.
 */
export async function PUT(request: Request) {
  if (!isSameOrigin(request)) {
    return new Response("Недопустимый источник запроса", { status: 403 });
  }
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    if (error instanceof AuthError) return new Response("Нужно войти.", { status: error.status });
    throw error;
  }

  const later = await attempts(clientIp(request.headers.get("x-forwarded-for")));
  if (later) {
    return new Response(`Слишком много попыток — попробуйте ${waitText(later)}.`, {
      status: 429,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": String(later) },
    });
  }

  const body = (await request.json().catch(() => null)) as { current?: unknown; next?: unknown } | null;
  try {
    await changePassword(getTransactionRunner(), { userId: session.userId, keepSessionId: session.sessionId, current: body?.current, next: body?.next });
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof AuthError) {
      if (/Текущий пароль/.test(error.message)) await wait(800);
      // Текст для человека — без служебной приставки «AuthError(код): ».
      return new Response(error.message.replace(/^AuthError\([a-z_]+\):\s*/, ""), { status: error.status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    throw error;
  }
}
