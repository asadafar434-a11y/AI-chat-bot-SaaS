import { NextResponse } from "next/server";

import { sessionCookieName, SESSION_MAX_AGE_SECONDS } from "./session.ts";

/** Ответ 204 с cookie серверной сессии: общий для входа по паролю и для второго шага (двухфакторный вход). */
export function sessionResponse(request: Request, token: string): NextResponse {
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
