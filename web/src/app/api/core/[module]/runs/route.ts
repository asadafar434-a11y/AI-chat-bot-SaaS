import { listCoreRunsRequest } from "@/server/core/http";

export const dynamic = "force-dynamic";

const MODULE_KEY = /^[a-z0-9_-]{1,40}$/;

/** GET /api/core/[module]/runs: запуски любого зарегистрированного модуля. */
export async function GET(request: Request, context: { params: Promise<{ module: string }> }) {
  const { module } = await context.params;
  if (!MODULE_KEY.test(module)) {
    return new Response("Некорректный модуль", { status: 400 });
  }
  return listCoreRunsRequest(request, module);
}
