// Рейтинг привлекательности тендера: балл 0–100 по шести факторам, считает код по уже посчитанному (матрица проверок, экономика, риски в рублях, цена против рынка) — без ИИ.
// Это не вероятность победы и не прогноз: балл показывает, насколько закупка выгодна и безопасна для вас при ваших данных. Без данных по фактору он не участвует в балле — выдуманных оценок нет.
// Двойного учёта нет: каждая проверка матрицы и каждая сумма попадает ровно в один фактор (рентабельность считается ДО рисков по договору, риски — отдельно).
// Модуль без зависимостей от браузера и сервера: его проверяют тесты (npm test).

import type { CheckRow, GroupId, Level } from "@/lib/check-matrix";
import type { EconResult } from "@/lib/economics";
import type { PriceBadge } from "@/lib/price-badge";
import type { EstimateResult } from "@/lib/risk-estimate";

export type FactorId = "profile" | "profit" | "competition" | "price" | "reliability" | "risks";
export type RatingTone = "good" | "warn" | "danger" | "muted";

export type Factor = {
  id: FactorId;
  title: string;
  /** Вес фактора в общем балле, %. */
  weight: number;
  /** 0–100; null — данных не хватает, фактор в балле не участвует. */
  score: number | null;
  tone: RatingTone;
  /** Что получилось, фактами: цифры и названия проверок. */
  note: string;
  /** Как считается — формула словами. */
  basis: string;
  /** Чего не хватает, когда score = null. */
  missing: string[];
};

export type Blocker = { id: string; text: string; /** Выше этого балла общий не поднимется. */ cap: number };

export type Verdict = { label: string; tone: RatingTone };

export type Rating = {
  /** ready — балл посчитан; insufficient — данных меньше половины по весу, балла нет. */
  status: "ready" | "insufficient";
  /** Итоговый балл с учётом критических препятствий. */
  score: number | null;
  /** Балл по факторам до ограничения препятствиями. */
  rawScore: number | null;
  capped: boolean;
  verdict: Verdict | null;
  /** Доля веса факторов с данными, %. */
  coverage: number;
  factors: Factor[];
  blockers: Blocker[];
  /** Чего не хватает для оценки: по факторам без данных. */
  missing: { factor: string; items: string[] }[];
};

export type RatingInput = {
  econ: EconResult;
  estimate: EstimateResult;
  hasContract: boolean;
  badge: PriceBadge | null;
  matrix: CheckRow[];
  /** Целевая маржа из допущений расчёта, %. */
  targetMarginPct: number;
};

/** Меньше этой доли веса с данными балл не показываем. */
export const MIN_COVERAGE = 50;
const FACTOR_MIN_COVERAGE = 50;

export const FACTOR_WEIGHTS: Record<FactorId, number> = { profile: 25, profit: 25, price: 15, risks: 15, competition: 10, reliability: 10 };

const TITLES: Record<FactorId, string> = {
  profile: "Соответствие профилю компании",
  profit: "Рентабельность",
  price: "Цена относительно рынка",
  risks: "Риски исполнения",
  competition: "Конкуренция",
  reliability: "Надёжность заказчика",
};

/** Порядок на экране: сначала то, что решает деньги и допуск. */
export const FACTOR_ORDER: FactorId[] = ["profile", "profit", "price", "risks", "competition", "reliability"];

export const VERDICTS: { min: number; label: string; tone: RatingTone }[] = [
  { min: 80, label: "Отличный тендер", tone: "good" },
  { min: 65, label: "Перспективный", tone: "good" },
  { min: 50, label: "Есть риски", tone: "warn" },
  { min: 35, label: "Сложный тендер", tone: "danger" },
  { min: 0, label: "Лучше не участвовать", tone: "danger" },
];

export function verdictOf(score: number): Verdict {
  const v = VERDICTS.find((x) => score >= x.min) ?? VERDICTS[VERDICTS.length - 1];
  return { label: v.label, tone: v.tone };
}

export const toneOfScore = (score: number): RatingTone => verdictOf(score).tone;

const clamp = (x: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, x));
const LEVEL_POINTS: Record<Level, number> = { ok: 100, attention: 50, risk: 0 };
const num = (x: number) => x.toLocaleString("ru-RU", { maximumFractionDigits: 1 }).replace(/[   ]/g, " ");

const levelOf = (r: CheckRow): Level | null => (r.result.state === "checked" || r.result.state === "manual" ? r.result.level : null);

