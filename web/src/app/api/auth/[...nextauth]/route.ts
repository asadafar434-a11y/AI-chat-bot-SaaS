import { handlers } from "@/server/auth/config";

// Стандартные маршруты Auth.js: `/api/auth/session`, `/api/auth/csrf`, `/api/auth/signout`.
// Вход через встроенный Credentials-провайдер не используется (см. config.ts), поэтому
// собственный вход живёт на `/api/auth/login`.
export const { GET, POST } = handlers;
export const runtime = "nodejs";
