// Сравнение товара/услуги компании с требованиями ТЗ по характеристикам.
// Каждое числовое или текстовое требование сопоставляется с тем, что предлагает компания.
// Модуль без зависимостей от браузера и сервера: его проверяют тесты (npm test).

import type { ReqItem } from "@/lib/requirements";
import type { Condition } from "@/lib/conditions";

// ─── Типы ────────────────────────────────────────────────────────────────────

/** Характеристика товара или услуги компании */
export type OfferedSpec = {
  name: string;   // название характеристики, напр. «Гарантия»
  value: string;  // значение, напр. «24 месяца» или «IP54»
};

export type MatchStatus = "pass" | "fail" | "partial" | "unknown";

export type CharacteristicMatch = {
  name: string;           // название характеристики из ТЗ
  required: string;       // что требует ТЗ
  offered: string | null; // что предлагает компания (null = нет данных)
  status: MatchStatus;
  detail: string | null;  // пояснение: «требуется ≥24 мес, предложено 12 — НЕ СООТВЕТСТВУЕТ»
};

export type ProductMatchResult = {
  matches: CharacteristicMatch[];
  passCount: number;
  failCount: number;
  partialCount: number;
  unknownCount: number;
  /** 0–100: (pass + partial*0.5) / total * 100 */
  score: number;
  overallStatus: "ready" | "issues" | "incomplete";
};

// ─── Сравнение ────────────────────────────────────────────────────────────────

export function matchProduct(
  offered: OfferedSpec[],
  requirements: ReqItem[],
): ProductMatchResult {
  // Берём только требования к товару/услуге с числовыми условиями или конкретным текстом
  const productReqs = requirements.filter(
    (r) => r.type === "product" || r.type === "service",
  );

  const matches: CharacteristicMatch[] = productReqs.map((req) => {
    const spec = findSpec(offered, req.text);
    const required = req.quote ?? req.text;

    if (!spec) {
      return {
        name: shortName(req.text),
        required,
        offered: null,
        status: "unknown",
        detail: "Нет данных о товаре по этому требованию",
      };
    }

    // Числовое сравнение через conditions
    if (req.numbers && req.numbers.length > 0) {
      return numericMatch(req.text, required, spec, req.numbers);
    }

    // Текстовое сравнение
    return textMatch(req.text, required, spec);
  });

  const passCount = matches.filter((m) => m.status === "pass").length;
  const failCount = matches.filter((m) => m.status === "fail").length;
  const partialCount = matches.filter((m) => m.status === "partial").length;
  const unknownCount = matches.filter((m) => m.status === "unknown").length;

  const total = matches.length;
  const score =
    total === 0
      ? 100
      : Math.round(((passCount + partialCount * 0.5) / total) * 100);

  const overallStatus: ProductMatchResult["overallStatus"] =
    failCount > 0 ? "issues" : unknownCount > total / 2 ? "incomplete" : "ready";

  return { matches, passCount, failCount, partialCount, unknownCount, score, overallStatus };
}

// ─── Числовое сравнение ───────────────────────────────────────────────────────

function numericMatch(
  reqText: string,
  required: string,
  spec: OfferedSpec,
  conditions: Condition[],
): CharacteristicMatch {
  const offeredNum = parseFloat(spec.value.replace(/[^\d.,]/g, "").replace(",", "."));
  if (isNaN(offeredNum)) {
    return {
      name: shortName(reqText),
      required,
      offered: spec.value,
      status: "unknown",
      detail: "Не удалось разобрать числовое значение товара",
    };
  }

  for (const cond of conditions) {
    const { op, value, value2 } = cond;
    let pass = false;
    if (op === "min") pass = offeredNum >= value;
    else if (op === "max") pass = offeredNum <= value;
    else if (op === "gt") pass = offeredNum > value;
    else if (op === "lt") pass = offeredNum < value;
    else if (op === "exact") pass = offeredNum === value;
    else if (op === "range" && value2 != null) pass = offeredNum >= value && offeredNum <= value2;

    if (!pass) {
      const condText = opText(op, value, value2);
      return {
        name: shortName(reqText),
        required,
        offered: spec.value,
        status: "fail",
        detail: `Требуется ${condText}, предложено ${spec.value} — НЕ СООТВЕТСТВУЕТ`,
      };
    }
  }

  return {
    name: shortName(reqText),
    required,
    offered: spec.value,
    status: "pass",
    detail: null,
  };
}

// ─── Текстовое сравнение (Жаккар) ────────────────────────────────────────────

function textMatch(
  reqText: string,
  required: string,
  spec: OfferedSpec,
): CharacteristicMatch {
  const a = required.toLowerCase();
  const b = spec.value.toLowerCase();

  // Точное вхождение
  if (a.includes(b) || b.includes(a.slice(0, 30))) {
    return { name: shortName(reqText), required, offered: spec.value, status: "pass", detail: null };
  }

  // Частичное совпадение по словам
  const wordsA = tokenize(a);
  const wordsB = tokenize(b);
  const intersection = wordsA.filter((w) => wordsB.includes(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  const jaccard = union === 0 ? 0 : intersection / union;

  if (jaccard >= 0.4) {
    return { name: shortName(reqText), required, offered: spec.value, status: "partial", detail: "Частичное совпадение — уточните вручную" };
  }

  return {
    name: shortName(reqText),
    required,
    offered: spec.value,
    status: "unknown",
    detail: "Не удалось автоматически сопоставить — проверьте вручную",
  };
}

// ─── Поиск характеристики по названию ────────────────────────────────────────

function findSpec(offered: OfferedSpec[], reqText: string): OfferedSpec | null {
  const needle = reqText.toLowerCase();
  // Точное вхождение названия
  const exact = offered.find((s) => needle.includes(s.name.toLowerCase()));
  if (exact) return exact;
  // Нечёткое по первым словам
  const firstWords = needle.split(/\s+/).slice(0, 4).join(" ");
  return offered.find((s) => {
    const sWords = s.name.toLowerCase().split(/\s+/);
    return sWords.some((w) => w.length > 3 && firstWords.includes(w));
  }) ?? null;
}

function shortName(text: string): string {
  return text.length > 60 ? text.slice(0, 57) + "…" : text;
}

function tokenize(s: string): string[] {
  return s.split(/\s+/).filter((w) => w.length > 2);
}

function opText(op: string, value: number, value2?: number): string {
  if (op === "min") return `не менее ${value}`;
  if (op === "max") return `не более ${value}`;
  if (op === "gt") return `больше ${value}`;
  if (op === "lt") return `меньше ${value}`;
  if (op === "exact") return `ровно ${value}`;
  if (op === "range") return `от ${value} до ${value2}`;
  return String(value);
}
