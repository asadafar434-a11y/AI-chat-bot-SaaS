// Поток ответа ассистента: сервер (/api/chat) отдаёт строки «data: {…}», события разделены пустой строкой.
// text-delta несёт кусок текста ответа, error — причину сбоя. Модуль без зависимостей: его проверяют тесты без сборки.
export type StreamEvent = { type: string; delta?: string; errorText?: string };

export async function* streamEvents(res: Response): AsyncGenerator<StreamEvent> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  const parse = function* (chunk: string): Generator<StreamEvent> {
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        yield JSON.parse(data) as StreamEvent;
      } catch {
        // Не разобрали строку — пропускаем, остальные придут.
      }
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      yield* parse(chunk);
    }
  }
  // Последнее событие могло прийти без завершающей пустой строки.
  buffer += decoder.decode();
  if (buffer.trim()) yield* parse(buffer);
}

// Весь ответ целиком: склеенные куски текста; сбой сервера внутри потока — исключением.
export async function readAnswer(res: Response): Promise<string> {
  let answer = "";
  for await (const event of streamEvents(res)) {
    if (event.type === "text-delta" && event.delta) answer += event.delta;
    else if (event.type === "error") throw new Error(event.errorText || "Ассистент не ответил.");
  }
  return answer;
}
