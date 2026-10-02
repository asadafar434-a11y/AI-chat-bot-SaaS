import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, accessPassword, accessToken, closedWithoutPassword, sameToken } from "@/lib/access";
import { isLegalPath } from "@/lib/legal";
import { AI_PER_IP, AI_TOTAL, clientIp, createLimiter, FILES_PER_IP, waitText } from "@/lib/rate-limit";
import { SECURE_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME } from "@/server/auth/session";

// Cookie серверной сессии Auth.js. Наличие проверяется «оптимистично»: реальная проверка
// сессии — в обработчиках по БД. Прокси лишь не пускает заведомо анонимного посетителя и
// не является границей безопасности.
const AUTH_SESSION_COOKIES = [SESSION_COOKIE_NAME, SECURE_SESSION_COOKIE_NAME];

const text = (message: string, status: number, retryAfter?: number) =>
  new NextResponse(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...(retryAfter && { "Retry-After": String(retryAfter) }) },
  });

const aiPerIp = createLimiter(AI_PER_IP);
const aiTotal = createLimiter(AI_TOTAL);
const filesPerIp = createLimiter(FILES_PER_IP);

// Запросы, которые тратят бюджет ИИ или силы сервера, — не чаще лимита. Файл Word, PDF или ODT части заявки собирается без ИИ, вход — свой лимит.
function tooMany(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl;
  if (request.method !== "POST" || !pathname.startsWith("/api/") || pathname === "/api/login" || pathname === "/api/auth/login" || pathname === "/api/tp/docx" || pathname === "/api/tp/pdf" || pathname === "/api/tp/odt") {
    return null;
  }
  const ip = clientIp(request.headers.get("x-forwarded-for"));
  if (pathname === "/api/documents") {
    const wait = filesPerIp(ip);
    return wait ? text(`Слишком много файлов подряд — продолжите ${waitText(wait)}.`, 429, wait) : null;
  }
  const own = aiPerIp(ip);
  if (own) return text(`Слишком много запросов к ИИ подряд — продолжите ${waitText(own)}.`, 429, own);
  const all = aiTotal("all");
  if (all) {
    return text(
      `Дневной лимит запросов к ИИ на сервисе исчерпан — продолжите ${waitText(all)}. Если срочно, напишите владельцу: контакты на странице «Контакты».`,
      429,
      all
    );
  }
  return null;
}

// Закрытая ссылка: без метки входа страницы ведут на /login, а запросы к ИИ получают отказ —
// посторонний не сможет тратить ключ API. Пароль не задан — пускаем всех, но на хостинге запросы к серверу закрыты.
export async function proxy(request: NextRequest) {
  const password = accessPassword();
  const { pathname, search } = request.nextUrl;
  if (!password) {
    if (
      closedWithoutPassword() &&
      pathname.startsWith("/api/") &&
      pathname !== "/api/login" &&
      !pathname.startsWith("/api/auth/")
    ) {
      return text("Сервис закрыт: владелец не задал пароль входа. Напишите ему — контакты на странице «Контакты».", 503);
    }
    return tooMany(request) ?? NextResponse.next();
  }

  // Политика, согласие, условия и контакты открыты всем: их нужно прочитать до входа.
  // Маршруты Auth.js (`/api/auth/*`) открыты: они сами решают, есть ли сессия, и нужны для
  // входа и выхода. Собственные обработчики приглашений/сброса проверяют права по БД.
  if (
    pathname === "/login" ||
    pathname === "/api/login" ||
    pathname.startsWith("/api/auth/") ||
    isLegalPath(pathname)
  ) {
    return tooMany(request) ?? NextResponse.next();
  }

  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  if (token && sameToken(token, await accessToken(password))) return tooMany(request) ?? NextResponse.next();

  // Переходный период: вход по общему паролю работает наравне с серверной сессией. Наличие
  // cookie здесь проверяется оптимистично; реальная проверка сессии — в обработчиках.
  if (AUTH_SESSION_COOKIES.some((name) => request.cookies.get(name)?.value)) {
    return tooMany(request) ?? NextResponse.next();
  }

  if (pathname.startsWith("/api/")) return text("Нужно снова войти — обновите страницу.", 401);
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

// Статика Next.js и значки сайта — без проверки, иначе не загрузятся стили, шрифты и логотип страницы входа.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png).*)"],
};
