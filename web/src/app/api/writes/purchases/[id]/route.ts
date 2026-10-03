import { deletePurchase, replacePurchase } from "@/server/write/services";
import { requireWriteScope, writeError, writeJson } from "@/server/write/route";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const pathId = async (context: Context): Promise<string> => (await context.params).id;

/** Замена закупки целиком (parity с legacy `put`): создаёт или заменяет. */
export async function PUT(request: Request, context: Context) {
  const access = await requireWriteScope(request);
  if (access instanceof Response) {
    return access;
  }
  try {
    const body = (await request.json().catch(() => null)) as { purchase?: unknown } | null;
    const result = await replacePurchase(access.ctx, await pathId(context), body?.purchase);
    return writeJson({ ok: true, ...result });
  } catch (error) {
    return writeError(error);
  }
}

/** Удаление закупки с каскадом документов. Отсутствующая — 404. */
export async function DELETE(request: Request, context: Context) {
  const access = await requireWriteScope(request);
  if (access instanceof Response) {
    return access;
  }
  try {
    const result = await deletePurchase(access.ctx, await pathId(context));
    return writeJson({ ok: true, ...result });
  } catch (error) {
    return writeError(error);
  }
}
