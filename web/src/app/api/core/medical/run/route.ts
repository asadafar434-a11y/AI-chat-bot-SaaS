import { createCoreRun } from "@/server/core/runs";
import { requireWriteScope, writeError, writeJson } from "@/server/write/route";

export const dynamic = "force-dynamic";

/**
 * Запуск медицинского core-модуля.
 * Тело: `{ input: FlowInput }`. Организация и автор — только из серверной сессии.
 */
export async function POST(request: Request) {
  const access = await requireWriteScope(request);
  if (access instanceof Response) {
    return access;
  }
  try {
    const body = (await request.json().catch(() => null)) as { input?: unknown } | null;
    if (!body || typeof body !== "object" || !("input" in body)) {
      return new Response("Некорректное тело", { status: 400 });
    }
    const created = await createCoreRun(access.ctx, body.input);
    return writeJson(created, 201);
  } catch (error) {
    return writeError(error);
  }
}
