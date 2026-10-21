// Полный отчёт по разбору закупки для скачивания: то же, что на экране «Аналитика», но целиком — без раскрывашек. Здесь только состав и текст (чистый код, без ИИ);
// Word рисует analytics-report-docx.ts, печатный вид для PDF — reportHtml ниже. Ничего не уходит на сервер.

import { RISK_GROUPS, type ContractRisk } from "@/lib/contract-risks";
import type { EconResult } from "@/lib/economics";
import type { NmckCalc } from "@/lib/nmck-check";
import type { PriceBadge } from "@/lib/price-badge";
import type { RicResult } from "@/lib/indicative-price";
import type { Assumptions, EstimateResult } from "@/lib/risk-estimate";
import { chartFacts, priceBar, riskShares, SCENARIO_LABELS, type PartId } from "@/lib/analytics-chart";
import { rubles, type Summary } from "@/lib/analytics-summary";
import type { SearchRecord } from "@/lib/web-search";

export type ReportBlock =
  | { type: "p"; text: string; bold?: boolean; muted?: boolean }
  | { type: "bullets"; items: string[] }
  | { type: "table"; head: string[]; rows: string[][] }
  /** Полоски: в PDF рисуются, в Word — таблица. Длина полоски — pct к max; tone — цвет по смыслу, подписи и суммы в тексте всегда есть. */
  | { type: "bars"; max: number; items: { label: string; text: string; pct: number; tone: BarTone }[] };
export type BarTone = "ink" | "mid" | "warn" | "good" | "bad";
export type ReportSection = { title: string; blocks: ReportBlock[] };
export type Report = {
  title: string;
  subtitle: string;
  date: string;
  verdict: { label: string; reasons: string[] };
  sections: ReportSection[];
  footer: string;
};

export type ReportInput = {
  title: string;
  subtitle: string;
  date: Date;
  summary: Summary;
  hasContract: boolean;
  risks: ContractRisk[];
  estimate: EstimateResult;
  econ: EconResult;
  calcs: NmckCalc[];
  ric: RicResult | null;
  badge: PriceBadge | null;
  /** Что нашёл обычный поиск по гипотезам (по какой, запрос, результаты): в отчёте с пометкой «не проверено». */
  searches?: { title: string; record: SearchRecord }[];
  /** Допущения оценки словами: ставка, дни просрочки, процент гарантии и т. п. */
  assumptions: string[];
};

export const REPORT_FOOTER =
  "Отчёт составлен программой по документам закупки и введённым вами данным. Суммы рисков — оценка по допущениям, а не прогноз; решение об участии принимает участник. Юридическое заключение отчёт не заменяет.";

const num = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 }).replace(/[  ]/g, " ");
export const pct = (n: number) => `${n.toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).replace(/[  ]/g, " ")} %`;
export const dateRu = (d: Date) => d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }).replace(/[  ]/g, " ");

// Допущения оценки словами — чтобы читатель отчёта видел, на чём держатся суммы, и мог с ними не согласиться.
export function assumptionLines(a: Assumptions): string[] {
  return [
    `Стоимость денег: ${pct(a.financeRatePct)} годовых`,
    `Банковская гарантия: ${pct(a.guaranteeRatePct)} годовых от суммы`,
    `Просрочка по вашей вине: ${a.delayDays} дн.`,
    `Ключевая ставка для пени «1/300»: ${pct(a.keyRatePct)}`,
    `Доля затрат в цене: ${pct(a.costSharePct)}`,
    `Рост затрат за срок контракта: ${pct(a.growthPct)}`,
    `Гарантийный ремонт и замена брака: ${pct(a.warrantyPct)} цены`,
    `Целевая маржа: ${pct(a.targetMarginPct)}; в оптимистичном сценарии затраты ниже на ${pct(a.optimisticPct)}`,
  ];
}

function summarySection(i: ReportInput): ReportSection {
  const s = i.summary;
  const blocks: ReportBlock[] = [{ type: "p", text: s.text }];
  if (s.facts.length > 0) blocks.push({ type: "table", head: ["Показатель", "Значение"], rows: s.facts.map((f) => [f.label, f.value]) });
  blocks.push({ type: "p", text: "Почему такой итог", bold: true });
  blocks.push({ type: "bullets", items: s.verdict.reasons });
  if (s.recommendations.length > 0) {
    blocks.push({ type: "p", text: "Рекомендации", bold: true });
    blocks.push({ type: "bullets", items: s.recommendations });
  }
  return { title: "Резюме", blocks };
}

