// Закрытая ссылка: приложение пускает только тех, кто ввёл пароль из переменной окружения ACCESS_PASSWORD.
// Пароль не задан — приложение открыто, как на своём компьютере.

export const ACCESS_COOKIE = "tl_access";
export const ACCESS_DAYS = 180;

const encoder = new TextEncoder();

export const accessPassword = () => (process.env.ACCESS_PASSWORD ?? "").trim();

// Без пароля приложение открыто — так можно только на своём компьютере (next dev). На хостинге (production) без пароля
// запросы к ИИ закрыты: иначе ключ тратит кто угодно, а данные обрабатываются без согласия. Открыть намеренно — OPEN_ACCESS=1.
export const closedWithoutPassword = (env: Record<string, string | undefined> = process.env) =>
  env.NODE_ENV === "production" && env.OPEN_ACCESS !== "1";

// Метка входа — HMAC от постоянной строки на ключе-пароле. Сам пароль в cookie не лежит,
// а сменили пароль — все прежние входы перестают действовать.
export async function accessToken(password: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode("tender-lawyer:access:v1"));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Сравнение за одинаковое время: по задержке ответа метку не подобрать.
export function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
