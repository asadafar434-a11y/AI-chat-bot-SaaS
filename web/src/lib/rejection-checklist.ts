// Чек-лист отклонения: каждое требование → статус соответствия → что делать.
// Показывает строку «Требование / Цитата / В заявке / Статус / Действие» для каждого пункта.
// Модуль без зависимостей от браузера и сервера: его проверяют тесты (npm test).

import type { ReqItem, Mandatory, ReqType } from "@/lib/requirements";
import type { ApplicationField } from "@/lib/fields";
import type { ValidationFinding } from "@/lib/validation-engine";

// ─── Типы ────────────────────────────────────────────────────────────────────

export type ChecklistStatus =
  | "pass"     // требование выполнено
  | "fail"     // требование нарушено — отклонят
  | "review"   // неоднозначно — проверьте вручную
  | "missing"; // поле не заполнено / документ не предоставлен

export type ChecklistRow = {
  id: string;
  requirement: string;     // текст требования
  mandatory: Mandatory;    // required/optional/conditional/scored/unclear
  kind: ReqType;
  quote: string | null;    // цитата из ТЗ
  quoteVerified: boolean;  // цитата найдена дословно
  inApplication: string | null; // что указано в полях заявки
  status: ChecklistStatus;
  action: string | null;   // что сделать, если не pass
};

export type RejectionChecklist = {
  rows: ChecklistRow[];
  passCount: number;
  failCount: number;
  reviewCount: number;
  missingCount: number;
  /** Нет fail/missing по обязательным пунктам */
  readyToSubmit: boolean;
};

// ─── Построение чек-листа ─────────────────────────────────────────────────────

export function buildChecklist(
  requirements: ReqItem[],
  fields: ApplicationField[],
  findings: ValidationFinding[] = [],
): RejectionChecklist {
  const fieldMap = new Map(fields.map((f) => [f.key, f]));
  // Индекс finding по части требования (ищем по тексту)
  const failedCategories = new Set(
    findings.filter((f) => f.status === "FAIL").map((f) => f.category),
  );

  const rows: ChecklistRow[] = requirements.map((req, i) => {
    const id = `req-${i}`;

    // Попытка найти соответствующее поле заявки по ключу (document/participant → look in fields)
    const relatedField = Array.from(fieldMap.values()).find((f) =>
      fieldMatch(f.label, req.text),
    ) ?? null;

    const inApplication = relatedField
      ? (relatedField.value || null)
      : null;

    // Статус: FAIL из validation findings, иначе из состояния поля/цитаты
    let status: ChecklistStatus;
    let action: string | null = null;

    if (req.mandatory === "required" && failedCategories.size > 0 && !req.verified) {
      status = "review";
      action = "Цитата не найдена дословно — проверьте вручную";
    } else if (relatedField?.status === "invalid") {
      status = "fail";
      action = relatedField.problem ?? "Исправьте значение поля";
    } else if (relatedField?.status === "needs_input" && req.mandatory === "required") {
      status = "missing";
      action = `Заполните поле «${relatedField.label}»`;
    } else if (relatedField?.status === "needs_confirmation") {
      status = "review";
      action = "Подтвердите значение, заполненное ИИ";
    } else if (!req.verified && req.mandatory === "required") {
      status = "review";
      action = "Цитата требования не найдена — уточните вручную";
    } else if (inApplication || req.mandatory !== "required") {
      status = "pass";
    } else {
      status = "missing";
      action = "Добавьте подтверждающий документ или заполните поле";
    }

    return {
      id,
      requirement: req.text,
      mandatory: req.mandatory ?? "unclear",
      kind: req.type ?? "other",
      quote: req.quote ?? null,
      quoteVerified: req.verified,
      inApplication,
      status,
      action,
    };
  });

  const passCount = rows.filter((r) => r.status === "pass").length;
  const failCount = rows.filter((r) => r.status === "fail").length;
  const reviewCount = rows.filter((r) => r.status === "review").length;
  const missingCount = rows.filter((r) => r.status === "missing").length;

  const requiredRows = rows.filter((r) => r.mandatory === "required");
  const readyToSubmit =
    requiredRows.filter((r) => r.status === "fail" || r.status === "missing").length === 0;

  return { rows, passCount, failCount, reviewCount, missingCount, readyToSubmit };
}

// ─── Утилита: нечёткое совпадение названия поля и требования ─────────────────

function fieldMatch(fieldLabel: string, reqText: string): boolean {
  const a = fieldLabel.toLowerCase();
  const b = reqText.toLowerCase().slice(0, 80);
  const words = a.split(/\s+/).filter((w) => w.length > 3);
  const matches = words.filter((w) => b.includes(w));
  return matches.length >= Math.ceil(words.length * 0.5) && words.length >= 2;
}
