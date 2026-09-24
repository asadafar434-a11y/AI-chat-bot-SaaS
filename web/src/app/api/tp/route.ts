import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { MAX_CONTEXT_CHARS, type ChatDocument } from "@/lib/chat-types";
import { claudeErrorText } from "@/lib/claude-errors";
import { quoteFound, TpDraftSchema, type TpResponse } from "@/lib/tp";
import { TP_SYSTEM_PROMPT, TP_TASK } from "@/lib/tp-prompt";
import { SAMPLE_ITEMS, SAMPLE_SUBJECT } from "@/lib/tp-sample";

export const maxDuration = 300;

type TpRequest = {
  documents?: Pick<ChatDocument, "name" | "text">[];
  sample?: boolean;
};

const fail = (message: string, status: number) => new Response(message, { status });

export async function POST(request: Request) {
  const { documents = [], sample = false }: TpRequest = await request.json();

  if (sample || !process.env.ANTHROPIC_API_KEY) {
    const body: TpResponse = {
      mode: "demo",
      notice: sample
        ? undefined
        : "ИИ пока не подключён, поэтому показан пример черновика на тестовом ТЗ. Когда добавим ключ, черновик будет по вашему файлу.",
      subject: SAMPLE_SUBJECT,
      items: SAMPLE_ITEMS,
    };
    return Response.json(body);
  }

  if (documents.length === 0) return fail("Загрузите ТЗ.", 400);
  const total = documents.reduce((sum, d) => sum + d.text.length, 0);
  if (total > MAX_CONTEXT_CHARS) {
    return fail(
      `Документы слишком большие: ${total.toLocaleString("ru-RU")} символов при лимите ${MAX_CONTEXT_CHARS.toLocaleString("ru-RU")}. Загрузите только ТЗ.`,
      413
    );
  }

  try {
    const client = new Anthropic();
    const stream = client.beta.messages.stream(
      {
        model: "claude-opus-5",
        max_tokens: 64000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        cache_control: { type: "ephemeral" },
        system: TP_SYSTEM_PROMPT,
        output_config: { format: betaZodOutputFormat(TpDraftSchema) },
        messages: [
          {
            role: "user",
            content: [
              ...documents.map((doc) => ({
                type: "document" as const,
                source: { type: "text" as const, media_type: "text/plain" as const, data: doc.text },
                title: doc.name,
              })),
              { type: "text", text: TP_TASK },
            ],
          },
        ],
      },
      { signal: request.signal }
    );

    const final = await stream.finalMessage();
    const { usage } = final;
    console.log(
      `tp ${final.model}: вход ${usage.input_tokens}, из кеша ${usage.cache_read_input_tokens ?? 0}, выход ${usage.output_tokens}, stop ${final.stop_reason}`
    );

    if (final.stop_reason === "refusal") {
      return fail("Модель отказалась обрабатывать этот документ. Проверьте, что загружено ТЗ закупки.", 422);
    }
    if (final.stop_reason === "max_tokens") {
      return fail("ТЗ слишком длинное для одного прохода. Загрузите его частями — например, по разделам.", 422);
    }
    const draft = final.parsed_output;
    if (!draft) return fail("Не удалось разобрать ответ модели. Попробуйте ещё раз.", 502);

    const texts = documents.map((d) => d.text);
    const body: TpResponse = {
      mode: "ai",
      subject: draft.subject,
      items: draft.items.map((item) => ({ ...item, verified: quoteFound(item.quote, texts) })),
    };
    return Response.json(body);
  } catch (error) {
    console.error(error);
    return fail(claudeErrorText(error), 502);
  }
}
