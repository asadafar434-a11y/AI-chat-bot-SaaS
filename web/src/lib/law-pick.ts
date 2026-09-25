import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { baseRequest, usageLine } from "@/lib/claude-request";
import { LAW_NAMES, lawContents, searchLaws, type LawPick } from "@/lib/laws";

const PickSchema = z.object({
  articles: z.array(
    z.object({
      law: z.enum(LAW_NAMES),
      article: z.string(),
    })
  ),
});

// Оглавление неизменно — системный запрос кешируется на час и читается из кеша за долю цены.
const PICK_SYSTEM = `Ты подбираешь статьи 44-ФЗ и 223-ФЗ, которые нужны, чтобы ответить на вопрос поставщика о закупках. Ниже оглавления обоих законов в действующей редакции.

Верни до 5 статей, самые нужные первыми. Номер статьи пиши как в оглавлении: "44", "111.4". Номера частей не нужны: нумерация частей менялась, текст статьи подберётся сам. Утратившие силу статьи не выбирай. Если вопрос не о нормах закона — например, только о том, что написано в документах закупки, — верни пустой список. Подсказка поиска по словам может ошибаться: опирайся на смысл вопроса.

${lawContents()}`;

const MAX_PICKS = 5;

// Выбор статей — отдельный короткий запрос, а не инструменты в чате: инструменты стоят в начале запроса
// и сбросили бы общий кеш документов закупки, которым пользуются требования, ТП и вопросы.
export async function pickLawArticles(question: string, context: string, signal?: AbortSignal): Promise<LawPick[]> {
  const hits = searchLaws(`${context} ${question}`);
  const hints = hits.map((h) => `${h.law} ст. ${h.num}${h.part ? ` ч. ${h.part}` : ""} — ${h.title}`).join("\n");
  const fallback = hits.slice(0, 2).map((h): LawPick => ({ law: h.law as LawPick["law"], article: h.num }));
  try {
    const response = await new Anthropic().beta.messages.parse(
      {
        ...baseRequest,
        system: [{ type: "text", text: PICK_SYSTEM, cache_control: { type: "ephemeral", ttl: "1h" } }],
        max_tokens: 8000,
        output_config: { effort: "low", format: betaZodOutputFormat(PickSchema) },
        messages: [
          {
            role: "user",
            content: `${context ? `${context}\n\n` : ""}Вопрос: ${question}\n\nПоиск по словам нашёл:\n${hints || "ничего"}`,
          },
        ],
      },
      { signal }
    );
    console.log(usageLine("law-pick", response));
    return response.parsed_output?.articles.slice(0, MAX_PICKS) ?? fallback;
  } catch (e) {
    if (signal?.aborted) throw e;
    // Без выбора ответ всё равно нужен: берём лучшие совпадения поиска по словам.
    console.error("law-pick", e);
    return fallback;
  }
}
