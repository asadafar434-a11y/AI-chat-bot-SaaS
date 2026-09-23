import { extractText } from "@/lib/extract-text";

type UploadedDoc = {
  name: string;
  chars: number;
  text: string | null;
  error?: string;
};

const MAX_CONTEXT_CHARS = 60_000;

async function readDoc(file: File): Promise<UploadedDoc> {
  const result = await extractText(file);
  if (!result.ok) {
    return { name: file.name, chars: 0, text: null, error: result.reason };
  }
  const text = result.text.slice(0, MAX_CONTEXT_CHARS);
  return { name: file.name, chars: result.text.length, text };
}

function stubAnswer(question: string, docs: UploadedDoc[]): string {
  const read = docs.filter((d) => d.text !== null);
  const failed = docs.filter((d) => d.text === null);

  const lines = [
    "**Тестовый ответ — ИИ пока не подключён.**",
    "",
    `Ваш вопрос: «${question}»`,
  ];

  if (read.length > 0) {
    lines.push(
      "",
      "Прочитал файлы:",
      ...read.map((d) => {
        const preview = d.text!.replace(/\s+/g, " ").trim().slice(0, 140);
        return `- **${d.name}** — ${d.chars.toLocaleString("ru-RU")} символов. Начало: «${preview}${d.chars > 140 ? "…" : ""}»`;
      })
    );
  }
  if (failed.length > 0) {
    lines.push(
      "",
      "Не смог прочитать:",
      ...failed.map((d) => `- **${d.name}** — ${d.error}`)
    );
  }

  lines.push(
    "",
    "Когда подключим модель, здесь будет ответ со ссылками на конкретные статьи 44-ФЗ / 223-ФЗ и на пункты ваших документов."
  );
  return lines.join("\n");
}

export async function POST(request: Request) {
  const form = await request.formData();
  const question = String(form.get("question") ?? "").trim();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);

  if (!question && files.length === 0) {
    return Response.json({ error: "Пустой запрос" }, { status: 400 });
  }

  const docs = await Promise.all(files.map(readDoc));

  // Точка подключения LLM: при наличии ANTHROPIC_API_KEY здесь будет вызов модели
  // с текстом документов и выдержками из закона в контексте.
  const answer = stubAnswer(question || "(без текста, только файлы)", docs);

  return Response.json({
    answer,
    docs: docs.map(({ name, chars, text, error }) => ({ name, chars, read: text !== null, error })),
  });
}