function contractSection(i: ReportInput): ReportSection {
  const blocks: ReportBlock[] = [];
  if (!i.hasContract) blocks.push({ type: "p", text: "Проект договора в документах не найден, поэтому риски из договора не показаны.", muted: true });
  else if (i.risks.length === 0) blocks.push({ type: "p", text: "В договоре не найдено условий с цифрами. Это не значит, что их нет: прочитайте раздел об ответственности сторон.", muted: true });
  else {
    blocks.push({
      type: "table",
      head: ["Условие", "Группа", "Кто", "Пункт", "Цитата"],
      rows: i.risks.map((r) => [
        `${r.level === "warn" ? "Внимание: " : ""}${r.title}${r.heavy ? " (крупная)" : ""}`,
        RISK_GROUPS[r.kind],
        r.party === "you" ? "вы" : r.party === "customer" ? "заказчик" : "—",
        `${r.clause ? `п. ${r.clause}, ` : ""}${r.doc}`,
        `«${r.quote}»`,
      ]),
    });
  }
  return { title: "Риски и расходы из договора", blocks };
}

function estimateSection(i: ReportInput): ReportSection {
  const e = i.estimate;
  const blocks: ReportBlock[] = [];
  if (e.priceUsed === null) {
    blocks.push({ type: "p", text: "Цена контракта неизвестна, поэтому суммы рисков посчитать нельзя.", muted: true });
    return { title: "Сколько это может стоить по контракту", blocks };
  }
  blocks.push({ type: "p", text: `Расчёт от цены ${rubles(e.priceUsed)}. Суммы — оценка по допущениям ниже, а не прогноз.`, muted: true });
  blocks.push({
    type: "table",
    head: ["Риск", "Что считается", "Сумма", "Доля цены", "Основание"],
    rows: e.items.map((x) => [
      x.title,
      x.scenario,
      x.amount !== null ? `${x.inTotal ? "" : "(не в итог) "}${rubles(x.amount)}` : `не определено${x.ask ? `: ${x.ask}` : ""}`,
      x.pct !== null ? pct(x.pct) : "—",
      x.basis,
    ]),
  });
  if (e.total > 0) blocks.push({ type: "p", text: `Если сработают все оценённые риски: до ${rubles(e.total)}${e.totalPct !== null ? ` (${pct(e.totalPct)} цены)` : ""}.`, bold: true });
  if (e.unknown > 0) blocks.push({ type: "p", text: `Не удалось оценить без данных: ${e.unknown}. В итог они не входят.`, muted: true });
  if (i.assumptions.length > 0) {
    blocks.push({ type: "p", text: "Допущения", bold: true });
    blocks.push({ type: "bullets", items: i.assumptions });
  }
  return { title: "Сколько это может стоить по контракту", blocks };
}

function economicsSection(i: ReportInput): ReportSection {
  const e = i.econ;
  const blocks: ReportBlock[] = [];
  if (!e.ready) {
    blocks.push({ type: "p", text: e.reason === "nmck" ? "Начальная цена в документах не найдена — цену посчитать не от чего." : "Не введены затраты на исполнение — цену посчитать нельзя.", muted: true });
    return { title: "Какую цену ставить", blocks };
  }
  blocks.push({
    type: "table",
    head: ["Цена", "Значение", "Что это"],
    rows: [
      ["Не ниже", e.min !== null ? rubles(e.min) : "недостижима", "ниже — базовый сценарий в убытке"],
      ["Безопасная", e.safe !== null ? rubles(e.safe) : "недостижима", "ниже — убыток в стрессовом сценарии"],
      ["Целевая", e.target !== null ? rubles(e.target) : "недостижима", "целевая маржа в базовом сценарии"],
    ],
  });
  const names = { optimistic: "Оптимистичный", base: "Базовый", stress: "Стрессовый" } as const;
  blocks.push({ type: "p", text: `Прибыль при цене ${rubles(e.price)}`, bold: true });
  blocks.push({
    type: "table",
    head: ["Сценарий", "Прибыль", "Маржа", "Что вошло"],
    rows: (["optimistic", "base", "stress"] as const).map((k) => [
      names[k],
      rubles(e.scenarios[k].profit),
      pct(e.scenarios[k].margin),
      e.scenarios[k].lines.map((l) => `${l.label}: ${rubles(l.amount)}`).join("; "),
    ]),
  });
  if (e.penaltyUsed) blocks.push({ type: "p", text: `В стрессовом сценарии взята неустойка: ${e.penaltyUsed}.`, muted: true });
  blocks.push({ type: "p", text: "Если снижать цену от начальной", bold: true });
  blocks.push({
    type: "table",
    head: ["Снижение", "Цена", "Прибыль, базовый", "Прибыль, стресс"],
    rows: e.table.map((t) => [`${num(t.drop)} %`, rubles(t.price), rubles(t.base), rubles(t.stress)]),
  });
  return { title: "Какую цену ставить", blocks };
}

