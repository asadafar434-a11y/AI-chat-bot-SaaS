import { runLegacyImport } from "@/server/import/pipeline";
import { ImportError } from "@/server/import/types";
import { requireWriteScope, writeError, writeJson } from "@/server/write/route";

export const dynamic = "force-dynamic";

/**
 * S11 Final Read Cutover: загрузка пользовательской копии в организацию.
 *
 * Не второй импорт: вызов существующего конвейера S3 (`runLegacyImport`) —
 * идемпотентный, conflict-safe, tenant-scoped, с backfill содержимого в S6.
 * Организация берётся только из серверной сессии (`requireWriteScope`).
 */
export async function PUT(request: Request) {
  const access = await requireWriteScope(request);
  if (access instanceof Response) {
    return access;
  }
  try {
    const body = (await request.json().catch(() => null)) as { backup?: unknown } | null;
    if (!body || body.backup === null || typeof body.backup !== "object" || Array.isArray(body.backup)) {
      return new Response("Нужна копия данных", { status: 400 });
    }
    const run = await runLegacyImport({
      db: access.ctx.db,
      run: access.ctx.run,
      scope: access.ctx.scope,
      userId: access.ctx.userId,
      raw: JSON.stringify(body.backup),
      storage: access.ctx.storage,
    });
    return writeJson({ ok: true, verdict: run.reconciliation.verdict, counts: run.reconciliation.counts });
  } catch (error) {
    if (error instanceof ImportError) {
      return new Response(error.message, { status: 400 });
    }
    return writeError(error);
  }
}
