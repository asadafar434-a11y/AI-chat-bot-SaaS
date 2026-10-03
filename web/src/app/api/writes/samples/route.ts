import { createSample } from "@/server/write/services";
import { requireWriteScope, writeError, writeJson } from "@/server/write/route";

export const dynamic = "force-dynamic";

/** Создание образца. Тело: `{ sample }`. Повтор id — 409. */
export async function POST(request: Request) {
  const access = await requireWriteScope(request);
  if (access instanceof Response) {
    return access;
  }
  try {
    const body = (await request.json().catch(() => null)) as { sample?: unknown } | null;
    const result = await createSample(access.ctx, body?.sample);
    return writeJson({ ok: true, ...result }, 201);
  } catch (error) {
    return writeError(error);
  }
}
