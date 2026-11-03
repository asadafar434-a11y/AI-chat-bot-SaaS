import { NextResponse } from "next/server";

import { hitStoreSource } from "@/lib/limit-stores";
import { clientIp, LOGIN_PER_IP, waitText } from "@/lib/rate-limit";
import { sharedLimiter } from "@/lib/shared-limits";
import { authenticateWithPassword } from "@/server/auth/credentials";
import { isSameOrigin } from "@/server/auth/request";
import { createSession } from "@/server/auth/session";
import { sessionResponse } from "@/server/auth/session-response";
import { signChallenge } from "@/server/auth/totp";
import { isTwoFactorEnabled } from "@/server/auth/two-factor";
import { getDb } from "@/server/db/client";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const attempts = sharedLimiter("login-ip", LOGIN_PER_IP, hitStoreSource);

/**
 * Вход по email и паролю. Сессия создаётся в БД, cookie хранит только её токен.
 *
 * Ответ на неверные данные одинаков для несуществующего пользователя и для неверного
 * пароля; попытки ограничены тем же счётчиком, что и у входа по общему паролю, а
 * неверный ввод дополнительно задерживается.
 *
 * Включён двухфакторный вход — сессия не создаётся: пароль верен, но ответ — 200 и подписанный
 * «пропуск» (`challenge`) на 5 минут; сессию выдаёт только `/api/auth/login/2fa` после верного кода.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return new Response("Недопустимый источник запроса", { status: 403 });
  }

  const later = await attempts(clientIp(request.headers.get("x-forwarded-for")));
  if (later) {
    return new Response(`Слишком много попыток входа — попробуйте ${waitText(later)}.`, {
      status: 429,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": String(later) },
    });
  }

  const body = (await request.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
  const db = getDb();
  const user = await authenticateWithPassword(db, { email: body?.email, password: body?.password });
  if (!user) {
    await wait(800);
    return new Response("Неверный email или пароль", { status: 401 });
  }

  if (await isTwoFactorEnabled(db, user.userId)) {
    return NextResponse.json({ twoFactor: true, challenge: signChallenge(user.userId) });
  }

  const { token } = await createSession(db, { userId: user.userId });
  return sessionResponse(request, token);
}