function nmckSection(i: ReportInput): ReportSection {
  const blocks: ReportBlock[] = [];
  if (i.calcs.length === 0) {
    blocks.push({ type: "p", text: "В документах не найден расчёт начальной цены по предложениям поставщиков.", muted: true });
  } else {
    blocks.push({
      type: "table",
      head: ["Позиция", "Цены поставщиков", "Средняя", "Вариация", "Замечания"],
      rows: i.calcs.map((c) => [c.name, c.offers.map(num).join(" · "), num(c.mean), pct(c.stats.cv * 100), c.issues.map((x) => x.text).join(" ") || "сходится"]),
    });
  }
  return { title: "Расчёт цены у заказчика", blocks };
}

function ricSection(i: ReportInput): ReportSection {
  const blocks: ReportBlock[] = [];
  const r = i.ric;
  if (!r || r.positions.length === 0) {
    blocks.push({ type: "p", text: "Цены-аналоги не введены, рыночный ориентир не рассчитан.", muted: true });
    return { title: "РИЦ: расчёт индикативной цены", blocks };
  }
  const rows: string[][] = [["Позиций с ценой", `${r.counted} из ${r.total}`]];
  if (r.ric !== null) rows.push(["Индикативная цена закупки", rubles(r.ric)]);
  if (r.range) rows.push(["Диапазон по крайним аналогам", `${rubles(r.range.from)} — ${rubles(r.range.to)}`]);
  if (r.nmck !== null && r.deviation) rows.push(["Начальная цена против РИЦ", `${rubles(r.deviation.abs)} (${pct(r.deviation.pct)})`]);
  if (r.staleCount > 0) rows.push(["Устаревших цен", String(r.staleCount)]);
  if (r.ric === null && r.partial > 0) rows.push(["Сумма по посчитанным позициям", rubles(r.partial)]);
  blocks.push({ type: "table", head: ["Показатель", "Значение"], rows });
  if (i.badge) blocks.push({ type: "p", text: `${i.badge.title}${i.badge.missing.length > 0 ? `. Не хватает: ${i.badge.missing.join("; ")}` : ""}.`, bold: true });
  return { title: "РИЦ: расчёт индикативной цены", blocks };
}

function searchSection(i: ReportInput): ReportSection | null {
  const found = (i.searches ?? []).filter((x) => x.record.hits.length > 0 || x.record.query);
  if (found.length === 0) return null;
  const blocks: ReportBlock[] = [
    { type: "p", text: "Найдено обычным поиском в интернете по ключевым словам. Программа страницы не читала и чисел из них не брала: все находки не проверены, смотрите по ссылкам.", muted: true },
  ];
  for (const { title, record } of found) {
    const when = record.at ? new Date(record.at) : null;
    const date = when && !Number.isNaN(when.getTime()) ? dateRu(when) : "";
    blocks.push({ type: "p", text: `${title}. Запрос: «${record.query}»${record.provider ? `, ${record.provider}` : ""}${date ? `, ${date}` : ""}`, bold: true });
    if (record.hits.length === 0) blocks.push({ type: "p", text: "Ничего не нашлось.", muted: true });
    else blocks.push({ type: "table", head: ["Страница", "Сайт", "Фрагмент", "Ссылка"], rows: record.hits.map((h) => [h.title, h.domain, h.snippet, h.url]) });
  }
  return { title: "Проверка гипотез поиском (не проверено)", blocks };
}

const PART_TONE: Record<PartId, BarTone> = { costs: "ink", taxes: "mid", risks: "warn", profit: "good" };

function chartSection(i: ReportInput): ReportSection {
  const blocks: ReportBlock[] = [];
  const facts = chartFacts({ econ: i.econ, estimate: i.estimate, ric: i.ric });
  if (facts.length > 0) blocks.push({ type: "table", head: ["Показатель", "Значение", "Пояснение"], rows: facts.map((f) => [f.label, f.value, f.hint]) });
  for (const scenario of ["base", "stress"] as const) {
    const bar = priceBar(i.econ, scenario);
    if (!bar) continue;
    blocks.push({ type: "p", text: `Из чего складывается цена ${rubles(bar.price)} — ${SCENARIO_LABELS[scenario].toLowerCase()} сценарий`, bold: true });
    const items = bar.parts.map((p) => ({ label: p.label, text: rubles(p.amount), pct: p.pct, tone: PART_TONE[p.id] }));
    if (bar.loss) items.push({ label: "Убыток (затраты и риски сверх цены)", text: rubles(bar.loss.amount), pct: bar.loss.pct, tone: "bad" });
    blocks.push({ type: "bars", max: Math.max(100, bar.total / bar.price * 100), items });
  }
  const shares = riskShares(i.estimate);
  if (shares.shown.length > 0) {
    blocks.push({ type: "p", text: "Риски в процентах от цены", bold: true });
    blocks.push({ type: "bars", max: shares.shown[0].pct, items: shares.shown.map((s) => ({ label: s.title, text: rubles(s.amount), pct: s.pct, tone: "warn" as const })) });
    if (shares.rest.count > 0) blocks.push({ type: "p", text: `И ещё рисков: ${shares.rest.count}, на ${rubles(shares.rest.amount)}.`, muted: true });
  }
  if (blocks.length === 0) blocks.push({ type: "p", text: "Диаграмму показать не из чего: нет цены контракта и затрат.", muted: true });
  else blocks.push({ type: "p", text: "Процент победы не показан: для него нужна история торгов. Матрица из 27 проверок пока не готова.", muted: true });
  return { title: "Итоговая диаграмма", blocks };
}

