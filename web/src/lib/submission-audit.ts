// Финальная проверка перед подачей: все находки из разных источников сведены в единый список
// CRITICAL / WARNING / INFO. Для каждой — что не так, какое требование нарушено, источник требования,
// доказательство и как исправить. Цель — максимально снизить риск отклонения.
// Модуль без зависимостей от браузера и сервера: его проверяют тесты (npm test).

import type { ApplicationField, Completeness } from "@/lib/fields";
import type { FulfillmentPlan } from "@/lib/fulfillment";
import { CATEGORY_TITLES, type ValidationCategory, type ValidationFinding, type ValidationReport } from "@/lib/validation-engine";

export type AuditSeverity = "CRITICAL" | "WARNING" | "INFO";

export type AuditFinding = {
  id: string;
  severity: AuditSeverity;
  // Что не так — кратко
  what: string;
  // Какое требование нарушено: категория и конкретный пункт
  requirement: string;
  // Источник требования: закон, документ или раздел
  source: string;
  // Доказательство: ссылка на факт/документ или null, если его нет
  evidence: string | null;
  // Что нужно сделать
  fix: string;
};

export type AuditReport = {
  critical: number;
  warnings: number;
  info: number;
  findings: AuditFinding[];
  // Итоговый риск отклонения
  risk: "high" | "medium" | "low";
};

export type AuditInput = {
  final: Completeness;
  plans: FulfillmentPlan[];
  fields: ApplicationField[];
  // Результат детерминированной проверки — validation-engine.ts
  validation: ValidationReport;
  // Сегодняшняя дата ГГГГ-ММ-ДД — для проверки близости дедлайна
  today: string;
  // Дедлайн закупки — для проверки "меньше 3 дней"
  deadline?: { date: string };
};

// ——— Таблицы сопоставления ———

const SEVERITY: Record<ValidationCategory, { FAIL: AuditSeverity; NEEDS_HUMAN_REVIEW: AuditSeverity }> = {
  required_documents:      { FAIL: "CRITICAL", NEEDS_HUMAN_REVIEW: "WARNING" },
  required_fields:         { FAIL: "CRITICAL", NEEDS_HUMAN_REVIEW: "WARNING" },
  numeric_constraints:     { FAIL: "CRITICAL", NEEDS_HUMAN_REVIEW: "WARNING" },
  dates:                   { FAIL: "CRITICAL", NEEDS_HUMAN_REVIEW: "INFO" },
  validity_periods:        { FAIL: "CRITICAL", NEEDS_HUMAN_REVIEW: "WARNING" },
  requisite_matching:      { FAIL: "CRITICAL", NEEDS_HUMAN_REVIEW: "WARNING" },
  characteristic_matching: { FAIL: "CRITICAL", NEEDS_HUMAN_REVIEW: "WARNING" },
  evidence_presence:       { FAIL: "CRITICAL", NEEDS_HUMAN_REVIEW: "WARNING" },
  document_contradictions: { FAIL: "CRITICAL", NEEDS_HUMAN_REVIEW: "WARNING" },
};

const SOURCE: Record<ValidationCategory, string> = {
  required_documents:      "«Что подать» в закупке",
  required_fields:         "Техническое предложение",
  numeric_constraints:     "Технические условия закупки",
  dates:                   "Извещение о закупке",
  validity_periods:        "Срок действия документа",
  requisite_matching:      "Профиль компании",
  characteristic_matching: "Предложение участника",
  evidence_presence:       "Требования заказчика",
  document_contradictions: "Загруженные документы",
};

const SEVERITY_ORDER: Record<AuditSeverity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };

// ——— Подбор подсказки «что исправить» ———

function fixFor(f: ValidationFinding): string {
  const r = f.reasons[0] ?? "";
  switch (f.category) {
    case "required_documents":
      return r || "Составьте или прикрепите документ на шаге «Проверка»";
    case "required_fields":
      return f.status === "FAIL"
        ? "Заполните поле на шаге «Проверка»"
        : "Подтвердите значение на шаге «Проверка»";
    case "numeric_constraints":
      return r ? `Исправьте значение: ${r}` : "Исправьте числовое значение в ТП";
    case "dates":
      return f.status === "FAIL"
        ? "Дедлайн пройден — закупка недействительна для участия"
        : "Укажите срок подачи в реквизитах закупки";
    case "validity_periods":
      return f.status === "FAIL"
        ? "Замените документ актуальной версией в «Базе доказательств»"
        : "Проверьте срок действия на дату подачи закупки";
    case "requisite_matching":
      return f.status === "FAIL"
        ? "Заполните реквизит в «Профиле компании»"
        : "Проверьте контрольное число (ИНН, КПП, БИК) в профиле";
    case "characteristic_matching":
      return "Подтвердите или исправьте характеристику на шаге «Проверка»";
    case "evidence_presence":
      return f.status === "FAIL"
        ? "Добавьте документ в «Базу доказательств» в профиле компании"
        : "Уточните или замените документ в «Базе доказательств»";
    case "document_contradictions":
      return f.status === "FAIL"
        ? "Проверьте соответствие дат в загруженных документах закупки"
        : "Проверьте противоречивые данные в документах закупки";
    default:
      return r || "Исправьте нарушение и проверьте снова";
  }
}

// ——— Главная функция ———

export function auditReport(input: AuditInput): AuditReport {
  const { validation, plans, today, deadline } = input;
  const findings: AuditFinding[] = [];

  // Из ValidationReport: все находки, кроме PASS
  for (const f of validation.findings) {
    if (f.status === "PASS") continue;
    const map = SEVERITY[f.category];
    if (!map) continue;
    const severity = map[f.status as "FAIL" | "NEEDS_HUMAN_REVIEW"];
    if (!severity) continue;

    // Для «Что подать» обогащаем источником из плана выполнения
    let source = SOURCE[f.category] ?? f.category;
    if (f.category === "required_documents") {
      const plan = plans.find(
        (p) => f.title === p.item.text.slice(0, 60) || f.title.startsWith(p.item.text.slice(0, 30)),
      );
      if (plan?.basis) source = plan.basis;
    }

    findings.push({
      id: f.id,
      severity,
      what: f.title,
      requirement: [CATEGORY_TITLES[f.category], f.reasons[0]].filter(Boolean).join(": "),
      source,
      evidence: f.ref ?? null,
      fix: fixFor(f),
    });
  }

  // Близость дедлайна: 0–3 дня → WARNING (если CRITICAL по датам ещё нет)
  if (deadline?.date && !findings.some((f) => f.id.startsWith("dates:") && f.severity === "CRITICAL")) {
    const ms = new Date(deadline.date).getTime() - new Date(today).getTime();
    const daysLeft = Math.floor(ms / 86_400_000);
    if (daysLeft >= 0 && daysLeft <= 3) {
      findings.push({
        id: "deadline_proximity",
        severity: "WARNING",
        what: daysLeft === 0 ? "До дедлайна остался день или меньше" : `До дедлайна ${daysLeft} дн.`,
        requirement: "Срок подачи заявки",
        source: "Извещение о закупке",
        evidence: null,
        fix: "Убедитесь, что пакет готов к подаче: скачайте, подпишите и отправьте на площадке",
      });
    }
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const critical = findings.filter((f) => f.severity === "CRITICAL").length;
  const warnings = findings.filter((f) => f.severity === "WARNING").length;
  const info = findings.filter((f) => f.severity === "INFO").length;
  const risk: AuditReport["risk"] = critical > 0 ? "high" : warnings > 0 ? "medium" : "low";

  return { critical, warnings, info, findings, risk };
}
