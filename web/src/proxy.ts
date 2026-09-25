import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, accessPassword, accessToken, sameToken } from "@/lib/access";

// Закрытая ссылка: без метки входа страницы ведут на /login, а запросы к ИИ получают отказ —
// посторонний не сможет тратить ключ API. Пароль не задан — пускаем всех.
export async function proxy(request: NextRequest) {
  const password = accessPassword();
  if (!password) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();

  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  if (token && sameToken(token, await accessToken(password))) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return new NextResponse("Нужно снова войти по паролю — обновите страницу.", {
      status: 401,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

// Статика Next.js и значок сайта — без проверки, иначе не загрузятся стили и шрифты страницы входа.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
