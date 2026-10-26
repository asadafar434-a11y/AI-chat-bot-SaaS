import { InvalidArgumentError } from "../db/errors.ts";
import { getDb } from "../db/client.ts";
import { readJson, requireReadScope } from "../read/route.ts";
import { requireWriteScope, writeError, writeJson } from "../write/route.ts";
import { createCoreRun, listCoreRuns } from "./runs.ts";

/** POST /api/core/[module]/run: общий обработчик для всех core-модулей. */
export async function runCoreRequest(request: Request, moduleKey: string): Promise<Response> {
  const access = await requireWriteScope(request);
  if (access instanceof Response) {
    return access;
  }
  try {
    const body = (await request.json().catch(() => null)) as { input?: unknown } | null;
    if (!body || typeof body !== "object" || !("input" in body)) {
      return new Response("Некорректное тело", { status: 400 });
    }
    const created = await createCoreRun(
      access.ctx,
      body.input,
      request.headers.get("idempotency-key"),
      moduleKey,
    );
    return writeJson(created, created.replayed ? 200 : 201);
  } catch (error) {
    return writeError(error);
  }
}

/** GET /api/core/[module]/runs: последние запуски выбранного модуля. */
export async function listCoreRunsRequest(request: Request, moduleKey: string): Promise<Response> {
  const access = await requireReadScope(request);
  if (access instanceof Response) {
    return access;
  }
  try {
    const runs = await listCoreRuns(
      { db: getDb(), scope: access.scope, userId: access.userId },
      50,
      moduleKey,
    );
    return readJson(runs);
  } catch (error) {
    if (error instanceof InvalidArgumentError) {
      return new Response(error.message, { status: 400 });
    }
    throw error;
  }
}
