// Сбор закупочных цен со страниц поставщиков: npm run market:collect
//
//   npm run market:collect -- --name="Уголь каменный ДПК" --unit=т --queries="купить уголь ДПК оптом цена тонна|уголь каменный Д оптовая цена за тонну" --no-model     только найти и скачать страницы, модель не вызывается (бесплатно)
//   npm run market:collect -- --name="Уголь каменный ДПК" --unit=т --queries="…|…" --model-on --cap-rub=40 --usd-rub=81,13 --out="файл.json"                 вызвать модель (ПЛАТНО), результат — в файл, в базу ничего не пишется
//   npm run market:collect -- --load-from="файл.json" --by="Имя"                                                                                        записать в базу принятые цены из файла (модель не вызывается)
//   --name, --unit   какой товар и в какой единице нужна цена (цены в другой единице не принимаются);  --region  регион поставки, если нужен;
//   --urls-file      вместо поиска — готовый список адресов страниц (по одному в строке): так страницы можно найти бесплатно, например в Яндексе через Chrome, а скачать и прочитать их сборщиком;
//   --pages-file     вместо поиска и скачивания — страницы, уже прочитанные в браузере (например, через Chrome для сайтов, закрытых от роботов): JSON [{"url":"…","title":"…","text":"…"}]; дальше те же проверки;
//   --queries        поисковые запросы через «|» (поиск бесплатный: Brave, запасной DuckDuckGo);  --max-pages  сколько страниц читать, по умолчанию 6 (по одной с сайта);
//   --model-on       явное разрешение платного вызова: без него модель не вызывается. Нужны ANTHROPIC_API_KEY в окружении процесса, --cap-rub (потолок расходов, ₽) и --usd-rub (курс);
//   --model          модель, по умолчанию claude-sonnet-5-5.
// Потолок расходов жёсткий: перед каждым вызовом считается худший случай, и если он выходит за потолок, сбор останавливается. Ключ берётся только из окружения процесса, в файлы не пишется.
// Что модель написала, проверяет код: цитата должна быть на странице, число — в цитате, единица совпасть, цена быть оптовой, НДС назван (lib/price-extract.ts). Цены контрактов не принимаются.

import { readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { costUsd, PRICES } from "../src/lib/ai-cost.ts";
import type { Observation } from "../src/lib/market-observations.ts";
import { createDbMarketStore, type MarketDb } from "../src/lib/market-store-db.ts";
import { textToHtml } from "../src/lib/page-text.ts";
import { moscowDay } from "../src/lib/registry-types.ts";
import { disconnectPrisma, getPrismaClient } from "../src/server/db/client.ts";
import { collectPrices } from "../src/server/market/collect.ts";
import { fetchHtml } from "../src/server/market/fetch-page.ts";
import { createSearcher } from "../src/server/web-search/search.ts";

const args = new Map(process.argv.slice(2).map((a) => {
  const [key, ...rest] = a.replace(/^--/, "").split("=");
  return [key, rest.length ? rest.join("=") : "true"];
}));
const fail = (message: string): never => {
  throw new Error(message);
};
const num = (v: string | undefined, name: string) => {
  const n = Number((v ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : fail(`--${name}: нужно число больше нуля`);
};

async function load(file: string) {
  const by = args.get("by");
  if (!by || by === "true") fail('для записи укажите, кто загружает: --by="Имя"');
  if (!process.env.DATABASE_URL) fail("для записи нужна DATABASE_URL");
  const saved = JSON.parse(readFileSync(file, "utf8")) as { accepted?: Observation[] };
  const accepted = saved.accepted ?? [];
  if (accepted.length === 0) fail("в файле нет принятых цен");
  const store = createDbMarketStore(getPrismaClient() as unknown as MarketDb);
  const result = await store.ingest(accepted, by ?? null);
  console.log(`Записано в базу: ${result.added}; уже было: ${result.skipped}; всего в базе: ${await store.count()}`);
}

async function main() {
  const from = args.get("load-from");
  if (from && from !== "true") return load(from);

  const name = args.get("name");
  const unit = args.get("unit");
  const pagesFile = args.get("pages-file") && args.get("pages-file") !== "true" ? (args.get("pages-file") as string) : null;
  const filePages = pagesFile ? (JSON.parse(readFileSync(pagesFile, "utf8")) as { url: string; title?: string; text: string }[]) : [];
  if (pagesFile && filePages.length === 0) fail("в файле страниц ничего нет");
  const urlsFile = args.get("urls-file") && args.get("urls-file") !== "true" ? (args.get("urls-file") as string) : null;
  const fileUrls = urlsFile
    ? readFileSync(urlsFile, "utf8")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => /^https?:\/\//i.test(l))
    : [];
  if (urlsFile && fileUrls.length === 0) fail("в файле адресов нет ни одного адреса");
  const queries = pagesFile || urlsFile ? ["страницы из файла"] : (args.get("queries") ?? "").split("|").map((q) => q.trim()).filter(Boolean);
  if (!name || name === "true" || !unit || unit === "true" || queries.length === 0) fail('укажите --name="товар", --unit=единица и --queries="запрос|запрос" (или --urls-file, или --pages-file)');
  const maxPages = args.has("max-pages") ? num(args.get("max-pages"), "max-pages") : pagesFile ? filePages.length : urlsFile ? fileUrls.length : 6;
  const noModel = args.has("no-model");
  const modelOn = args.has("model-on");
  if (noModel === modelOn) fail("укажите ровно одно: --no-model (бесплатно, без модели) или --model-on (платный вызов)");
  const model = args.get("model") && args.get("model") !== "true" ? (args.get("model") as string) : "claude-sonnet-5-5";
  const prices = PRICES[model] ?? fail(`модели ${model} нет в таблице цен (src/lib/ai-cost.ts)`);
  const usdRub = modelOn ? num(args.get("usd-rub"), "usd-rub") : 0;
  const capRub = modelOn ? num(args.get("cap-rub"), "cap-rub") : 0;
  if (modelOn && capRub > 100) fail("--cap-rub: потолок выше 100 ₽ этой командой не ставится");
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (modelOn && !apiKey) fail("нет ANTHROPIC_API_KEY в окружении процесса: платная модель выключена");
  const client = modelOn ? new Anthropic({ apiKey }) : null;
  const MAX_TOKENS = 1200;

  const search = createSearcher();
  const result = await collectPrices(
    {
      search: pagesFile
        ? async () => filePages.map((p) => ({ title: p.title ?? p.url, url: p.url, domain: new URL(p.url).hostname, snippet: "" }))
        : urlsFile
          ? async () => fileUrls.map((u) => ({ title: u, url: u, domain: new URL(u).hostname, snippet: "" }))
          : async (q) => (await search(q)).hits,
      fetchPage: pagesFile
        ? async (url) => {
            const p = filePages.find((x) => x.url === url);
            return p ? { ok: true as const, html: textToHtml(p.title ?? "", p.text), finalUrl: p.url } : { ok: false as const, error: "страницы нет в файле" };
          }
        : (url) => fetchHtml(url),
      ask: async (system, user) => {
        if (!client) fail("модель не включена");
        const res = await client!.messages.create({ model, max_tokens: MAX_TOKENS, system, messages: [{ role: "user", content: user }] });
        const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
        return { text, usd: costUsd(model, res.usage).usd };
      },
      // Худший случай: вход по длине (не больше 2,2 знака на токен), выход — по максимуму.
      worstCaseRub: (chars) => (((chars / 2.2) * prices.input + MAX_TOKENS * prices.output) / 1_000_000) * (usdRub || 80),
      usdRub,
      today: () => moscowDay(new Date().toISOString()),
    },
    // Без модели вызовов нет: потолок для расчёта не нужен, но страницы читаются так же.
    { wanted: { name: name as string, unit: unit as string, region: args.get("region") ?? null }, queries, maxPages, capRub: noModel ? Number.POSITIVE_INFINITY : capRub },
  );

  console.log(`Товар: ${name}, единица: ${unit}; запросов ${queries.length}; страниц выбрано ${result.pages.length}${noModel ? "  (модель не вызывалась, расходов нет)" : ""}`);
  for (const e of result.searchErrors) console.log(`  поиск: ${e}`);
  for (const p of result.pages) {
    const mark = p.status === "read" ? `прочитана, ${p.chars} знаков, ${p.costRub} ₽, предложений ${p.offers.length}` : `пропущена: ${p.skipReason}`;
    console.log(`  ${p.domain} — ${mark}`);
    if (noModel && p.status === "skipped" && p.chars) console.log(`      (текст для модели ${p.chars} знаков)`);
  }
  if (modelOn) {
    console.log(`\nВызовов модели: ${result.calls}; потрачено ${result.spentRub} ₽ из потолка ${capRub} ₽${result.stoppedByCap ? "  (сбор остановлен потолком)" : ""}`);
    console.log(`Принято цен: ${result.accepted.length}; отклонено проверкой: ${result.rejected.length}`);
    for (const o of result.accepted) console.log(`  ✔ ${o.priceNoVat.toFixed(2)} ₽/${o.unit} без НДС — ${o.name}${o.region ? ` (${o.region})` : ""} — ${o.source}`);
    for (const r of result.rejected) console.log(`  ✖ ${r.price} — ${r.product}: ${r.reason}${r.detail ? ` (${r.detail})` : ""}`);
    const out = args.get("out");
    if (out && out !== "true") {
      writeFileSync(out, JSON.stringify(result, null, 2), "utf8");
      console.log(`\nРезультат записан в ${out}. В базу ничего не записано: проверьте и загрузите командой --load-from.`);
    }
  }
}

main()
  .catch((error) => {
    console.error(`Ошибка: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
