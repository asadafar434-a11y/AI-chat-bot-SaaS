/**
 * Liveness probe (P1): процесс жив. Не трогает БД и не требует сессии — проверяется
 * балансировщиком/оркестратором, чтобы решить, перезапускать ли контейнер.
 * Readiness (доступность БД) — на `/api/health/ready`.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok", service: "tender-lawyer-web" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
