// Детерминированный движок проверки заявки: 9 категорий проверок без ИИ.
// Статусы: PASS — выполнено; FAIL — нарушение, заявку могут отклонить; NEEDS_HUMAN_REVIEW — система не решает, нужен человек.
// ИИ извлекает и интерпретирует данные; критические проверки — только детерминированные правила.
// Модуль без зависимостей от браузера и сервера: его проверяют тесты (npm test).

import type { ApplicationField } from "@/lib/fields";
import type { Fact } from "@/lib/evidence-base";
import { validityAt, EXPIRING_DAYS, dayOf } from "@/lib/evidence-base";
import { checkPurchase, onDateOf } from "@/lib/evidence-match";
import type { Base } from "@/lib/evidence-match";
import { fulfillmentOf } from "@/lib/fulfillment";
import type { Profile } from "@/lib/profile";
import type { Purchase } from "@/lib/purchase";
import { profileProblems } from "@/lib/requisites-check";

export type ValidationStatus = "PASS" | "FAIL" | "NEEDS_HUMAN_REVIEW";

export const CATEGORY_TITLES = {
  required_documents: "Обязательные документы",
  validity_periods: "Сроки действия",
  numeric_constraints: "Числовые ограничения",
  dates: "Даты",
  requisite_matching: "Реквизиты",
  characteristic_matching: "Соответствие характеристик",
  evidence_presence: "Наличие доказательств",
  document_contradictions: "Противоречия в документах",
  required_fields: "Заполненность полей",
} as const;

export type ValidationCategory = keyof typeof CATEGORY_TITLES;

export type ValidationFinding = {
  id: string;
  category: ValidationCategory;
  status: ValidationStatus;
  // Краткое название находки: «Декларация о принадлежности к МСП не составлена».
  title: string;
  // Почему такой статус, по пунктам.
  reasons: string[];
  // Ключ поля, id факта или цитата — откуда взят вывод.
  ref?: string;
};

export type ValidationReport = {
  // Общий итог: худший из всех статусов.
  status: ValidationStatus;
  findings: ValidationFinding[];
  pass: number;
  fail: number;
  needsHuman: number;
};

export type ValidationInput = {
  purchase: Purchase;
  profile: Profile;
  facts: Fact[];
  // Карта полей заявки (fieldsOf из lib/fields.ts): нужна для проверок полей, числовых ограничений, требуемых документов.
  fields: ApplicationField[];
  // Сегодня — ГГГГ-ММ-ДД: на какую дату проверять.
  today: string;
};

const SEVERITY: Record<ValidationStatus, number> = { PASS: 0, NEEDS_HUMAN_REVIEW: 1, FAIL: 2 };
export const worstStatus = (statuses: ValidationStatus[]): ValidationStatus =>
  statuses.reduce<ValidationStatus>((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a), "PASS");

// ——— Маппинги ———

type EvidenceStatus = "ok" | "expiring" | "expired" | "mismatch" | "needs_evidence" | "need_human";

function evidenceToValidation(s: EvidenceStatus): ValidationStatus {
  if (s === "ok") return "PASS";
  if (s === "expiring" || s === "need_human") return "NEEDS_HUMAN_REVIEW";
  return "FAIL";
}

// ——— 1. Обязательные документы ———
// Каждый пункт «Что подать», без которого площадка вернёт или заказчик отклонит заявку.

function checkRequiredDocuments(input: ValidationInput): ValidationFinding[] {
  const plans = fulfillmentOf(input.purchase, { profile: input.profile, fields: input.fields });
  const findings: ValidationFinding[] = [];

  for (const plan of plans) {
    if (!plan.mandatory || !plan.blocks) continue;
    let status: ValidationStatus;
    switch (plan.status) {
      case "done":
      case "none":
        status = "PASS";
        break;
      case "confirm":
        status = "NEEDS_HUMAN_REVIEW";
        break;
      case "todo":
        status = "FAIL";
        break;
    }
    if (status === "PASS") continue;
    findings.push({
      id: `req_doc:${plan.item.text.slice(0, 80)}`,
      category: "required_documents",
      status,
      title: plan.todo,
      reasons: [
        status === "FAIL"
          ? "Документ не составлен или не приложен — без него заявку могут отклонить"
          : "Требует проверки или подтверждения перед подачей",
        ...(plan.basis ? [`Основание: ${plan.basis}`] : []),
      ],
      ref: plan.item.quote || plan.item.text,
    });
  }
  return findings;
}

