// Экзамен пилота (29.10.2026): обычный сбор цен (server/market/collect.ts) против агента на Mastra (server/market/price-agent.ts) на одних и тех же позициях закупки.
// Печатает по каждой позиции: сколько цен принято, медиана, сколько рублей ушло на модель и поиск. ПЛАТНО: без --yes только показывает план и предельную сумму.
//   npm run prices:compare -- --file "путь/к/Извещение.docx" [--extra распознанная-таблица.txt] [--positions 3] [--cap 30] [--yes]
// --extra — текст, который продукт добавляет при загрузке (таблица-картинка, распознанная как скан): без него позиции идут по порядку, а не от самых дорогих.
import { readFile } from "node:fs/promises";
import { createAnthropic } from "@ai-sdk/anthropic";
import Anthropic from "@anthropic-ai/sdk";
import type { MastraModelConfig } from "@mastra/core/llm";
import { costUsd } from "../src/lib/ai-cost.ts";
import { findCustomerPriceTable } from "../src/lib/customer-price-table.ts";
import { readDocx } from "../src/lib/docx-reader.ts";
import { positionsFromDocuments } from "../src/lib/indicative-price.ts";
import { withTablePrices } from "../src/lib/price-compare.ts";
import { planSearch } from "../src/lib/price-families.ts";
import { searchQueriesFor } from "../src/lib/prices-request.ts";
import { collectPrices, type CollectResult } from "../src/server/market/collect.ts";
import { fetchHtml } from "../src/server/market/fetch-page.ts";
import { createModelSearch, WEB_SEARCH_FEE_USD } from "../src/server/market/model-search.ts";
import { runPriceAgent } from "../src/server/market/price-agent.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const file = arg("file");
const positions = Number(arg("positions") ?? 3);
const cap = Number(arg("cap") ?? 30);
const yes = process.argv.includes("--yes");
const MODEL = "claude-sonnet-5-5";
const AGENT_MODEL = process.env.PRICE_AGENT_MODEL || MODEL;
const usdRub = Number(process.env.USD_RUB) || 0;

if (!file) throw new Error("Укажите --file с документом закупки (.docx или .txt).");
if (!(usdRub > 0)) throw new Error("В .env.local нет USD_RUB — стоимость не посчитать.");

const buffer = await readFile(file);
const text = file.toLowerCase().endsWith(".docx") ? readDocx(new Uint8Array(buffer)).text : buffer.toString("utf8");
const extra = arg("extra");
const docs = [{ name: file.split(/[\\/]/).pop() ?? file, text: extra ? `${text}\n\n${await readFile(extra, "utf8")}` : text }];
const found = positionsFromDocuments(docs);
if (!found) throw new Error("В документе нет таблицы товаров с количеством.");
const picks = planSearch(withTablePrices(found.positions, findCustomerPriceTable(docs)), positions).picks;

console.log(`Позиций в документе: ${found.positions.length}; на экзамен: ${picks.length} — ${picks.map((p) => `«${p.name}»`).join(", ")}`);
console.log(`Потолок: ${cap} ₽ на каждый способ, всего не больше ${cap * 2} ₽ (модель сбора ${MODEL}, модель агента ${AGENT_MODEL}).`);
if (!yes) {
  console.log("Это платный прогон. Запустите с --yes, когда владелец сказал «включи».");
  process.exit(0);
}

const client = new Anthropic();
const rub = (usd: number) => Math.round(usd * usdRub * 100) / 100;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? null : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

async function engine(kind: "сбор" | "агент"): Promise<{ name: string; result: CollectResult; searchRub: number }[]> {
  let searchUsd = 0;
  const modelSearch = createModelSearch(
    async (system, query) => {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 200,
        system,
        messages: [{ role: "user", content: query }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1, user_location: { type: "approximate", country: "RU" } }],
      });
      const fee = (res.usage.server_tool_use?.web_search_requests ?? 1) * WEB_SEARCH_FEE_USD;
      return { content: res.content, usd: costUsd(MODEL, res.usage).usd + fee };
    },
    (usd) => {
      searchUsd += usd;
    },
  );
  const out: { name: string; result: CollectResult; searchRub: number }[] = [];
  let left = cap;
  for (const p of picks) {
    const before = searchUsd;
    const wanted = { name: p.name, unit: p.unit, region: null };
    const share = Math.min(left, (cap / picks.length) * 2);
    const result =
      kind === "сбор"
        ? await collectPrices(
            {
              search: modelSearch,
              fetchPage: fetchHtml,
              ask: async (system, user) => {
                const res = await client.messages.create({ model: MODEL, max_tokens: 1200, system, messages: [{ role: "user", content: user }] });
                return { text: res.content.map((b) => (b.type === "text" ? b.text : "")).join(""), usd: costUsd(MODEL, res.usage).usd };
              },
              worstCaseRub: (chars) => (((chars / 2.2) * 2 + 1200 * 10) / 1_000_000) * usdRub,
              usdRub,
              today: () => new Date().toISOString().slice(0, 10),
            },
            { wanted, queries: searchQueriesFor(wanted).slice(0, 1), maxPages: 5, maxCandidates: 10, capRub: share - rub(searchUsd - before) },
          )
        : await runPriceAgent(
            {
              model: createAnthropic()(AGENT_MODEL) as unknown as MastraModelConfig,
              search: modelSearch,
              fetchPage: fetchHtml,
              stepRub: ({ input, output }) => rub(costUsd(AGENT_MODEL, { input_tokens: input, output_tokens: output }).usd),
              searchSpent: () => rub(searchUsd),
              searchWorstRub: rub(WEB_SEARCH_FEE_USD + (12_000 * 2 + 200 * 10) / 1_000_000),
              today: () => new Date().toISOString().slice(0, 10),
            },
            { wanted, capRub: share },
          );
    const searchRub = rub(searchUsd - before);
    left -= result.spentRub + searchRub;
    out.push({ name: p.name, result, searchRub });
    if (left <= 1) break;
  }
  return out;
}

for (const kind of ["сбор", "агент"] as const) {
  const rows = await engine(kind);
  console.log(`\n=== ${kind} ===`);
  let total = 0;
  for (const { name, result, searchRub } of rows) {
    const prices = result.accepted.map((o) => o.priceNoVat);
    const m = median(prices);
    const spent = result.spentRub + searchRub;
    total += spent;
    console.log(`«${name}»: цен ${prices.length}${m !== null ? `, медиана ${Math.round(m).toLocaleString("ru-RU")} ₽` : ""}; страниц ${result.pages.length}; отклонено ${result.rejected.length}; ${spent.toFixed(2)} ₽${result.stoppedByCap ? " (упёрся в потолок)" : ""}${result.searchErrors.length ? `; ошибки: ${result.searchErrors.join(" | ").slice(0, 160)}` : ""}`);
  }
  console.log(`Итого ${kind}: ${total.toFixed(2)} ₽, позиций с ценой ${rows.filter((r) => r.result.accepted.length > 0).length} из ${rows.length}`);
}
