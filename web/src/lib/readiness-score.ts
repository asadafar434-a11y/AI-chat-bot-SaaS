// Сводная готовность заявки к подаче: 0–100 баллов из трёх источников.
// Не требует ИИ: только агрегация результатов других движков.
// Модуль без зависимостей от браузера и сервера: его проверяют тесты (npm test).

import type { SubmissionGate } from "@/lib/submission-gate";
import type { ScoringReport } from "@/lib/scoring-engine";
import type { ValidationReport } from "@/lib/validation-engine";

// ─── Типы ────────────────────────────────────────────────────────────────────

export type ReadinessLevel =
  | "critical"  // есть blocking — подать нельзя
  | "low"       // серьёзные проблемы
  | "medium"    // есть что исправить
  | "high"      // почти готово
  | "ready";    // можно подавать

export type ReadinessBreakdown = {
  gate: number;       // 0–50: нет blocking/confirmable = 50
  scoring: number;    // 0–30: по баллам критериев
  validation: number; // 0–20: по доле PASS проверок
};

export type ReadinessScore = {
  score: number;           // 0–100
  level: ReadinessLevel;
  label: string;
  blocking: number;
  confirmable: number;
  breakdown: ReadinessBreakdown;
};

export type ReadinessInput = {
  gate: SubmissionGate;
  scoring?: ScoringReport | null;
  validation?: ValidationReport | null;
};

// ─── Вычисление ───────────────────────────────────────────────────────────────

export function readinessScore(input: ReadinessInput): ReadinessScore {
  const { gate, scoring, validation } = input;

  // Gate: 0–50 баллов
  let gatePoints: number;
  if (gate.blocking.length > 0) {
    gatePoints = 0; // blocking — нельзя подать
  } else {
    // Каждый неподтверждённый пункт снимает 5 баллов, минимум 10
    gatePoints = Math.max(10, 50 - gate.needsConfirmation.length * 5);
    if (gate.canSubmit) gatePoints = 50;
  }

  // Scoring: 0–30 баллов
  let scoringPoints = 30; // если нет данных о критериях — не штрафуем
  if (scoring && scoring.totalMax !== null && scoring.totalMax > 0) {
    const earned = scoring.totalPoints ?? 0;
    scoringPoints = Math.round((earned / scoring.totalMax) * 30);
  }

  // Validation: 0–20 баллов
  let validationPoints = 20; // если не запускалась — не штрафуем
  if (validation) {
    const total = validation.pass + validation.fail + validation.needsHuman;
    if (total > 0) {
      // PASS = полный балл, NEEDS_HUMAN_REVIEW = половина, FAIL = 0
      const weighted = validation.pass + validation.needsHuman * 0.5;
      validationPoints = Math.round((weighted / total) * 20);
    }
  }

  const score = gatePoints + scoringPoints + validationPoints;

  const level: ReadinessLevel =
    gate.blocking.length > 0 ? "critical"
    : !gate.canSubmit ? (score >= 65 ? "high" : score >= 45 ? "medium" : "low")
    : score >= 85 ? "ready"
    : score >= 65 ? "high"
    : score >= 45 ? "medium"
    : "low";

  const label: string =
    level === "critical" ? `${gate.blocking.length} блокирующих — исправьте перед подачей`
    : level === "ready" ? "Готово к подаче"
    : level === "high" ? "Почти готово — подтвердите оставшиеся пункты"
    : level === "medium" ? "Требуется доработка"
    : "Серьёзные проблемы — нужна проверка";

  return {
    score,
    level,
    label,
    blocking: gate.blocking.length,
    confirmable: gate.needsConfirmation.length,
    breakdown: { gate: gatePoints, scoring: scoringPoints, validation: validationPoints },
  };
}