// ——— 2. Сроки действия ———
// Лицензии, сертификаты, квалификация: просрочено — нельзя подать, скоро истечёт — риск.

const NEEDS_TERM = new Set(["license", "certificate", "qualification"]);
const dm = (iso: string) => iso.split("-").reverse().join(".");

function checkValidityPeriods(input: ValidationInput): ValidationFinding[] {
  const on = onDateOf(input.purchase.deadline, input.today);
  const findings: ValidationFinding[] = [];

  for (const fact of input.facts) {
    const at = validityAt(fact.validity, on);
    let status: ValidationStatus | null = null;
    let reason: string;

    if (at.state === "expired") {
      status = "FAIL";
      reason = `Просрочен: действовал до ${dm(fact.validity.until!)}, а дата подачи — ${dm(on)}`;
    } else if (at.state === "not_started") {
      status = "FAIL";
      reason = `Начнёт действовать ${dm(fact.validity.from!)} — позже даты подачи`;
    } else if (at.state === "valid" && at.days !== undefined && at.days <= EXPIRING_DAYS) {
      status = "NEEDS_HUMAN_REVIEW";
      reason = `Действует до ${dm(fact.validity.until!)} — кончается в течение ${at.days} дн. после подачи`;
    } else if (at.state === "unknown" && NEEDS_TERM.has(fact.kind)) {
      status = "NEEDS_HUMAN_REVIEW";
      reason = `Не указан срок действия — укажите дату окончания или «бессрочно»`;
    }

    if (status === null) continue;
    findings.push({
      id: `validity:${fact.id}`,
      category: "validity_periods",
      status,
      title: `«${fact.title}»`,
      reasons: [reason!],
      ref: fact.id,
    });
  }
  return findings;
}

// ——— 3. Числовые ограничения ———
// Участник вписал число — оно не укладывается в условие заказчика.

function checkNumericConstraints(input: ValidationInput): ValidationFinding[] {
  return input.fields
    .filter((f) => f.status === "invalid" && f.problem)
    .map((f) => ({
      id: `numeric:${f.key}`,
      category: "numeric_constraints" as const,
      status: "FAIL" as const,
      title: f.label || f.context || "Числовое условие нарушено",
      reasons: [f.problem!],
      ref: f.key,
    }));
}

// ——— 4. Даты ———
// Срок подачи: он уже прошёл — заявку не примут.

function checkDates(input: ValidationInput): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const dl = input.purchase.deadline;

  if (!dl.date) {
    findings.push({
      id: "dates:deadline_missing",
      category: "dates",
      status: "NEEDS_HUMAN_REVIEW",
      title: "Срок подачи заявок не известен",
      reasons: ["Дата окончания подачи не найдена в документах — уточните на площадке"],
    });
    return findings;
  }

  const deadlineDay = dayOf(dl.date);
  const todayDay = dayOf(input.today);

  if (deadlineDay === null) {
    findings.push({
      id: "dates:deadline_invalid",
      category: "dates",
      status: "NEEDS_HUMAN_REVIEW",
      title: "Не удалось разобрать дату подачи",
      reasons: [`Дата «${dl.date}» в документах не распознана — проверьте вручную`],
    });
    return findings;
  }

  if (todayDay !== null && deadlineDay < todayDay) {
    findings.push({
      id: "dates:deadline_past",
      category: "dates",
      status: "FAIL",
      title: "Срок подачи заявок истёк",
      reasons: [
        `Дедлайн был ${dm(dl.date)}${dl.time ? ` в ${dl.time}` : ""}${dl.zone ? ` (${dl.zone})` : ""}, сегодня ${dm(input.today)}`,
      ],
    });
  }

  return findings;
}

