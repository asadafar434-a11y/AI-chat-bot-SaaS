import { runCoreRequest } from "@/server/core/http";

export const dynamic = "force-dynamic";

const MODULE_KEY = /^[a-z0-9_-]{1,40}$/;

/** POST /api/core/[module]/run: запуск любого зарегистрированного core-модуля. */
export async function POST(request: Request, context: { params: Promise<{ module: string }> }) {
  const { module } = await context.params;
  if (!MODULE_KEY.test(module)) {
    return new Response("Некорректный модуль", { status: 400 });
  }
  return runCoreRequest(request, module);
}
