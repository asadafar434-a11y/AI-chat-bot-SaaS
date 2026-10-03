import { createFact } from "@/server/write/services";
import { requireWriteScope, writeError, writeJson } from "@/server/write/route";

export const dynamic = "force-dynamic";

/** Создание факта. Тело: `{ fact }`. Повтор id — 409. */
export async function POST(request: Request) {
  const access = await requireWriteScope(request);
  if (access instanceof Response) {
    return access;
  }
  try {
    const body = (await request.json().catch(() => null)) as { fact?: unknown } | null;
    const result = await createFact(access.ctx, body?.fact);
    return writeJson({ ok: true, ...result }, 201);
  } catch (error) {
    return writeError(error);
  }
}
