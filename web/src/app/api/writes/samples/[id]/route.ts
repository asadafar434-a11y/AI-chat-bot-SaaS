import { deleteSample, replaceSample } from "@/server/write/services";
import { requireWriteScope, writeError, writeJson } from "@/server/write/route";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** Замена образца целиком (parity с legacy `put`). */
export async function PUT(request: Request, context: Context) {
  const access = await requireWriteScope(request);
  if (access instanceof Response) {
    return access;
  }
  try {
    const body = (await request.json().catch(() => null)) as { sample?: unknown } | null;
    const result = await replaceSample(access.ctx, (await context.params).id, body?.sample);
    return writeJson({ ok: true, ...result });
  } catch (error) {
    return writeError(error);
  }
}

/** Удаление образца. Отсутствующий — 404. */
export async function DELETE(request: Request, context: Context) {
  const access = await requireWriteScope(request);
  if (access instanceof Response) {
    return access;
  }
  try {
    const result = await deleteSample(access.ctx, (await context.params).id);
    return writeJson({ ok: true, ...result });
  } catch (error) {
    return writeError(error);
  }
}
