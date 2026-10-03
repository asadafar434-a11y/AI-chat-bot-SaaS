/**
 * Readiness probe (P1): приложение готово обслуживать запросы — проверяется доступность
 * PostgreSQL. 200 — БД отвечает; 503 — нет. Не требует сессии и не пишет данные.
 */
import { getDb } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDb().organization.count();
    return Response.json(
      { status: "ready", checks: { database: "ok" } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "unavailable", checks: { database: "error" } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
