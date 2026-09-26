import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, accessPassword, accessToken, closedWithoutPassword, sameToken } from "@/lib/access";
import { isLegalPath } from "@/lib/legal";

const text = (message: string, status: number) =>
  new NextResponse(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

// Закрытая ссылка: без метки входа страницы ведут на /login, а запросы к ИИ получают отказ —
// посторонний не сможет тратить ключ API. Пароль не задан — пускаем всех, но на хостинге запросы к серверу закрыты.
export async function proxy(request: NextRequest) {
  const password = accessPassword();
  const { pathname, search } = request.nextUrl;
  if (!password) {
    if (closedWithoutPassword() && pathname.startsWith("/api/") && pathname !== "/api/login") {
      return text("Сервис закрыт: владелец не задал пароль входа. Напишите ему — контакты на странице «Контакты».", 503);
    }
    return NextResponse.next();
  }

  // Политика, согласие, условия и контакты открыты всем: их нужно прочитать до входа.
  if (pathname === "/login" || pathname === "/api/login" || isLegalPath(pathname)) return NextResponse.next();

  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  if (token && sameToken(token, await accessToken(password))) return NextResponse.next();

  if (pathname.startsWith("/api/")) return text("Нужно снова войти по паролю — обновите страницу.", 401);
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

// Статика Next.js и значок сайта — без проверки, иначе не загрузятся стили и шрифты страницы входа.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
