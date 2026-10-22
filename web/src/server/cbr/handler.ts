import "server-only";
import { isFxCode } from "@/lib/fx-risk";
import { badRequest, readJson } from "@/lib/read-json";
import { CbrError, type CbrOutcome } from "@/server/cbr/cbr";

// Обработчик «курсы ЦБ за год». Отдельно от файла маршрута, чтобы проверять без сети. Вход нужен так же, как у остальных маршрутов; валюта — только из нашего списка.

export type CbrDeps = {
  authorize: (request: Request) => Promise<Response | null>;
  load: (code: import("@/lib/fx-risk").FxCode) => Promise<CbrOutcome>;
};

const plain = (message: string, status: number) => new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function handleCbr(request: Request, deps: CbrDeps): Promise<Response> {
  const denied = await deps.authorize(request);
  if (denied) return denied;
  const body = await readJson(request);
  if (!body) return badRequest();
  if (!isFxCode(body.code)) return plain("Выберите валюту из списка: доллар, евро или юань.", 400);
  try {
    const found = await deps.load(body.code);
    return Response.json({ code: found.code, name: found.name, series: found.points.map((p) => [p.date, p.rate]), at: found.at, cached: found.cached });
  } catch (error) {
    if (error instanceof CbrError) return plain(error.message, error.status);
    console.error("cbr failed:", error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : "unknown");
    return plain("Курсы сейчас недоступны. Повторите позже.", 502);
  }
}
