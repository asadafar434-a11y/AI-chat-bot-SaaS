import { NextResponse } from "next/server";

import { clientIp, createLimiter, LOGIN_PER_IP, waitText } from "@/lib/rate-limit";
import { authenticateWithPassword } from "@/server/auth/credentials";
import { isSameOrigin } from "@/server/auth/request";
import { createSession, sessionCookieName, SESSION_MAX_AGE_SECONDS } from "@/server/auth/session";
import { getDb } from "@/server/db/client";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const attempts = createLimiter(LOGIN_PER_IP);

/**
 * Вход по email и паролю. Сессия создаётся в БД, cookie хранит только её токен.
 *
 * Ответ на неверные данные одинаков для несуществующего пользователя и для неверного
 * пароля; попытки ограничены тем же счётчиком, что и у входа по общему паролю, а
 * неверный ввод дополнительно задерживается.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return new Response("Недопустимый источник запроса", { status: 403 });
  }

  const later = attempts(clientIp(request.headers.get("x-forwarded-for")));
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

  const { token } = await createSession(db, { userId: user.userId });
  const secure = new URL(request.url).protocol === "https:";
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set({
    name: sessionCookieName(secure),
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
