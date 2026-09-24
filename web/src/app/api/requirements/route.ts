import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { MAX_CONTEXT_CHARS } from "@/lib/chat-types";
import { CLAUDE_MODEL } from "@/lib/claude";
import { claudeErrorText } from "@/lib/claude-errors";
import { quoteFound } from "@/lib/quotes";
import type { SentDocument } from "@/lib/read-documents";
import { RequirementsSchema, type RequirementsResponse } from "@/lib/requirements";
import { REQ_SYSTEM_PROMPT, REQ_TASK } from "@/lib/requirements-prompt";
import { SAMPLE_REQUIREMENTS } from "@/lib/requirements-sample";

export const maxDuration = 300;

type RequirementsRequest = {
  documents?: SentDocument[];
  sample?: boolean;
};

const fail = (message: string, status: number) => new Response(message, { status });

export async function POST(request: Request) {
  const { documents = [], sample = false }: RequirementsRequest = await request.json();

  if (sample || !process.env.ANTHROPIC_API_KEY) {
    const body: RequirementsResponse = {
      mode: "demo",
      notice: sample
        ? undefined
        : "ИИ пока не подключён, поэтому показан пример на тестовой закупке. Когда добавим ключ, требования будут из ваших файлов.",
      ...SAMPLE_REQUIREMENTS,
    };
    return Response.json(body);
  }

  if (documents.length === 0) return fail("Загрузите документы закупки.", 400);
  const total = documents.reduce((sum, d) => sum + d.text.length, 0);
  if (total > MAX_CONTEXT_CHARS) {
    return fail(
      `Документы слишком большие: ${total.toLocaleString("ru-RU")} символов при лимите ${MAX_CONTEXT_CHARS.toLocaleString("ru-RU")}. Уберите лишние файлы — например, обоснование цены.`,
      413
    );
  }

  try {
    const client = new Anthropic();
    const stream = client.beta.messages.stream(
      {
        model: CLAUDE_MODEL,
        max_tokens: 64000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        cache_control: { type: "ephemeral" },
        system: REQ_SYSTEM_PROMPT,
        output_config: { format: betaZodOutputFormat(RequirementsSchema) },
        messages: [
          {
            role: "user",
            content: [
              ...documents.map((doc) => ({
                type: "document" as const,
                source: { type: "text" as const, media_type: "text/plain" as const, data: doc.text },
                title: doc.name,
              })),
              { type: "text", text: REQ_TASK },
            ],
          },
        ],
      },
      { signal: request.signal }
    );

    const final = await stream.finalMessage();
    const { usage } = final;
    console.log(
      `requirements ${final.model}: вход ${usage.input_tokens}, из кеша ${usage.cache_read_input_tokens ?? 0}, выход ${usage.output_tokens}, stop ${final.stop_reason}`
    );

    if (final.stop_reason === "refusal") {
      return fail("Модель отказалась обрабатывать эти документы. Проверьте, что загружены документы закупки.", 422);
    }
    if (final.stop_reason === "max_tokens") {
      return fail("Документов слишком много для одного прохода. Загрузите главные: извещение, ТЗ и проект контракта.", 422);
    }
    const draft = final.parsed_output;
    if (!draft) return fail("Не удалось разобрать ответ модели. Попробуйте ещё раз.", 502);

    const texts = documents.map((d) => d.text);
    const check = (items: typeof draft.who) => items.map((item) => ({ ...item, verified: quoteFound(item.quote, texts) }));
    const body: RequirementsResponse = {
      mode: "ai",
      subject: draft.subject,
      kind: draft.kind,
      deadline: draft.deadline,
      groups: {
        who: check(draft.who),
        submit: check(draft.submit),
        scope: check(draft.scope),
        terms: check(draft.terms),
      },
    };
    return Response.json(body);
  } catch (error) {
    console.error(error);
    return fail(claudeErrorText(error), 502);
  }
}
