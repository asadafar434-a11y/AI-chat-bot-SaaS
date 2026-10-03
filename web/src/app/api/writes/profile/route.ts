import { saveServerProfile } from "@/server/write/services";
import { requireWriteScope, writeError, writeJson } from "@/server/write/route";

export const dynamic = "force-dynamic";

/** Замена профиля (parity с `saveProfile`): корпоративное — организации, персональное — вызывающему. */
export async function PUT(request: Request) {
  const access = await requireWriteScope(request);
  if (access instanceof Response) {
    return access;
  }
  try {
    const body = (await request.json().catch(() => null)) as { profile?: unknown; meta?: unknown } | null;
    const result = await saveServerProfile(access.ctx, { profile: body?.profile, meta: body?.meta });
    return writeJson({ ok: true, ...result });
  } catch (error) {
    return writeError(error);
  }
}
