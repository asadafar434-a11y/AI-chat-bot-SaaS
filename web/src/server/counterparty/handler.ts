import "server-only";
import { innProblem, normalizeInn, type CounterpartyReport } from "@/lib/counterparty";
import { badRequest, readJson } from "@/lib/read-json";
import { CounterpartyError } from "@/server/counterparty/counterparty";

// Обработчик «проверка контрагента по ИНН». Отдельно от файла маршрута, чтобы проверять без сети. Вход нужен так же, как у остальных маршрутов;
// ИНН проверяется по контрольным цифрам до обращения к реестрам, и в реестры уходит только он.

export type CounterpartyDeps = {
  authorize: (request: Request) => Promise<Response | null>;
  load: (inn: string) => Promise<CounterpartyReport & { cached: boolean }>;
};

const plain = (message: string, status: number) => new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function handleCounterparty(request: Request, deps: CounterpartyDeps): Promise<Response> {
  const denied = await deps.authorize(request);
  if (denied) return denied;
  const body = await readJson(request);
  if (!body) return badRequest();
  const inn = typeof body.inn === "string" ? normalizeInn(body.inn) : "";
  const problem = innProblem(inn);
  if (problem) return plain(problem, 400);
  try {
    return Response.json(await deps.load(inn));
  } catch (error) {
    if (error instanceof CounterpartyError) return plain(error.message, error.status);
    console.error("counterparty failed:", error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : "unknown");
    return plain("Проверка сейчас недоступна. Повторите позже.", 502);
  }
}
