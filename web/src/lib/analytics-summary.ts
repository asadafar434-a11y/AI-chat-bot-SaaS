// Резюме разбора закупки: итог светофором, несколько предложений, ключевые цифры, рекомендации и короткая строка для каждого раздела. Собирает код из уже посчитанного (договор, оценка рисков,
// экономика, расчёт цены у заказчика) — без ИИ и без новых цифр. Подробности лежат в раскрывающихся разделах и в отчёте для скачивания (lib/analytics-report.ts).
// Итог — не процент и не балл: светофор с причинами, чтобы выдуманное число не выглядело вероятностью победы. Решение об участии — за человеком.

import type { MatrixSummary } from "@/lib/check-matrix";
import type { ContractRisk } from "@/lib/contract-risks";
import type { EconResult } from "@/lib/economics";
import type { RegionNote } from "@/lib/hidden-costs";
import type { NmckCalc } from "@/lib/nmck-check";
import type { PriceBadge } from "@/lib/price-badge";
import type { EstimateResult } from "@/lib/risk-estimate";

export type VerdictLevel = "go" | "careful" | "stop" | "unknown";

export const VERDICT_LABELS: Record<VerdictLevel, string> = {
  go: "Участвовать можно",
  careful: "Участвовать осторожно",
  stop: "Участвовать не стоит",
  unknown: "Мало данных для решения",
};

export type SummaryInput = {
  title: string;
  kind: string;
  nmck: number | null;
  priceNote: string;
  hasContract: boolean;
  risks: ContractRisk[];
  estimate: EstimateResult;
  econ: EconResult;
  badge: PriceBadge | null;
  calcs: NmckCalc[];
  region: RegionNote | null;
  /** Матрица проверок (lib/check-matrix.ts): критичный риск в ней не даёт итогу «участвовать можно». */
  matrix?: MatrixSummary;
};

export type SectionId = "risks" | "estimate" | "economics" | "nmck" | "ric" | "matrix" | "chart";
export type SectionBrief = { id: SectionId; title: string; brief: string };

export type Summary = {
  verdict: { level: VerdictLevel; label: string; reasons: string[] };
  /** Резюме одним абзацем. */
  text: string;
  facts: { label: string; value: string }[];
  recommendations: string[];
  sections: SectionBrief[];
};

// Пробелы внутри суммы и перед «₽» и «%» — неразрывные: число не рвётся на строки («1 / 000 000 ₽»).
const glue = (s: string) => s.replace(/[   ]/g, " ");
export const rubles = (n: number) => glue(`${Math.round(n).toLocaleString("ru-RU")} ₽`).replace("-", "−");
export const percent = (n: number) => glue(`${n.toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`).replace("-", "−");

const MAX_RECOMMENDATIONS = 6;

function verdictOf(i: SummaryInput): Summary["verdict"] {
  const { econ, estimate, risks } = i;
  if (!econ.ready) {
    const reason = econ.reason === "nmck" ? "Начальная цена в документах не найдена — цену посчитать не от чего." : "Введите свои затраты на исполнение — без них цену не посчитать.";
    return { level: "unknown", label: VERDICT_LABELS.unknown, reasons: [reason] };
  }
  if (econ.min === null) {
    return {
      level: "stop",
      label: VERDICT_LABELS.stop,
      reasons: [`Даже по начальной цене (${rubles(econ.nmck)}) контракт убыточный на ваших затратах: прибыль ${rubles(econ.table[0].base)}.`],
    };
  }
  const reasons: string[] = [];
  if (econ.target === null) reasons.push(`Целевая маржа недостижима даже по начальной цене: прибыль ${rubles(econ.table[0].base)}. Ниже ${rubles(econ.min)} — убыток.`);
  if (econ.scenarios.stress.profit < 0) reasons.push(`В стрессовом сценарии при цене ${rubles(econ.price)} — убыток ${rubles(-econ.scenarios.stress.profit)}.`);
  const heavy = risks.find((r) => r.heavy);
  if (heavy) reasons.push(`В договоре крупная неустойка: ${heavy.title}.`);
  if (econ.scenarios.base.profit > 0 && estimate.total > econ.scenarios.base.profit) {
    reasons.push(`Оценённые риски (${rubles(estimate.total)}) больше вашей прибыли в базовом сценарии (${rubles(econ.scenarios.base.profit)}).`);
  }
  // Риск по критичной проверке матрицы (важность 3) — повод не говорить «можно», даже если деньги сходятся.
  for (const r of (i.matrix?.first ?? []).filter((x) => x.weight === 3 && x.result.state !== "insufficient" && x.result.state !== "not_checked" && x.result.level === "risk").slice(0, 2)) {
    reasons.push(`В матрице проверок риск по критичной проверке ${r.def.n}. ${r.def.title}: ${r.result.summary}`);
  }
  if (reasons.length > 0) return { level: "careful", label: VERDICT_LABELS.careful, reasons };
  return {
    level: "go",
    label: VERDICT_LABELS.go,
    reasons: [`Целевая цена достижима${econ.target !== null ? ` (${rubles(econ.target)})` : ""}${econ.safe !== null ? `; стресс выдерживает цена не ниже ${rubles(econ.safe)}` : ""}.`],
  };
}