// ——— 5. Реквизиты ———
// ИНН, ОГРН, БИК, счета: контрольные цифры и соответствие друг другу.

function checkRequisiteMatching(input: ValidationInput): ValidationFinding[] {
  const problems = profileProblems(input.profile);
  const findings: ValidationFinding[] = [];

  for (const [key, message] of Object.entries(problems)) {
    if (!message) continue;
    const value = (input.profile as Record<string, string>)[key] ?? "";
    const isMissing = !value.trim();
    findings.push({
      id: `requisite:${key}`,
      category: "requisite_matching",
      status: isMissing ? "FAIL" : "NEEDS_HUMAN_REVIEW",
      title: message,
      reasons: [isMissing ? "Поле не заполнено" : "Возможная опечатка — проверьте контрольную цифру"],
      ref: key,
    });
  }
  return findings;
}

// ——— 6. Соответствие характеристик ———
// ИИ подобрал значение из условия заказчика: участник должен подтвердить, что готов предложить именно это.

function checkCharacteristicMatching(input: ValidationInput): ValidationFinding[] {
  return input.fields
    .filter((f) => f.kind === "confirm" && f.status === "needs_confirmation")
    .map((f) => ({
      id: `char:${f.key}`,
      category: "characteristic_matching" as const,
      status: "NEEDS_HUMAN_REVIEW" as const,
      title: f.context ? `${f.label}: ${f.context}` : f.label,
      reasons: [f.problem ?? "Значение подобрал ИИ — подтвердите или исправьте в файле Word"],
      ref: f.key,
    }));
}

// ——— 7. Наличие доказательств ———
// Каждое требование закупки сверяется с базой доказательств компании.

function checkEvidencePresence(input: ValidationInput): ValidationFinding[] {
  const base: Base = { facts: input.facts, profile: input.profile };
  const purchaseChecks = checkPurchase(input.purchase, base, input.today);
  const findings: ValidationFinding[] = [];

  for (const { requirement, checks } of purchaseChecks) {
    for (const check of checks) {
      const status = evidenceToValidation(check.status);
      if (status === "PASS") continue;
      findings.push({
        id: `evidence:${requirement.text.slice(0, 60)}:${check.need.kind}`,
        category: "evidence_presence",
        status,
        title: check.need.label,
        reasons: check.reasons,
        ref: requirement.quote || requirement.text,
      });
    }
  }
  return findings;
}

// ——— 8. Противоречия в документах ———
// Логические несовместимости внутри базы: акт раньше договора, дублирующиеся факты с разными числами.

function checkDocumentContradictions(input: ValidationInput): ValidationFinding[] {
  const findings: ValidationFinding[] = [];

  // Опыт: акт о приёмке не может быть раньше договора.
  for (const fact of input.facts) {
    if (fact.kind !== "experience") continue;
    const contractDate = fact.fields.contractDate;
    const actDate = fact.fields.actDate;
    if (!contractDate || !actDate) continue;
    const cd = dayOf(contractDate);
    const ad = dayOf(actDate);
    if (cd === null || ad === null) continue;
    if (ad < cd) {
      findings.push({
        id: `contradiction:act_before_contract:${fact.id}`,
        category: "document_contradictions",
        status: "FAIL",
        title: `«${fact.title}»: акт раньше договора`,
        reasons: [
          `Договор от ${dm(contractDate)}, акт о приёмке от ${dm(actDate)} — акт не может предшествовать договору`,
        ],
        ref: fact.id,
      });
    }
  }

  // Дублирующиеся факты одного вида с одинаковым числовым показателем и разными значениями.
  const byTitle = new Map<string, Fact[]>();
  for (const fact of input.facts) {
    const key = `${fact.kind}:${fact.title.toLowerCase().replace(/\s+/g, " ").trim()}`;
    const group = byTitle.get(key) ?? [];
    group.push(fact);
    byTitle.set(key, group);
  }
  for (const group of byTitle.values()) {
    if (group.length < 2) continue;
    // Числа, которые несовместимы: одна единица, разные значения.
    const measures = group.flatMap((f) => f.measures);
    const seen = new Map<string, number>();
    for (const m of measures) {
      const key = m.unit.toLowerCase().replace(/\s+/g, "").slice(0, 6);
      if (!key) continue;
      const prev = seen.get(key);
      if (prev === undefined) {
        seen.set(key, m.value);
      } else if (Math.abs(prev - m.value) > 1e-9) {
        findings.push({
          id: `contradiction:measure:${group[0].title.slice(0, 40)}:${key}`,
          category: "document_contradictions",
          status: "NEEDS_HUMAN_REVIEW",
          title: `«${group[0].title}» — конфликт числовых значений`,
          reasons: [
            `Несколько фактов с названием «${group[0].title}» содержат разные значения для «${m.unit}»: ${prev} и ${m.value}`,
          ],
        });
        break;
      }
    }
  }

  return findings;
}

