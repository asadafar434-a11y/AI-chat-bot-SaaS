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

/** Фактор без поля source: его добавляет rateTender из FACTOR_SOURCES. */
export type FactorCore = Omit<Factor, "source">;

export type Factor = {
  id: FactorId;
  title: string;
  /** Вес фактора в общем балле, %. */
  weight: number;
  /** 0–100; null — данных не хватает, фактор в балле не участвует. */
  score: number | null;
  tone: RatingTone;
  /** По каким данным считается фактор (откуда берутся числа). */
  source: string;
  /** Что получилось, фактами: цифры и названия проверок. */
  note: string;
  /** Как считается — формула словами. */
  basis: string;
  /** Чего не хватает, когда score = null. */
  missing: string[];
  /** Фактор учтён в другом, чтобы не считать одно и то же дважды: балла у него нет, и это не нехватка данных. */
  mergedInto?: FactorId;
};

export type Blocker = { id: string; text: string; /** Выше этого балла общий не поднимется. */ cap: number };

export type Verdict = { label: string; tone: RatingTone };

export type Rating = {
  /** ready — балл посчитан; insufficient — данных меньше половины по весу, балла нет. */
  status: "ready" | "insufficient";
  /** Балл посчитан по неполным данным (меньше 70 % веса): показывается с пометкой «предварительно», пока не появятся остальные данные. */
  preliminary: boolean;
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
  /** Главная причина, почему рынка нет (например, нет файла технических требований со списком товаров): идёт первой в «чего не хватает» у фактора цены. */
  priceNote?: string | null;
};

/** Меньше этой доли веса с данными балл не показываем. */
// Ниже этой доли веса с данными балла нет; от неё до FULL_COVERAGE — предварительная оценка с пометкой, выше — обычная.
export const MIN_COVERAGE = 35;
export const FULL_COVERAGE = 70;
const FACTOR_MIN_COVERAGE = 50;

export const FACTOR_WEIGHTS: Record<FactorId, number> = { profile: 25, profit: 25, price: 15, risks: 15, competition: 10, reliability: 10 };

/** Откуда берутся данные каждого фактора — показывается в расшифровке: что учтено и чего не хватает. */
export const FACTOR_SOURCES: Record<FactorId, string> = {
  profile: "требования заказчика из документов и база доказательств вашей компании (лицензии, опыт, персонал, оборудование)",
  profit: "ваша себестоимость (шаг «Цена», блок «Мои расходы»), налог и обеспечение",
  price: "закупочные цены поставщиков, найденные в интернете (пока вы не ввели свои затраты)",
  risks: "проект договора закупки: неустойка, срок оплаты, обеспечение, гарантия, твёрдая цена",
  competition: "закупки заказчика и участники в ЕИС (источник не подключён)",
  reliability: "ЕИС, картотека арбитражных дел, ФАС, статус заказчика (источники не подключены)",
};

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
function fromChecks(id: FactorId, rows: CheckRow[], basis: string, missingText: string): FactorCore {
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
      missing: [missingText],
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

function profitFactor(i: RatingInput): FactorCore {
  const base = {
    id: "profit" as const,
    title: TITLES.profit,
    weight: FACTOR_WEIGHTS.profit,
    basis: `Маржа до рисков по договору (базовый сценарий) к вашей целевой марже: достигнута цель — 100 баллов, дальше пропорционально; если при росте затрат (стрессовый сценарий, без рисков по договору) убыток, не выше 60.`,
  };
  const e = i.econ;
  if (!e.ready) {
    return { ...base, score: null, tone: "muted", note: e.reason === "costs" ? "ваших затрат нет" : "начальной цены нет", missing: [e.reason === "costs" ? "Себестоимость — на шаге «Цена», блок «Мои расходы», поле «Себестоимость, ₽»" : "Начальная цена в документах"] };
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

// Рынок здесь — закупочная цена (прайсы, предложения поставщиков, биржа), цены контрактов не берутся (lib/price-basis.ts). Фактор показывает, какой запас маржи даёт начальная цена над закупочной рыночной.
// Маржа одна: пока участник не ввёл свои затраты, её даёт этот фактор (по рынку); когда ввёл — «Рентабельность» (свои затраты точнее рыночных), а этот фактор в балле не участвует, чтобы маржа не считалась дважды.
function priceFactor(i: RatingInput): FactorCore {
  const base = {
    id: "price" as const,
    title: TITLES.price,
    weight: FACTOR_WEIGHTS.price,
    basis:
      "Запас начальной цены над закупочной рыночной ценой (РИЦ по прайсам, предложениям поставщиков и биржевым ценам; цены контрактов не берутся — в них маржа победителя), в % от начальной цены, к вашей целевой марже: цель достигнута — 100, пропорционально ниже, ниже закупочной цены — 0. Нужно не меньше пяти сопоставимых цен по каждой позиции. Считается, пока вы не ввели свои затраты: после этого маржу даёт «Рентабельность», чтобы не считать её дважды.",
  };
  if (i.econ.ready) {
    return { ...base, score: null, tone: "muted", note: "учтено в рентабельности: ваши затраты точнее рыночных", missing: [], mergedInto: "profit" };
  }
  const b = i.badge;
  if (!b || b.status === "insufficient" || !b.detail) {
    const reason = b?.missing.length ? b.missing.slice(0, 3) : ["Закупочные цены: прайсы, предложения поставщиков, биржа — не меньше пяти на позицию"];
    return { ...base, score: null, tone: "muted", note: "закупочной рыночной цены нет", missing: i.priceNote ? [i.priceNote, ...reason] : reason };
  }
  const d = b.detail;
  const target = i.targetMarginPct > 0 ? i.targetMarginPct : 10;
  const room = d.nmck > 0 ? ((d.nmck - d.ric) / d.nmck) * 100 : 0;
  const score = Math.round(clamp((room / target) * 100));
  return { ...base, score, tone: toneOfScore(score), note: `запас над закупочной ценой ${room >= 0 ? "" : "−"}${num(Math.abs(room))} % при цели ${num(target)} %; цен ${d.observations.total}`, missing: [] };
}

function risksFactor(i: RatingInput): FactorCore {
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
  const byId: Record<FactorId, FactorCore> = { profile, profit: profitFactor(i), price: priceFactor(i), risks: risksFactor(i), competition, reliability };
  const factors: Factor[] = FACTOR_ORDER.map((id) => ({ ...byId[id], source: FACTOR_SOURCES[id] }));

  const withData = factors.filter((f) => f.score !== null);
  // Фактор, учтённый в другом, в нехватку данных и в долю данных не входит: его вес из базы доли убирается.
  const counted = factors.filter((f) => !f.mergedInto);
  const coverage = Math.round((withData.reduce((s, f) => s + f.weight, 0) / counted.reduce((s, f) => s + f.weight, 0)) * 100);
  const blockers = blockersOf(i);
  const missing = counted.filter((f) => f.score === null).map((f) => ({ factor: f.title, items: f.missing }));
  if (coverage < MIN_COVERAGE) {
    return { status: "insufficient", preliminary: false, score: null, rawScore: null, capped: false, verdict: null, coverage, factors, blockers, missing };
  }
  const rawScore = Math.round(withData.reduce((s, f) => s + f.score! * f.weight, 0) / withData.reduce((s, f) => s + f.weight, 0));
  const cap = blockers.length > 0 ? Math.min(...blockers.map((b) => b.cap)) : 100;
  const score = Math.min(rawScore, cap);
  return { status: "ready", preliminary: coverage < FULL_COVERAGE, score, rawScore, capped: score < rawScore, verdict: verdictOf(score), coverage, factors, blockers, missing };
}