function textOf(i: SummaryInput): string {
  const parts: string[] = [];
  parts.push(`${i.title}.${i.nmck !== null ? ` ${i.kind ? `${i.kind}; н` : "Н"}ачальная цена ${rubles(i.nmck)}.` : ""}`.replace(/\.\s*;/g, ";"));
  if (!i.hasContract) parts.push("Проект договора в документах не нашёл.");
  else if (i.risks.length === 0) parts.push("В договоре не нашёл условий с цифрами.");
  else {
    const attention = i.risks.filter((r) => r.level === "warn");
    parts.push(`В договоре найдено условий с цифрами: ${i.risks.length}${attention.length > 0 ? `, внимания требуют ${attention.length}` : ""}.`);
    const heavy = i.risks.find((r) => r.heavy);
    if (heavy) parts.push(`Крупная неустойка: ${heavy.title}.`);
  }
  if (i.estimate.total > 0 && i.estimate.totalPct !== null) parts.push(`Если сработают все оценённые риски — до ${rubles(i.estimate.total)} (${percent(i.estimate.totalPct)} цены).`);
  const e = i.econ;
  if (e.ready) {
    if (e.target !== null) parts.push(`По вашим затратам целевая цена ${rubles(e.target)} (${percent((1 - e.target / e.nmck) * 100)} ниже начальной); ниже ${rubles(e.min ?? e.target)} — убыток.`);
    else if (e.min !== null) parts.push(`Целевая маржа недостижима; ниже ${rubles(e.min)} — убыток.`);
    else parts.push("На ваших затратах контракт убыточный даже по начальной цене.");
  } else parts.push("Чтобы назвать цену, нужны ваши затраты на исполнение.");
  if (i.badge && i.badge.status !== "insufficient") parts.push(`${i.badge.title}.`);
  return parts.join(" ");
}

function recommendationsOf(i: SummaryInput): string[] {
  const out: string[] = [];
  const { estimate, risks } = i;
  if (!i.hasContract) out.push("Загрузите проект договора: без него риски по договору не видны.");
  const penalty = estimate.items
    .filter((x) => x.id.startsWith("penalty") && x.amount !== null && x.pct !== null && x.pct >= 5)
    .sort((x, y) => y.amount! - x.amount!)[0];
  if (penalty) {
    const delay = penalty.title.startsWith("Просрочка");
    out.push(`${penalty.title}: до ${rubles(penalty.amount!)} (${percent(penalty.pct!)} цены) — ${delay ? "заложите запас по срокам" : "проверьте, за какие нарушения он положен"}.`);
  }
  const unknown = estimate.items.filter((x) => x.kind === "unknown");
  if (unknown.length > 0) out.push(`Запросите цену, в договоре и документах суммы нет: ${unknown.map((x) => x.title.replace(/^За ваш счёт: /, "")).join("; ")}.`);
  const finance = estimate.items.find((x) => x.id === "finance" && x.amount !== null);
  if (finance) out.push(`${finance.title}: проценты по кредиту около ${rubles(finance.amount!)} — нужны свои деньги на этот срок.`);
  const security = risks.find((r) => r.kind === "security" && r.level === "warn");
  if (security) out.push(`${security.title}: договоритесь с банком о гарантии заранее.`);
  if (risks.some((r) => r.kind === "price" && r.party === "you") && !estimate.indexed) out.push("Цена твёрдая: зафиксируйте цены у поставщиков на весь срок контракта.");
  if (i.badge?.status === "insufficient") out.push("Чтобы сравнить цену с рынком, добавьте не меньше пяти цен-аналогов с источником и датой.");
  const flagged = i.calcs.filter((c) => c.issues.some((x) => x.level === "warn"));
  if (flagged.length > 0) out.push(`В расчёте цены у заказчика есть расхождения (${flagged.length}): проверьте расчёт и при необходимости запросите разъяснения.`);
  if (i.region?.kind === "other") out.push(`Место поставки — ${i.region.place.name}, вне вашего региона: запросите расчёт доставки.`);
  return out.slice(0, MAX_RECOMMENDATIONS);
}