/** Фактор из проверок матрицы: средний балл по уровням с весами проверок; данные есть, если проверено не меньше половины веса. */
function fromChecks(id: FactorId, rows: CheckRow[], basis: string, missingText: string): Factor {
  const total = rows.reduce((s, r) => s + r.weight, 0);
  const done = rows.filter((r) => levelOf(r) !== null);
  const doneWeight = done.reduce((s, r) => s + r.weight, 0);
  const base = { id, title: TITLES[id], weight: FACTOR_WEIGHTS[id], basis };
  if (total === 0 || (doneWeight / total) * 100 < FACTOR_MIN_COVERAGE) {
    const waiting = rows.filter((r) => levelOf(r) === null);
    return {
      ...base,
      score: null,
      tone: "muted",
      note: `проверено ${done.length} из ${rows.length}`,
      missing: [missingText, ...waiting.slice(0, 4).map((r) => `${r.def.n}. ${r.def.title}`)],
    };
  }
  const score = Math.round(done.reduce((s, r) => s + LEVEL_POINTS[levelOf(r)!] * r.weight, 0) / doneWeight);
  const worst = done.filter((r) => levelOf(r) !== "ok").sort((a, b) => LEVEL_POINTS[levelOf(a)!] - LEVEL_POINTS[levelOf(b)!] || b.weight - a.weight)[0];
  return {
    ...base,
    score,
    tone: toneOfScore(score),
    note: `проверено ${done.length} из ${rows.length}${worst ? `; хуже всего: ${worst.def.title.toLowerCase()}` : "; замечаний нет"}`,
    missing: [],
  };
}

const groupRows = (matrix: CheckRow[], group: GroupId, ns?: number[]) => matrix.filter((r) => r.def.group === group && (!ns || ns.includes(r.def.n)));

function profitFactor(i: RatingInput): Factor {
  const base = {
    id: "profit" as const,
    title: TITLES.profit,
    weight: FACTOR_WEIGHTS.profit,
    basis: `Маржа до рисков по договору (базовый сценарий) к вашей целевой марже: достигнута цель — 100 баллов, дальше пропорционально; если при росте затрат (стрессовый сценарий, без рисков по договору) убыток, не выше 60.`,
  };
  const e = i.econ;
  if (!e.ready) {
    return { ...base, score: null, tone: "muted", note: e.reason === "costs" ? "ваших затрат нет" : "начальной цены нет", missing: [e.reason === "costs" ? "Затраты на исполнение — на шаге «Цена»" : "Начальная цена в документах"] };
  }
  // Риски по договору считаются отдельным фактором: здесь они из прибыли выведены.
  const riskLines = e.scenarios.base.lines.filter((l) => l.group === "risks").reduce((s, l) => s + l.amount, 0);
  const marginBeforeRisks = ((e.scenarios.base.profit + riskLines) / e.price) * 100;
  const target = i.targetMarginPct > 0 ? i.targetMarginPct : 10;
  let score = Math.round(clamp((marginBeforeRisks / target) * 100));
  // Стресс тоже без рисков по договору (неустойка в стрессе — в факторе рисков): иначе одно и то же считалось бы дважды.
  const stressRisks = e.scenarios.stress.lines.filter((l) => l.group === "risks").reduce((s, l) => s + l.amount, 0);
  const stressLoss = e.scenarios.stress.profit + stressRisks < 0;
  if (stressLoss && score > 60) score = 60;
  return {
    ...base,
    score,
    tone: toneOfScore(score),
    note: `маржа до рисков ${num(marginBeforeRisks)} % при цели ${num(target)} %${stressLoss ? "; при росте затрат убыток" : ""}`,
    missing: [],
  };
}

function priceFactor(i: RatingInput): Factor {
  const base = {
    id: "price" as const,
    title: TITLES.price,
    weight: FACTOR_WEIGHTS.price,
    basis: "Начальная цена против РИЦ по вашим ценам-аналогам: в рыночном диапазоне — 100; выше рынка — 85 (есть запас на снижение); ниже рынка — 30 (риск убыточного контракта). Нужно не меньше пяти сопоставимых цен по каждой позиции.",
  };
  const b = i.badge;
  if (!b || b.status === "insufficient") {
    return { ...base, score: null, tone: "muted", note: "сравнить с рынком нечем", missing: b?.missing.length ? b.missing.slice(0, 3) : ["Цены-аналоги с источником и датой: не меньше пяти на позицию"] };
  }
  const score = b.status === "within" ? 100 : b.status === "above" ? 85 : 30;
  const d = b.detail;
  const dev = d ? `${d.pct >= 0 ? "+" : "−"}${num(Math.abs(d.pct))} % к РИЦ, цен-аналогов ${d.observations.total}` : "";
  return { ...base, score, tone: toneOfScore(score), note: `${b.title.toLowerCase()}${dev ? `; ${dev}` : ""}`, missing: [] };
}

