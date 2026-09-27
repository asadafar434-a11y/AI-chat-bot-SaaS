import Anthropic from "@anthropic-ai/sdk";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { MAX_CONTEXT_CHARS, type ChatDocument, type ChatMessage } from "@/lib/chat-types";
import { claudeErrorText, WRITE_OWNER } from "@/lib/claude-errors";
import { baseRequest, documentBlocks, maskDocuments, usageLine } from "@/lib/claude-request";
import { pickLawArticles } from "@/lib/law-pick";
import { checkQuotes, lawExcerpts, quotesNote } from "@/lib/laws";
import { CHAT_INSTRUCTIONS, GENERAL_CHAT_INSTRUCTIONS } from "@/lib/legal-prompt";
import { PdMasker } from "@/lib/pd-mask";
import { badRequest, readJson, sentDocuments } from "@/lib/read-json";

export const maxDuration = 300;

// Сообщения из запроса: роль и текстовые части. Непохожее на сообщение отбрасываем, а не падаем на нём.
function chatMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((message: unknown) => {
    if (!message || typeof message !== "object") return [];
    const { role, parts } = message as Partial<ChatMessage>;
    if ((role !== "user" && role !== "assistant") || !Array.isArray(parts)) return [];
    const texts = parts.filter((part) => part && part.type === "text" && typeof part.text === "string");
    return [{ ...(message as ChatMessage), parts: texts }];
  });
}

const textOf = (message: ChatMessage) =>
  message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();

// Персональные данные — метками: сначала в документах, как в требованиях и ТП, потом в разговоре.
function toClaudeMessages(
  messages: ChatMessage[],
  documents: Pick<ChatDocument, "name" | "text" | "scan">[],
  instructions: string,
  masker: PdMasker
): Anthropic.Beta.BetaMessageParam[] {
  const docs = maskDocuments(masker, documents);
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const message of messages) {
    const text = masker.mask(textOf(message));
    if (!text) continue;
    if (message.role === "user") {
      const date = message.metadata?.date ? `Дата вопроса: ${message.metadata.date}.\n\n` : "";
      out.push({ role: "user", content: [{ type: "text", text: date + text }] });
    } else if (message.role === "assistant") {
      out.push({ role: "assistant", content: [{ type: "text", text }] });
    }
  }

  // Начало — как у требований и ТП: документы из общего кеша, потом задание чата и первый вопрос.
  const first = out[0];
  if (first?.role === "user" && Array.isArray(first.content)) {
    out[0] = {
      role: "user",
      content: [...documentBlocks(docs), { type: "text", text: instructions }, ...first.content],
    };
  }
  return out;
}

// Для уточняющих вопросов («а если цена выше?») выбору статей нужен предыдущий шаг разговора.
function previousExchange(messages: ChatMessage[]): string {
  const users = messages.filter((m) => m.role === "user");
  if (users.length < 2) return "";
  const prev = users[users.length - 2];
  const answer = messages.slice(messages.indexOf(prev) + 1).find((m) => m.role === "assistant");
  return `Предыдущий вопрос: ${textOf(prev)}${answer ? `\nНачало ответа на него: ${textOf(answer).slice(0, 600)}` : ""}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function* stubAnswer(
  question: string,
  documents: Pick<ChatDocument, "name" | "text">[],
  turns: number,
  general: boolean
) {
  const docs = documents.length
    ? documents.map((d) => `- ${d.name} — ${d.text.length.toLocaleString("ru-RU")} символов`).join("\n")
    : general
      ? "- нет"
      : "- нет — добавьте их на странице закупки";
  // На хостинге пользователю — только что делать; ключ и файл настроек — разработчику на своём компьютере.
  if (process.env.NODE_ENV !== "development") {
    yield `**ИИ пока не подключён.** ${WRITE_OWNER}`;
    return;
  }
  const text = [
    "**Тестовый режим: модель не подключена.** Чтобы ассистент отвечал по-настоящему, получите ключ в [console.anthropic.com](https://console.anthropic.com), добавьте строку `ANTHROPIC_API_KEY=...` в файл `web/.env.local` и перезапустите сервер.",
    "",
    `Ваш вопрос: «${question}»`,
    "",
    general ? "Приложенные документы:" : "Документы закупки:",
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
  const body = await readJson(request);
  if (!body) return badRequest();
  const messages = chatMessages(body.messages);
  const documents = sentDocuments(body.documents);
  // Общий чат с главной: вопросы не об одной закупке.
  const general = body.general === true;

  const total = documents.reduce((sum, d) => sum + d.text.length, 0);
  if (total > MAX_CONTEXT_CHARS) {
    return new Response(
      `Документы слишком большие: ${total.toLocaleString("ru-RU")} символов при лимите ${MAX_CONTEXT_CHARS.toLocaleString("ru-RU")}. Уберите лишние файлы или загрузите только нужные разделы.`,
      { status: 413 }
    );
  }

  const masker = new PdMasker();
  const claudeMessages = toClaudeMessages(messages, documents, general ? GENERAL_CHAT_INSTRUCTIONS : CHAT_INSTRUCTIONS, masker);
  if (claudeMessages.at(-1)?.role !== "user") {
    return new Response("Нет вопроса для ответа.", { status: 400 });
  }

  const stream = createUIMessageStream<ChatMessage>({
    async execute({ writer }) {
      writer.write({ type: "start" });
      const id = "answer";
      let opened = false;
      let answer = "";
      const say = (delta: string) => {
        if (!opened) {
          writer.write({ type: "text-start", id });
          opened = true;
        }
        answer += delta;
        writer.write({ type: "text-delta", id, delta });
      };

      if (!process.env.ANTHROPIC_API_KEY) {
        const question = textOf(messages[messages.length - 1]);
        for await (const piece of stubAnswer(question, documents, claudeMessages.length, general)) say(piece);
      } else {
        // Тексты нужных статей закона идут в последний вопрос — после документов, чтобы не сбить их кеш.
        const question = textOf(messages[messages.length - 1]);
        const context = previousExchange(messages);
        const excerpt = lawExcerpts(await pickLawArticles(question, context, request.signal), `${question} ${context}`);
        const last = claudeMessages[claudeMessages.length - 1];
        if (excerpt.text && Array.isArray(last.content)) {
          last.content.splice(last.content.length - 1, 0, { type: "text", text: excerpt.text });
        }

        const client = new Anthropic();
        // Потолок ответа вместе с размышлениями модели: хватает на развёрнутый ответ, а случайный бесконечный ответ
        // стоит вдвое меньше. Упёрся — пользователь увидит «Попросите продолжить».
        const response = client.beta.messages.stream(
          { ...baseRequest, max_tokens: 32000, cache_control: { type: "ephemeral" }, messages: claudeMessages },
          { signal: request.signal }
        );

        // В ответе метки меняются обратно на настоящие значения — по ходу ответа.
        const unmask = masker.stream();
        for await (const event of response) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            const text = unmask.push(event.delta.text);
            if (text) say(text);
          }
        }
        const tail = unmask.flush();
        if (tail) say(tail);

        const final = await response.finalMessage();
        console.log(usageLine("chat", final));
        if (final.stop_reason === "refusal") {
          say("\n\n_Модель отказалась отвечать на этот запрос. Переформулируйте вопрос._");
        } else {
          if (final.stop_reason === "max_tokens") say("\n\n_Ответ оборвался на лимите длины. Попросите продолжить._");
          // Каждая цитата в «» сверяется с текстом законов и документов разговора.
          const note = quotesNote(checkQuotes(answer, documents.map((d) => d.text)), excerpt.laws);
          if (note) say(note);
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
