// Движок оценки по критериям: Требование → Метрика → Доказательство → Значение компании → Балл.
// Расчёты выполняет код. ИИ только извлекает данные — здесь только детерминированное вычисление.
// Не прогнозирует победу. Показывает объективно рассчитанные баллы и что для них нужно.
// Модуль без зависимостей от браузера и сервера: его проверяют тесты (npm test).

import type { Fact, FactKind } from "@/lib/evidence-base";
import { groupCriteria, type Criteria, type ScoredRow } from "@/lib/criteria";

// ——— Типы формул ———

export type ScoringFormula =
  | { kind: "per_unit"; pointsEach: number; max: number | null }     // N баллов за каждый, максимум M
  | { kind: "binary"; points: number }                               // X баллов при наличии / 0 при отсутствии
  | { kind: "threshold"; levels: Array<{ min: number; points: number }> } // не менее N → X баллов
  | { kind: "price" }                                                // цена — считается площадкой
  | { kind: "unknown" };                                             // формулу не удалось распознать

// ——— Значение компании ———

export type CompanyValue =
  | { kind: "count"; n: number }       // сколько единиц (договоры, специалисты, оборудование)
  | { kind: "present"; yes: boolean }  // есть / нет (лицензия, сертификат)
  | { kind: "unknown" };               // не удалось определить

// ——— Одна строка критериев со скорингом ———

export type ScoredCriterion = {
  row: ScoredRow;
  formula: ScoringFormula;
  // Виды фактов, которые подтверждают этот критерий
  factKinds: FactKind[];
  // Найденные факты из базы доказательств
  facts: Fact[];
  // Значение компании, извлечённое из фактов
  value: CompanyValue;
  // Рассчитанные баллы: null если формула не распознана или значение неизвестно
  points: number | null;
  // Максимально возможные баллы по этому критерию (доля × 100)
  maxPoints: number | null;
  // true — для точного расчёта нужны данные, которые система сама не извлекает (суммы договоров)
  needsExtraction: boolean;
  // Почему points === null или 0
  gap: string | null;
};

export type ScoringGroup = {
  name: string;
  weight: number | null;
  weightText: string;
  criteria: ScoredCriterion[];
  groupPoints: number | null;
  groupMax: number | null;
};

export type ScoringReport = {
  groups: ScoringGroup[];
  totalPoints: number | null;
  totalMax: number | null;
  howWins: Criteria["howWins"];
};

export type ScoringInput = {
  criteria: Criteria;
  facts: Fact[];
};

// ——— Разбор формулы баллов ———

export function parseFormula(scoring: string): ScoringFormula {
  if (!scoring.trim()) return { kind: "unknown" };
  const t = scoring;

  // Ценовой критерий — отдельный расчёт площадки
  if (/^цена/i.test(t.trimStart()) || /ценов.*контракт/i.test(t)) return { kind: "price" };

  // Бинарное: "30 баллов при наличии" / "при наличии — 30" / "наличие — X баллов"
  const binA = /(\d+(?:[,\.]\d+)?)\s*балл[а-яё]*\s+при\s+наличии/i.exec(t);
  const binB = /при\s+наличии[^.;]{0,30}?(\d+(?:[,\.]\d+)?)\s*балл/i.exec(t);
  const binC = /наличи[е-яё]+[^.;]{0,30}?[—\-–]\s*(\d+(?:[,\.]\d+)?)\s*балл/i.exec(t);
  const bm = binA ?? binB ?? binC;
  if (bm) {
    const raw = (binA?.[1] ?? binB?.[1] ?? binC?.[1] ?? "0").replace(",", ".");
    const pts = parseFloat(raw);
    if (!isNaN(pts)) return { kind: "binary", points: pts };
  }

  // За единицу: "5 баллов за каждый" / "за каждого — 5 баллов"
  const perA = /(\d+(?:[,\.]\d+)?)\s*балл[а-яё]*\s+за\s+каждый[а-яё]*/i.exec(t);
  const perB = /за\s+каждый[а-яё]*[^.;]{0,30}?(\d+(?:[,\.]\d+)?)\s*балл/i.exec(t);
  const pm = perA ?? perB;
  if (pm) {
    const each = parseFloat((pm[1]!).replace(",", "."));
    if (!isNaN(each)) {
      const maxM = /максимум[^.;]*?(\d+(?:[,\.]\d+)?)\s*балл/i.exec(t);
      const max = maxM ? parseFloat(maxM[1]!.replace(",", ".")) : null;
      return { kind: "per_unit", pointsEach: each, max: max && !isNaN(max) ? max : null };
    }
  }

  // Пороги: "не менее N — X баллов" / "от N — X баллов"
  const levels: Array<{ min: number; points: number }> = [];
  const tRe = /(?:не\s*менее|от)\s*(\d+(?:[,\.]\d+)?)[^.;\d]{0,40}?(\d+(?:[,\.]\d+)?)\s*балл/gi;
  let m: RegExpExecArray | null;
  while ((m = tRe.exec(t)) !== null) {
    const min = parseFloat(m[1]!.replace(",", "."));
    const pts = parseFloat(m[2]!.replace(",", "."));
    if (!isNaN(min) && !isNaN(pts)) levels.push({ min, points: pts });
  }
  if (levels.length > 0) {
    levels.sort((a, b) => a.min - b.min);
    return { kind: "threshold", levels };
  }

  return { kind: "unknown" };
}