function risksFactor(i: RatingInput): Factor {
  const base = {
    id: "risks" as const,
    title: TITLES.risks,
    weight: FACTOR_WEIGHTS.risks,
    basis: "Риски по договору в рублях к цене: каждый 1 % цены в рисках — минус 2 балла (0 % — 100 баллов, 50 % и больше — 0). Суммы без названной цены в балл не входят.",
  };
  const e = i.estimate;
  if (!i.hasContract) return { ...base, score: null, tone: "muted", note: "проекта договора нет", missing: ["Проект договора в документах закупки"] };
  if (e.totalPct === null) return { ...base, score: null, tone: "muted", note: "цены, от которой считать, нет", missing: ["Начальная цена в документах"] };
  const score = Math.round(clamp(100 - 2 * e.totalPct));
  return { ...base, score, tone: toneOfScore(score), note: `риски до ${num(e.totalPct)} % цены${e.unknown > 0 ? `; без названной суммы: ${e.unknown}` : ""}`, missing: [] };
}

/** Критические препятствия: показываются отдельно и ограничивают общий балл. */
function blockersOf(i: RatingInput): Blocker[] {
  const out: Blocker[] = [];
  if (i.econ.ready && i.econ.min === null) out.push({ id: "loss", text: "Убыток даже по начальной цене на ваших затратах", cap: 34 });
  for (const r of groupRows(i.matrix, "qualification")) {
    if (r.weight === 3 && levelOf(r) === "risk") out.push({ id: `check-${r.def.n}`, text: `${r.def.title}: ${r.result.summary}`, cap: 49 });
  }
  return out;
}

export function rateTender(i: RatingInput): Rating {
  const profile = fromChecks(
    "profile",
    [...groupRows(i.matrix, "qualification"), ...i.matrix.filter((r) => r.def.n === 6)],
    "Проверки квалификации (опыт, лицензии, СРО, финансы, персонал, сертификаты) и доступность процедуры: в порядке — 100, внимание — 50, риск — 0; средневзвешенное по важности проверок. Нужно проверить не меньше половины по весу.",
    "Разберите документы закупки и заполните базу доказательств компании",
  );
  const competition = fromChecks("competition", groupRows(i.matrix, "competition", [1, 2, 3, 4, 5]), "Проверки конкуренции по ЕИС (число участников, победители, динамика): те же уровни, что в профиле.", "Источник данных о конкуренции (ЕИС) в программе не подключён");
  const reliability = fromChecks(
    "reliability",
    groupRows(i.matrix, "reliability"),
    "Проверки надёжности заказчика (история исполнения, суды, ФАС, статус) и условия договора об отказе и приёмке: те же уровни.",
    "Источники о заказчике (ЕИС, картотека арбитражных дел, ФАС, ЕГРЮЛ) в программе не подключены",
  );
  const byId: Record<FactorId, Factor> = { profile, profit: profitFactor(i), price: priceFactor(i), risks: risksFactor(i), competition, reliability };
  const factors = FACTOR_ORDER.map((id) => byId[id]);

  const withData = factors.filter((f) => f.score !== null);
  const coverage = Math.round(withData.reduce((s, f) => s + f.weight, 0));
  const blockers = blockersOf(i);
  const missing = factors.filter((f) => f.score === null).map((f) => ({ factor: f.title, items: f.missing }));
  if (coverage < MIN_COVERAGE) {
    return { status: "insufficient", score: null, rawScore: null, capped: false, verdict: null, coverage, factors, blockers, missing };
  }
  const rawScore = Math.round(withData.reduce((s, f) => s + f.score! * f.weight, 0) / withData.reduce((s, f) => s + f.weight, 0));
  const cap = blockers.length > 0 ? Math.min(...blockers.map((b) => b.cap)) : 100;
  const score = Math.min(rawScore, cap);
  return { status: "ready", score, rawScore, capped: score < rawScore, verdict: verdictOf(score), coverage, factors, blockers, missing };
}