export function buildSummary(i: SummaryInput): Summary {
  const attention = i.risks.filter((r) => r.level === "warn").length;
  const e = i.econ;
  const facts = [
    ...(i.nmck !== null ? [{ label: "Начальная цена", value: rubles(i.nmck) }] : []),
    ...(i.estimate.total > 0 ? [{ label: "Риски в рублях, если сработают все", value: `до ${rubles(i.estimate.total)}` }] : []),
    ...(e.ready && e.target !== null ? [{ label: "Целевая цена", value: rubles(e.target) }] : []),
    ...(i.badge && i.badge.status !== "insufficient" ? [{ label: "Цена против рынка", value: i.badge.title }] : []),
  ];
  const sections: SectionBrief[] = [
    { id: "risks", title: "Риски и расходы из договора", brief: !i.hasContract ? "договор не найден" : i.risks.length === 0 ? "условий с цифрами нет" : `${i.risks.length} условий, внимания требуют ${attention}` },
    { id: "estimate", title: "Сколько это может стоить", brief: i.estimate.priceUsed === null ? "нет цены" : i.estimate.total > 0 ? `до ${rubles(i.estimate.total)}${i.estimate.totalPct !== null ? ` · ${percent(i.estimate.totalPct)} цены` : ""}` : "оценить нечего" },
    { id: "economics", title: "Какую цену ставить", brief: !e.ready ? "нужны ваши затраты" : e.target !== null ? `целевая ${rubles(e.target)}` : e.min !== null ? `не ниже ${rubles(e.min)}` : "убыток по начальной цене" },
    { id: "nmck", title: "Расчёт цены у заказчика", brief: i.calcs.length === 0 ? "не найден" : `замечаний: ${i.calcs.filter((c) => c.issues.some((x) => x.level === "warn")).length} из ${i.calcs.length}` },
    { id: "ric", title: "РИЦ: ваши цены-аналоги", brief: !i.badge ? "не заполнено" : i.badge.status === "insufficient" ? "данных пока мало" : i.badge.title },
    {
      id: "matrix",
      title: "Матрица проверок (27)",
      brief: i.matrix
        ? `проверено ${i.matrix.program + i.matrix.manual} из ${i.matrix.total}${i.matrix.risk > 0 ? ` · риск ${i.matrix.risk}` : ""}${i.matrix.attention > 0 ? ` · внимание ${i.matrix.attention}` : ""}`
        : "считаю…",
    },
    {
      id: "chart",
      title: "Итоговая диаграмма",
      brief: e.ready
        ? `рентабельность ${percent(e.scenarios.base.margin)}${i.estimate.totalPct !== null && i.estimate.total > 0 ? ` · риски до ${percent(i.estimate.totalPct)}` : ""}`
        : i.estimate.totalPct !== null && i.estimate.total > 0
          ? `риски до ${percent(i.estimate.totalPct)} цены; нужны ваши затраты`
          : "нужны ваши затраты",
    },
  ];
  return { verdict: verdictOf(i), text: textOf(i), facts, recommendations: recommendationsOf(i), sections };
}
