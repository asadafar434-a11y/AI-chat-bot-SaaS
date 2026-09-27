import type { SentDocument } from "@/lib/read-documents";

// Тело запроса к серверу. Кривой JSON, пустое тело или не объект — null: маршрут отвечает 400 с понятным текстом,
// а не падает с ошибкой 500 без текста.
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const BAD_REQUEST_TEXT = "Запрос пришёл повреждённым — обновите страницу и повторите.";

export const badRequest = () =>
  new Response(BAD_REQUEST_TEXT, { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });

// Документы из запроса: имя и текст — строками, записи без текста отбрасываем. Не массив — пустой список,
// и маршрут просит загрузить документы.
export function sentDocuments(value: unknown): SentDocument[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((doc: unknown) => {
    if (!doc || typeof doc !== "object") return [];
    const { name, text, scan } = doc as Record<string, unknown>;
    if (typeof text !== "string") return [];
    return [{ name: typeof name === "string" ? name : "", text, ...(scan === true && { scan: true }) }];
  });
}
