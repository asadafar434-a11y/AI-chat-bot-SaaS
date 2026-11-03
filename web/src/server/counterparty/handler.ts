import "server-only";
import { innProblem, isSearchMode, normalizeInn, ogrnProblem, textQueryProblem, type CounterpartyReport } from "@/lib/counterparty";
import { badRequest, readJson } from "@/lib/read-json";
import { CounterpartyError, type CounterpartyFinder } from "@/server/counterparty/counterparty";

// Обработчик «проверка контрагента». Отдельно от файла маршрута, чтобы проверять без сети. Вход нужен так же, как у остальных маршрутов.
// Три вида запроса: { inn } — отчёт; { ogrn } — ОГРН переводится в ИНН и выдаётся отчёт; { query, mode } — список найденных организаций или ИП,
// из которого человек выбирает нужную (дальше — проверка по её ИНН). Номера проверяются по контрольным цифрам до обращения к реестрам.

export type CounterpartyDeps = {
  authorize: (request: Request) => Promise<Response | null>;
  load: (inn: string) => Promise<CounterpartyReport & { cached: boolean }>;
  find: CounterpartyFinder;
};

const plain = (message: string, status: number) => new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function handleCounterparty(request: Request, deps: CounterpartyDeps): Promise<Response> {
  const denied = await deps.authorize(request);
  if (denied) return denied;
  const body = await readJson(request);
  if (!body) return badRequest();

  try {
    if (typeof body.query === "string") {
      const query = body.query.replace(/\s+/g, " ").trim();
      const problem = textQueryProblem(query);
      if (problem) return plain(problem, 400);
      if (!isSearchMode(body.mode)) return badRequest();
      return Response.json(await deps.find.search(query, body.mode));
    }
    if (typeof body.ogrn === "string") {
      const ogrn = normalizeInn(body.ogrn);
      const problem = ogrnProblem(ogrn);
      if (problem) return plain(problem, 400);
      const inn = await deps.find.innByOgrn(ogrn);
      if (!inn) return Response.json({ hits: [], more: false });
      return Response.json(await deps.load(inn));
    }
    const inn = typeof body.inn === "string" ? normalizeInn(body.inn) : "";
    const problem = innProblem(inn);
    if (problem) return plain(problem, 400);
    return Response.json(await deps.load(inn));
  } catch (error) {
    if (error instanceof CounterpartyError) return plain(error.message, error.status);
    console.error("counterparty failed:", error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : "unknown");
    return plain("Проверка сейчас недоступна. Повторите позже.", 502);
  }
}