export function buildReport(i: ReportInput): Report {
  return {
    title: i.title,
    subtitle: i.subtitle,
    date: dateRu(i.date),
    verdict: { label: i.summary.verdict.label, reasons: i.summary.verdict.reasons },
    sections: [summarySection(i), contractSection(i), estimateSection(i), economicsSection(i), nmckSection(i), ricSection(i), searchSection(i), chartSection(i)].filter((x): x is ReportSection => x !== null),
    footer: REPORT_FOOTER,
  };
}

export const reportFileName = (r: Report, ext: "docx" | "pdf") => `Разбор закупки — ${r.title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80)}.${ext}`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Печатный вид: страница для окна печати (в нём «Сохранить как PDF»). Свои стили, без внешних файлов.
export function reportHtml(r: Report): string {
  const block = (b: ReportBlock) => {
    if (b.type === "p") return `<p class="${b.bold ? "b" : ""} ${b.muted ? "m" : ""}">${esc(b.text)}</p>`;
    if (b.type === "bullets") return `<ul>${b.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
    if (b.type === "bars") {
      const row = (x: (typeof b.items)[number]) =>
        `<div class="bar"><span class="bl">${esc(x.label)}</span><span class="bt"><i class="t-${x.tone}" style="width:${Math.max(0.5, Math.min(100, (x.pct / b.max) * 100)).toFixed(1)}%"></i></span><span class="bv">${esc(x.text)} · ${esc(pct(x.pct))}</span></div>`;
      return `<div class="bars">${b.items.map(row).join("")}</div>`;
    }
    return `<table><thead><tr>${b.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${b.rows.map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  };
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(reportFileName(r, "pdf").replace(/\.pdf$/, ""))}</title><style>
@page{margin:16mm}
*{box-sizing:border-box}
body{font:12px/1.5 Arial,Helvetica,sans-serif;color:#111;margin:0}
h1{font-size:20px;margin:0 0 4px}
h2{font-size:15px;margin:22px 0 8px;padding-top:10px;border-top:1px solid #ccc}
.sub{color:#555;margin:0 0 4px}
.verdict{margin:14px 0 0;padding:10px 12px;border:1px solid #bbb;border-radius:6px;font-size:14px;font-weight:700}
p{margin:6px 0}
p.b{font-weight:700;margin-top:12px}
p.m{color:#555}
ul{margin:4px 0 6px;padding-left:20px}
table{width:100%;border-collapse:collapse;margin:6px 0;table-layout:fixed;font-size:11px}
th,td{border:1px solid #bbb;padding:4px 6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
th{background:#f0f0f0}
tr{page-break-inside:avoid}
.bars{margin:6px 0}
.bar{display:flex;align-items:center;gap:8px;margin:3px 0;page-break-inside:avoid}
.bl{flex:0 0 32%;font-size:11px;overflow-wrap:anywhere}
.bt{flex:1;height:10px;background:#eee;border-radius:4px;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bt i{display:block;height:100%;border-radius:4px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bv{flex:0 0 26%;font-size:11px;text-align:right}
.t-ink{background:#222}.t-mid{background:#888}.t-warn{background:#d4a000}.t-good{background:#137538}.t-bad{background:#b91c1c}
.foot{margin-top:24px;padding-top:10px;border-top:1px solid #ccc;color:#555;font-size:11px}
</style></head><body>
<h1>Разбор закупки</h1>
<p class="sub">${esc(r.title)}</p>
${r.subtitle ? `<p class="sub">${esc(r.subtitle)}</p>` : ""}
<p class="sub">Дата: ${esc(r.date)}</p>
<div class="verdict">${esc(r.verdict.label)}</div>
${r.sections.map((s) => `<h2>${esc(s.title)}</h2>${s.blocks.map(block).join("")}`).join("")}
<p class="foot">${esc(r.footer)}</p>
</body></html>`;
}