// ——— Виды фактов по тексту «Что приложить» ———

export function proofKinds(proof: string): FactKind[] {
  if (!proof) return [];
  const kinds: FactKind[] = [];
  if (/лиценз|сро|допус|членств|самор/i.test(proof)) kinds.push("license");
  if (/сертиф|свидетельств|регистр|удостовер/i.test(proof)) kinds.push("certificate");
  if (/договор|контракт|опыт\b|испол|аналог|акт\b|реестр/i.test(proof)) kinds.push("experience");
  if (/специал|работни|сотрудн|трудов|штатн|персон|кадр/i.test(proof)) kinds.push("employee");
  if (/квалиф|диплом|подготовк/i.test(proof)) kinds.push("qualification");
  if (/оборудован|техник|транспорт|матери|площадк/i.test(proof)) kinds.push("equipment");
  return [...new Set(kinds)];
}

// ——— Извлечение значения компании из фактов ———

export function extractValue(facts: Fact[], kinds: FactKind[]): CompanyValue {
  if (facts.length === 0) {
    // Различаем: "нет лицензии" от "нет договоров"
    const isCount = kinds.some((k) => ["experience", "employee", "qualification", "equipment"].includes(k));
    return isCount ? { kind: "count", n: 0 } : { kind: "present", yes: false };
  }
  const isCount = kinds.some((k) => ["experience", "employee", "qualification", "equipment"].includes(k));
  return isCount ? { kind: "count", n: facts.length } : { kind: "present", yes: true };
}

// ——— Применение формулы ———

export function applyFormula(formula: ScoringFormula, share: number | null, value: CompanyValue): number | null {
  if (formula.kind === "unknown" || formula.kind === "price") return null;
  const maxFromShare = share !== null ? share : null;

  if (formula.kind === "binary") {
    if (value.kind !== "present") return null;
    return value.yes ? formula.points : 0;
  }
  if (formula.kind === "per_unit") {
    if (value.kind !== "count") return null;
    const raw = value.n * formula.pointsEach;
    const cap = formula.max ?? maxFromShare;
    return cap !== null ? Math.min(raw, cap) : raw;
  }
  if (formula.kind === "threshold") {
    if (value.kind !== "count") return null;
    let pts = 0;
    for (const level of formula.levels) {
      if (value.n >= level.min) pts = level.points;
    }
    return pts;
  }
  return null;
}

function gapFor(formula: ScoringFormula, value: CompanyValue, kinds: FactKind[]): string | null {
  if (formula.kind === "unknown") return "Формула начисления баллов не распознана автоматически";
  if (formula.kind === "price") return "Баллы за цену считает площадка при сравнении заявок";
  if (kinds.length === 0) return "Документы для подтверждения не указаны — баллы не рассчитаны";
  if (value.kind === "present" && !value.yes) return "Нет подходящих документов в базе доказательств";
  if (value.kind === "count" && value.n === 0) return "Нет подходящих фактов в базе доказательств";
  return null;
}

// ——— Главная функция ———

export function scoringReport({ criteria, facts }: ScoringInput): ScoringReport {
  if (criteria.howWins !== "points" || criteria.rows.length === 0) {
    return { groups: [], totalPoints: null, totalMax: null, howWins: criteria.howWins };
  }

  const groups = groupCriteria(criteria.rows);
  let totalPoints: number | null = 0;
  let totalMax: number | null = 0;

  const resultGroups: ScoringGroup[] = groups.map((group) => {
    let groupPoints: number | null = 0;
    let groupMax: number | null = 0;

    const criteriaRows: ScoredCriterion[] = group.rows.map((row): ScoredCriterion => {
      const formula = parseFormula(row.scoring);
      const kinds = proofKinds(row.proof);
      const matching = kinds.length > 0 ? facts.filter((f) => kinds.includes(f.kind as FactKind)) : [];
      const value = extractValue(matching, kinds);

      const maxPoints = row.share !== null ? Math.round(row.share * 100) / 100 : null;
      const points = applyFormula(formula, row.share, value);
      const needsExtraction = formula.kind === "per_unit" || formula.kind === "threshold";
      const gap = gapFor(formula, value, kinds);

      return { row, formula, factKinds: kinds, facts: matching, value, points, maxPoints, needsExtraction, gap };
    });

    for (const c of criteriaRows) {
      if (c.points === null || groupPoints === null) groupPoints = null;
      else groupPoints = Math.round((groupPoints + c.points) * 100) / 100;
      if (c.maxPoints === null || groupMax === null) groupMax = null;
      else groupMax = Math.round((groupMax + c.maxPoints) * 100) / 100;
    }

    if (groupPoints === null || totalPoints === null) totalPoints = null;
    else totalPoints = Math.round((totalPoints + groupPoints) * 100) / 100;
    if (groupMax === null || totalMax === null) totalMax = null;
    else totalMax = Math.round((totalMax + groupMax) * 100) / 100;

    return { name: group.name, weight: group.weight, weightText: group.weightText, criteria: criteriaRows, groupPoints, groupMax };
  });

  return { groups: resultGroups, totalPoints, totalMax, howWins: criteria.howWins };
}