// ——— 9. Заполненность полей ———
// Обязательные поля без значения и неверно заполненные — до подачи их нужно исправить.

function checkRequiredFields(input: ValidationInput): ValidationFinding[] {
  const findings: ValidationFinding[] = [];

  for (const field of input.fields) {
    if (!field.required) continue;

    if (field.status === "needs_input") {
      findings.push({
        id: `field:${field.key}`,
        category: "required_fields",
        status: "FAIL",
        title: `Не заполнено: ${field.label || field.context || field.key}`,
        reasons: [
          `Обязательное поле в «${field.doc}» пустое`,
          ...(field.context ? [`Контекст: ${field.context}`] : []),
        ],
        ref: field.key,
      });
    } else if (field.status === "needs_confirmation") {
      findings.push({
        id: `field:confirm:${field.key}`,
        category: "required_fields",
        status: "NEEDS_HUMAN_REVIEW",
        title: `Требует подтверждения: ${field.label || field.context || field.key}`,
        reasons: [
          `Поле в «${field.doc}» заполнено, но не подтверждено`,
          ...(field.problem ? [field.problem] : []),
        ],
        ref: field.key,
      });
    }
  }
  return findings;
}

// ——— Точка входа ———

export function validate(input: ValidationInput): ValidationReport {
  const allFindings: ValidationFinding[] = [
    ...checkRequiredDocuments(input),
    ...checkValidityPeriods(input),
    ...checkNumericConstraints(input),
    ...checkDates(input),
    ...checkRequisiteMatching(input),
    ...checkCharacteristicMatching(input),
    ...checkEvidencePresence(input),
    ...checkDocumentContradictions(input),
    ...checkRequiredFields(input),
  ];

  const pass = allFindings.filter((f) => f.status === "PASS").length;
  const fail = allFindings.filter((f) => f.status === "FAIL").length;
  const needsHuman = allFindings.filter((f) => f.status === "NEEDS_HUMAN_REVIEW").length;

  return {
    status: worstStatus(allFindings.map((f) => f.status)),
    findings: allFindings,
    pass,
    fail,
    needsHuman,
  };
}

// Сводка по категориям: для отображения плашки «Проверка заявки» на экране.
export type CategorySummary = {
  category: ValidationCategory;
  title: string;
  status: ValidationStatus;
  fail: number;
  needsHuman: number;
};

export function categorySummary(report: ValidationReport): CategorySummary[] {
  const map = new Map<ValidationCategory, { fail: number; needsHuman: number; statuses: ValidationStatus[] }>();
  for (const f of report.findings) {
    const entry = map.get(f.category) ?? { fail: 0, needsHuman: 0, statuses: [] };
    entry.statuses.push(f.status);
    if (f.status === "FAIL") entry.fail++;
    else if (f.status === "NEEDS_HUMAN_REVIEW") entry.needsHuman++;
    map.set(f.category, entry);
  }
  return (Object.keys(CATEGORY_TITLES) as ValidationCategory[])
    .filter((c) => map.has(c))
    .map((c) => ({
      category: c,
      title: CATEGORY_TITLES[c],
      status: worstStatus(map.get(c)!.statuses),
      fail: map.get(c)!.fail,
      needsHuman: map.get(c)!.needsHuman,
    }));
}
