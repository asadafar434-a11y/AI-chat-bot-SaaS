// Прогон ИИ по эталону: модель называет вид каждого документа, формы заказчика и есть ли персональные данные участника.
// Сравнивает с разметкой src/lib/gold-folder.ts. Платно: ключ ANTHROPIC_API_KEY из окружения, расход не больше 250 ₽.
// Запуск из папки web: node --experimental-strip-types --import ./scripts/test-alias.mjs scripts/gold-eval.ts
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { costUsd, rubOf, type AiUsage } from "../src/lib/ai-cost.ts";
import { CLAUDE_MODEL } from "../src/lib/claude.ts";
import { extractText } from "../src/lib/extract-text.ts";
import { GOLD_FOLDER } from "../src/lib/gold-folder.ts";

const LIMIT_RUB = 250;
const USD_RUB = Number(process.env.USD_RUB) || 90;
const key = process.env.ANTHROPIC_API_KEY;
if (!key) throw new Error("Нет ключа ANTHROPIC_API_KEY в окружении");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../Татьяна-Примеры документов");
const outFile = process.env.EVAL_OUT ?? "gold-eval-result.json";

const SYSTEM = "Ты проверяешь разметку тендерных документов. Отвечай только JSON, без пояснений и обёрток.";
const TASK = `Прочитай документ закупки и верни JSON:
{"kind": "...", "forms": ["..."], "personal": true}
kind — один из вариантов: протокол, извещение, документация, техническое задание, бланк заказчика, образец участника, прочее.
- протокол — итог заседания комиссии по закупке;
- извещение — объявление о закупке: условия, сроки, способ подачи;
- документация — приглашение, условия или порядок проведения закупки, требования к составу заявки, проект договора;
- техническое задание — что нужно заказчику: услуги, объём, требования; приложения с описаниями относятся сюда же;
- бланк заказчика — пустая форма, которую заказчик просит заполнить участнику;
- образец участника — документ, который участник подготовил и заполнил своими сведениями или ответами (заявка, предложение, декларация, справка, анкета); ФИО и реквизиты в нём может не быть. Пустые поля, места для подписи или реквизиты заказчика в техническом задании или документации не делают документ образцом участника;
- прочее — рабочие материалы исполнителя, которые не являются ни заявкой или предложением участника, ни требованиями заказчика (например, концепция, сценарий, меню).
forms — названия форм, которые участник заполняет, подписывает или прикладывает к заявке: пустые бланки и формы, уже заполненные участником. Названия дословно, как в документе. Если весь документ — одна форма, назови её название тоже. Не включай описания и перечни приложений к техническому заданию, требования, разделы документации, ссылки на приложения, выписки из реестров, учредительные документы, сертификаты и сканы договоров и актов — это вложения, а не формы. Типовые формы, которые участник передаёт в банк или другую организацию для оформления (например, банковская гарантия), — это формы, их называй. Не включай формы, которыми заказчик и исполнитель обмениваются после заключения договора. Пустой список, если таких форм нет.
Просмотри весь документ: форма может стоять в приложении, в таблице, после подписи или в конце файла. Если форм несколько, назови каждую.
personal — true, если в тексте есть ФИО, ИНН, адрес или телефон конкретного участника (ИП или организации); иначе false.`;

type Verdict = { kind: string; forms: string[]; personal: boolean };

async function ask(text: string): Promise<{ verdict: Verdict; usage: AiUsage }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1200,
      system: SYSTEM,
      messages: [{ role: "user", content: `${TASK}\n\nДокумент:\n${text}` }],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { content: { type: string; text?: string }[]; usage: AiUsage };
  const raw = data.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  return { verdict: JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Verdict, usage: data.usage };
}

const STOP = new Set(["форма", "приложение", "участник"]);
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const words = (s: string) => norm(s).split(" ").filter((w) => w.length >= 4 && !STOP.has(w));
// Падежи отличаются на окончание: сравниваем первые 5 букв слова.
const stemEq = (a: string, b: string) => a.slice(0, 5) === b.slice(0, 5);
const covered = (inner: string[], outer: string[]) =>
  inner.length > 0 && inner.filter((w) => outer.some((v) => stemEq(v, w))).length / inner.length >= 0.75;
const same = (a: string, b: string) => covered(words(b), words(a)) || covered(words(a), words(b));

let totalUsd = 0;
const rows: Record<string, unknown>[] = [];
for (const doc of GOLD_FOLDER.filter((d) => d.kind !== "архив")) {
  const extracted = await extractText(new File([readFileSync(path.join(root, doc.path))], path.basename(doc.path)), { ocr: false });
  const text = extracted.ok ? extracted.text : "";
  if (text.length < 200) {
    rows.push({ path: doc.path, skipped: "нет текста (скан)" });
    continue;
  }
  if (rubOf(totalUsd, USD_RUB) >= LIMIT_RUB) {
    rows.push({ path: doc.path, skipped: "лимит 500 ₽" });
    continue;
  }
  let answer: { verdict: Verdict; usage: AiUsage };
  try {
    answer = await ask(text);
  } catch (error) {
    // Один сбойный ответ не должен сбрасывать весь платный прогон: документ отмечаем и идём дальше.
    rows.push({ path: doc.path, skipped: `ошибка ответа: ${String(error).slice(0, 160)}` });
    continue;
  }
  const { verdict, usage } = answer;
  totalUsd += costUsd(CLAUDE_MODEL, usage).usd;
  const formsMarkup = doc.forms ?? [];
  const formsAi = verdict.forms ?? [];
  rows.push({
    path: doc.path,
    kind: doc.kind,
    aiKind: verdict.kind,
    kindOk: verdict.kind === doc.kind,
    personal: doc.personal,
    aiPersonal: verdict.personal,
    personalOk: verdict.personal === doc.personal,
    formsMarkup,
    formsAi,
    matchedMarkup: formsMarkup.filter((f) => formsAi.some((a) => same(a, f))).length,
    matchedAi: formsAi.filter((a) => formsMarkup.some((f) => same(a, f))).length,
  });
  console.log(`готово: ${doc.path}`);
}

const done = rows.filter((r) => "kind" in r);
const sum = (k: string) => done.reduce((n, r) => n + (r[k] as number), 0);
const summary = {
  документов: done.length,
  пропущено: rows.length - done.length,
  вид_верно: done.filter((r) => r.kindOk).length,
  персональные_верно: done.filter((r) => r.personalOk).length,
  формы_найдено_из_разметки: `${sum("matchedMarkup")} из ${done.reduce((n, r) => n + (r.formsMarkup as string[]).length, 0)}`,
  формы_ИИ_совпали_с_разметкой: `${sum("matchedAi")} из ${done.reduce((n, r) => n + (r.formsAi as string[]).length, 0)}`,
  расход_руб: rubOf(totalUsd, USD_RUB),
};
writeFileSync(outFile, JSON.stringify({ summary, rows }, null, 2), "utf8");
console.log(JSON.stringify(summary, null, 2));
