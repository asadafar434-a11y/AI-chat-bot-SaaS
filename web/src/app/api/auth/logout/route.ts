import { NextResponse } from "next/server";

import { isSameOrigin, readCookie } from "@/server/auth/request";
import {
  deleteSession,
  SECURE_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from "@/server/auth/session";
import { getDb } from "@/server/db/client";

/**
 * Выход: строка сессии удаляется из БД (отзыв немедленный), cookie очищается. Даже если
 * клиент не пришлёт cookie, ответ одинаков — сервер ничего не подтверждает о состоянии.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return new Response("Недопустимый источник запроса", { status: 403 });
  }

  const header = request.headers.get("cookie");
  const token = readCookie(header, SESSION_COOKIE_NAME) ?? readCookie(header, SECURE_SESSION_COOKIE_NAME);
  if (token) {
    await deleteSession(getDb(), token);
  }

  const response = new NextResponse(null, { status: 204 });
  for (const name of [SESSION_COOKIE_NAME, SECURE_SESSION_COOKIE_NAME]) {
    response.cookies.set({ name, value: "", httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  }
  return response;
}
