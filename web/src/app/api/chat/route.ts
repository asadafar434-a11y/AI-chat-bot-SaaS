import Anthropic from "@anthropic-ai/sdk";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { MAX_CONTEXT_CHARS, type ChatDocument, type ChatMessage } from "@/lib/chat-types";
import { CLAUDE_MODEL } from "@/lib/claude";
import { claudeErrorText } from "@/lib/claude-errors";
import { SYSTEM_PROMPT } from "@/lib/legal-prompt";

export const maxDuration = 300;

type ChatRequest = {
  messages: ChatMessage[];
  documents?: Pick<ChatDocument, "name" | "text">[];
};

const textOf = (message: ChatMessage) =>
  message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();

function toClaudeMessages(
  messages: ChatMessage[],
  documents: Pick<ChatDocument, "name" | "text">[]
): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const message of messages) {
    const text = textOf(message);
    if (!text) continue;
    if (message.role === "user") {
      const date = message.metadata?.date ? `Дата вопроса: ${message.metadata.date}.\n\n` : "";
      out.push({ role: "user", content: [{ type: "text", text: date + text }] });
    } else if (message.role === "assistant") {
      out.push({ role: "assistant", content: [{ type: "text", text }] });
    }
  }

  const first = out[0];
  if (documents.length > 0 && first?.role === "user" && Array.isArray(first.content)) {
    // Документы — данные пользователя, поэтому они в сообщении, а не в system.
    // Метка кеша на последнем документе: всё до неё переиспользуется между вопросами.
    const blocks: Anthropic.Beta.BetaRequestDocumentBlock[] = documents.map((doc, i) => ({
      type: "document",
      source: { type: "text", media_type: "text/plain", data: doc.text },
      title: doc.name,
      ...(i === documents.length - 1 && { cache_control: { type: "ephemeral", ttl: "1h" } }),
    }));
    out[0] = { role: "user", content: [...blocks, ...first.content] };
  }
  return out;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function* stubAnswer(question: string, documents: Pick<ChatDocument, "name" | "text">[], turns: number) {
  const docs = documents.length
    ? documents.map((d) => `- ${d.name} — ${d.text.length.toLocaleString("ru-RU")} символов`).join("\n")
    : "- нет, загрузите документ кнопкой «Документ»";
  const text = [
    "**Тестовый режим: модель не подключена.** Чтобы ассистент отвечал по-настоящему, получите ключ в [console.anthropic.com](https://console.anthropic.com), добавьте строку `ANTHROPIC_API_KEY=...` в файл `web/.env.local` и перезапустите сервер.",
    "",
    `Ваш вопрос: «${question}»`,
    "",
    "Документы в диалоге:",
    docs,
    "",
    `Сообщений в истории: ${turns} — модель увидит их все.`,
  ].join("\n");
  for (const piece of text.match(/\S+\s*/g) ?? []) {
    yield piece;
    await sleep(12);
  }
}

export async function POST(request: Request) {
  const { messages, documents = [] }: ChatRequest = await request.json();

  const total = documents.reduce((sum, d) => sum + d.text.length, 0);
  if (total > MAX_CONTEXT_CHARS) {
    return new Response(
      `Документы слишком большие: ${total.toLocaleString("ru-RU")} символов при лимите ${MAX_CONTEXT_CHARS.toLocaleString("ru-RU")}. Уберите лишние файлы или загрузите только нужные разделы.`,
      { status: 413 }
    );
  }

  const claudeMessages = toClaudeMessages(messages, documents);
  if (claudeMessages.at(-1)?.role !== "user") {
    return new Response("Нет вопроса для ответа.", { status: 400 });
  }

  const stream = createUIMessageStream<ChatMessage>({
    async execute({ writer }) {
      writer.write({ type: "start" });
      const id = "answer";
      let opened = false;
      const say = (delta: string) => {
        if (!opened) {
          writer.write({ type: "text-start", id });
          opened = true;
        }
        writer.write({ type: "text-delta", id, delta });
      };

      if (!process.env.ANTHROPIC_API_KEY) {
        const question = textOf(messages[messages.length - 1]);
        for await (const piece of stubAnswer(question, documents, claudeMessages.length)) say(piece);
      } else {
        const client = new Anthropic();
        const response = client.beta.messages.stream(
          {
            model: CLAUDE_MODEL,
            max_tokens: 64000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            cache_control: { type: "ephemeral" },
            system: SYSTEM_PROMPT,
            messages: claudeMessages,
          },
          { signal: request.signal }
        );

        for await (const event of response) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            say(event.delta.text);
          }
        }

        const final = await response.finalMessage();
        const { usage } = final;
        console.log(
          `claude ${final.model}: вход ${usage.input_tokens}, из кеша ${usage.cache_read_input_tokens ?? 0}, в кеш ${usage.cache_creation_input_tokens ?? 0}, выход ${usage.output_tokens}, stop ${final.stop_reason}`
        );
        if (final.stop_reason === "refusal") {
          say("\n\n_Модель отказалась отвечать на этот запрос. Переформулируйте вопрос._");
        } else if (final.stop_reason === "max_tokens") {
          say("\n\n_Ответ оборвался на лимите длины. Попросите продолжить._");
        }
      }

      if (opened) writer.write({ type: "text-end", id });
      writer.write({ type: "finish" });
    },
    onError(error) {
      console.error(error);
      return claudeErrorText(error);
    },
  });

  return createUIMessageStreamResponse({ stream });
}
