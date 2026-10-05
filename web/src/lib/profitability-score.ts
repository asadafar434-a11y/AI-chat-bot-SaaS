// Оценка выгодности участия в закупке: стоит ли тратить время на заявку?
// Не прогнозирует победу и не даёт финансовых советов — только объективные сигналы.
// Модуль без зависимостей от браузера и сервера: его проверяют тесты (npm test).

// ─── Типы ────────────────────────────────────────────────────────────────────

export type ProfitabilityRating = "recommended" | "consider" | "risky" | "skip";

export type ProfitabilityInput = {
  /** НМЦК в рублях */
  nmck: number;
  /** Насколько хорошо компания соответствует требованиям: 0–1 (из product-match или readiness-score) */
  requirementsMatch: number;
  /** Количество требований (сложность заявки) */
  requirementsCount: number;
  /** Дней до дедлайна подачи (undefined = неизвестно) */
  deadlineDays?: number;
  /** Оценочная стоимость исполнения / НМЦК: 0–1 (0.7 = маржа 30%). undefined = неизвестно */
  estimatedCostRatio?: number;
  /** Количество известных конкурентов (undefined = неизвестно) */
  competitorCount?: number;
  /** Оценка надёжности заказчика: 0–1 (из истории закупок). undefined = неизвестно */
  customerScore?: number;
};

export type ProfitabilitySignal = {
  name: string;
  description: string;
  points: number;    // реальный вклад в итоговый балл (может быть отрицательным)
  positive: boolean;
};

export type ProfitabilityScore = {
  score: number;                    // 0–100
  rating: ProfitabilityRating;
  label: string;
  signals: ProfitabilitySignal[];
  complexity: "low" | "medium" | "high";
  estimatedMargin: number | null;   // % маржи, если estimatedCostRatio задан
};

// ─── Расчёт ──────────────────────────────────────────────────────────────────

export function profitabilityScore(input: ProfitabilityInput): ProfitabilityScore {
  const signals: ProfitabilitySignal[] = [];
  let score = 40; // базовый балл

  // 1. Соответствие требованиям (0–30 баллов)
  const matchPoints = Math.round(input.requirementsMatch * 30);
  signals.push({
    name: "Соответствие требованиям",
    description: `${Math.round(input.requirementsMatch * 100)}% требований выполнены`,
    points: matchPoints,
    positive: input.requirementsMatch >= 0.7,
  });
  score += matchPoints;

  // 2. Сложность заявки (штраф)
  const complexity: ProfitabilityScore["complexity"] =
    input.requirementsCount <= 5 ? "low"
    : input.requirementsCount <= 15 ? "medium"
    : "high";
  const complexityPenalty = complexity === "low" ? 0 : complexity === "medium" ? -5 : -10;
  if (complexityPenalty !== 0) {
    signals.push({
      name: "Сложность заявки",
      description: `${input.requirementsCount} требований — ${complexityLabel(complexity)}`,
      points: complexityPenalty,
      positive: false,
    });
    score += complexityPenalty;
  }

  // 3. Маржа (если известна)
  let estimatedMargin: number | null = null;
  if (input.estimatedCostRatio != null) {
    estimatedMargin = Math.round((1 - input.estimatedCostRatio) * 100);
    const marginPoints = estimatedMargin >= 20 ? 15 : estimatedMargin >= 10 ? 8 : estimatedMargin >= 0 ? 0 : -15;
    signals.push({
      name: "Расчётная маржа",
      description: `~${estimatedMargin}% от НМЦК`,
      points: marginPoints,
      positive: estimatedMargin >= 10,
    });
    score += marginPoints;
  }

  // 4. Дедлайн
  if (input.deadlineDays != null) {
    const deadlinePoints =
      input.deadlineDays >= 7 ? 5
      : input.deadlineDays >= 3 ? 0
      : -10;
    signals.push({
      name: "Срок до подачи",
      description:
        input.deadlineDays === 0 ? "Сегодня — очень мало времени"
        : `${input.deadlineDays} ${dayWord(input.deadlineDays)}`,
      points: deadlinePoints,
      positive: input.deadlineDays >= 7,
    });
    score += deadlinePoints;
  }

  // 5. Конкуренты (если известны)
  if (input.competitorCount != null) {
    const compPoints = input.competitorCount === 0 ? 10 : input.competitorCount <= 2 ? 5 : -5;
    signals.push({
      name: "Конкурентность",
      description: input.competitorCount === 0
        ? "Конкурентов не обнаружено"
        : `${input.competitorCount} конкурент${input.competitorCount === 1 ? "" : "а/ов"}`,
      points: compPoints,
      positive: input.competitorCount <= 2,
    });
    score += compPoints;
  }

  // 6. Репутация заказчика
  if (input.customerScore != null) {
    const custPoints = Math.round((input.customerScore - 0.5) * 10);
    signals.push({
      name: "Надёжность заказчика",
      description: `${Math.round(input.customerScore * 100)}/100 по истории закупок`,
      points: custPoints,
      positive: input.customerScore >= 0.6,
    });
    score += custPoints;
  }

  score = Math.max(0, Math.min(100, score));

  const rating: ProfitabilityRating =
    score >= 70 ? "recommended"
    : score >= 50 ? "consider"
    : score >= 30 ? "risky"
    : "skip";

  const label =
    rating === "recommended" ? "Рекомендуем участвовать"
    : rating === "consider" ? "Можно участвовать — взвесьте риски"
    : rating === "risky" ? "Высокий риск — участвуйте осторожно"
    : "Не рекомендуем участвовать";

  return { score, rating, label, signals, complexity, estimatedMargin };
}

// ─── Утилиты ─────────────────────────────────────────────────────────────────

function complexityLabel(c: "low" | "medium" | "high"): string {
  return c === "low" ? "простая заявка" : c === "medium" ? "средняя сложность" : "сложная заявка";
}

function dayWord(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return "день";
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return "дня";
  return "дней";
}
