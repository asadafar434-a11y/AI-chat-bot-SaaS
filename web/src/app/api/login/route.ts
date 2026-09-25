import { NextResponse } from "next/server";
import { ACCESS_COOKIE, ACCESS_DAYS, accessPassword, accessToken, sameToken } from "@/lib/access";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Вход по паролю закрытой ссылки. Верный пароль — метка входа в cookie на полгода; неверный — ответ
// с задержкой, чтобы пароль нельзя было быстро перебрать.
export async function POST(request: Request) {
  const password = accessPassword();
  if (!password) return new NextResponse(null, { status: 204 });

  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const typed = typeof body?.password === "string" ? body.password.trim() : "";
  const token = await accessToken(password);
  if (!typed || !sameToken(await accessToken(typed), token)) {
    await wait(800);
    return new Response("Неверный пароль", { status: 401 });
  }

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set({
    name: ACCESS_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    // По http (приложение на своём компьютере или в домашней сети) cookie с пометкой secure браузер не сохранит.
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: ACCESS_DAYS * 24 * 60 * 60,
  });
  return response;
}
