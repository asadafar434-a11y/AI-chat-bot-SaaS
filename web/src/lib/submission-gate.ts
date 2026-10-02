// Финальный шлюз перед подачей заявки.
//
// Принцип: ИИ НЕ придумывает факты.
// Каждый критический факт должен иметь источник или требовать подтверждения человека.
// Подача возможна только когда нет blocking-позиций и все confirmable — подтверждены.

import type { AuditReport } from "./submission-audit";
import type { ApplicationField } from "./fields";
import type { Fact } from "./evidence-base";

// ─── Типы ────────────────────────────────────────────────────────────────────

export type GateItemKind =
  | "critical_finding"    // CRITICAL из AuditReport — нельзя подать до исправления
  | "missing_field"       // обязательное поле не заполнено
  | "invalid_field"       // значение не соответствует требованиям
  | "ai_filled_field"     // поле заполнено ИИ, ждёт подтверждения человека
  | "unconfirmed_ai_fact" // факт доказательной базы найден ИИ, не подтверждён
  | "warning_finding";    // WARNING из AuditReport — человек решает, приемлемо ли

export type GateItem = {
  id: string;
  kind: GateItemKind;
  what: string;         // что именно требует внимания
  source: string | null; // откуда взят факт (документ, статья)
  blocking: boolean;    // true → нельзя подать; false → нужно подтвердить и можно подать
};

export type GateInput = {
  audit: AuditReport;
  fields: ApplicationField[];
  facts: Fact[];
  /** id позиций, которые человек явно подтвердил нажатием «Подтвердить». */
  confirmedIds: ReadonlySet<string>;
};

export type SubmissionGate = {
  canSubmit: boolean;
  blocking: GateItem[];
  needsConfirmation: GateItem[];
  confirmed: GateItem[];
  summary: string;
  totalIssues: number;
};

// ─── Workflow: шаги в нужном порядке ─────────────────────────────────────────

export type WorkflowStepId =
  | "upload"       // загрузка документов закупки
  | "analysis"     // анализ и извлечение требований
  | "evidence"     // доказательная база компании
  | "assembly"     // построение заявки (ТП + документы)
  | "validation"   // детерминированная проверка (9 категорий)
  | "confirmation" // человек подтверждает спорные места
  | "package";     // готовый пакет к подаче

export type WorkflowStepStatus =
  | "complete"     // шаг завершён, всё в порядке
  | "needs_action" // шаг требует действий (блокирующие ошибки или неподтверждённые)
  | "in_progress"  // частично выполнен
  | "todo";        // ещё не начат

export type WorkflowStep = {
  id: WorkflowStepId;
  label: string;
  status: WorkflowStepStatus;
  count?: number; // сколько пунктов нужно обработать на этом шаге
};

export type WorkflowStateInput = {
  hasDocuments: boolean;     // загружены ли документы закупки
  hasRequirements: boolean;  // извлечены ли требования
  factsCount: number;        // сколько фактов в базе доказательств
  hasTp: boolean;            // сгенерировано ли ТП / пакет документов
  gate: SubmissionGate;
};

export type WorkflowState = {
  steps: WorkflowStep[];
  currentStep: WorkflowStepId;
  canSubmit: boolean;
};

// ─── submissionGate ───────────────────────────────────────────────────────────

export function submissionGate(input: GateInput): SubmissionGate {
  const all: GateItem[] = [];

  // 1. CRITICAL findings → blocking
  for (const f of input.audit.findings) {
    if (f.severity === "CRITICAL") {
      all.push({
        id: `audit:${f.id}`,
        kind: "critical_finding",
        what: f.what,
        source: f.source ?? null,
        blocking: true,
      });
    }
  }

  // 2. Обязательные поля не заполнены → blocking
  for (const f of input.fields) {
    if (f.status === "needs_input" && f.required) {
      all.push({
        id: `field:${f.key}`,
        kind: "missing_field",
        what: `Поле «${f.label}» не заполнено`,
        source: f.source || null,
        blocking: true,
      });
    }
  }

  // 3. Недопустимые значения полей → blocking
  for (const f of input.fields) {
    if (f.status === "invalid") {
      all.push({
        id: `field:${f.key}:invalid`,
        kind: "invalid_field",
        what: f.problem ? `«${f.label}»: ${f.problem}` : `Поле «${f.label}» содержит недопустимое значение`,
        source: f.source || null,
        blocking: true,
      });
    }
  }

  // 4. ИИ заполнил поле, человек ещё не подтвердил → confirmable
  for (const f of input.fields) {
    if (f.status === "needs_confirmation") {
      all.push({
        id: `field:${f.key}:confirm`,
        kind: "ai_filled_field",
        what: `«${f.label}»${f.value ? ` — значение «${f.value}»` : ""} — проверьте и подтвердите`,
        source: f.source || null,
        blocking: false,
      });
    }
  }

  // 5. Факты доказательной базы найдены ИИ, не подтверждены → confirmable
  for (const fact of input.facts) {
    if (fact.origin === "ai" && !fact.confirmed) {
      const src =
        fact.source.type === "document"
          ? (fact.source as { type: "document"; title?: string }).title ?? null
          : null;
      all.push({
        id: `fact:${fact.id}`,
        kind: "unconfirmed_ai_fact",
        what: `${fact.title} — найден ИИ, подтвердите или удалите`,
        source: src,
        blocking: false,
      });
    }
  }

  // 6. WARNING findings → confirmable (человек решает, приемлемо ли)
  for (const f of input.audit.findings) {
    if (f.severity === "WARNING") {
      all.push({
        id: `audit:${f.id}:warn`,
        kind: "warning_finding",
        what: f.what,
        source: f.source ?? null,
        blocking: false,
      });
    }
  }

  // Разбиваем по статусу подтверждения
  const blocking = all.filter((i) => i.blocking);
  const confirmable = all.filter((i) => !i.blocking);
  const confirmed = confirmable.filter((i) => input.confirmedIds.has(i.id));
  const needsConfirmation = confirmable.filter((i) => !input.confirmedIds.has(i.id));

  const canSubmit = blocking.length === 0 && needsConfirmation.length === 0;

  let summary: string;
  if (blocking.length > 0) {
    summary = `${blocking.length} блокирующих — исправьте перед подачей`;
  } else if (needsConfirmation.length > 0) {
    summary = `Подтвердите ${needsConfirmation.length} пунктов`;
  } else {
    summary = "Готово к подаче";
  }

  return {
    canSubmit,
    blocking,
    needsConfirmation,
    confirmed,
    summary,
    totalIssues: blocking.length + needsConfirmation.length,
  };
}

// ─── workflowState ────────────────────────────────────────────────────────────

const STEP_LABELS: Record<WorkflowStepId, string> = {
  upload: "Загрузка документов",
  analysis: "Анализ и требования",
  evidence: "Доказательства компании",
  assembly: "Построение заявки",
  validation: "Детерминированная проверка",
  confirmation: "Подтверждение спорных мест",
  package: "Готовый пакет",
};

export function workflowState(input: WorkflowStateInput): WorkflowState {
  const { gate } = input;

  const blockingByKind = (kinds: GateItemKind[]) =>
    gate.blocking.filter((i) => kinds.includes(i.kind)).length;

  const confirmByKind = (kinds: GateItemKind[]) =>
    gate.needsConfirmation.filter((i) => kinds.includes(i.kind)).length;

  const steps: WorkflowStep[] = [
    {
      id: "upload",
      label: STEP_LABELS.upload,
      status: input.hasDocuments ? "complete" : "needs_action",
    },
    {
      id: "analysis",
      label: STEP_LABELS.analysis,
      status: input.hasRequirements ? "complete" : input.hasDocuments ? "in_progress" : "todo",
    },
    {
      id: "evidence",
      label: STEP_LABELS.evidence,
      status:
        input.factsCount > 0
          ? confirmByKind(["unconfirmed_ai_fact"]) > 0
            ? "needs_action"
            : "complete"
          : input.hasRequirements
          ? "in_progress"
          : "todo",
      count: confirmByKind(["unconfirmed_ai_fact"]) || undefined,
    },
    {
      id: "assembly",
      label: STEP_LABELS.assembly,
      status: input.hasTp
        ? blockingByKind(["missing_field", "invalid_field"]) > 0
          ? "needs_action"
          : "complete"
        : input.hasRequirements
        ? "in_progress"
        : "todo",
      count: blockingByKind(["missing_field", "invalid_field"]) || undefined,
    },
    {
      id: "validation",
      label: STEP_LABELS.validation,
      status:
        blockingByKind(["critical_finding"]) > 0
          ? "needs_action"
          : input.hasTp
          ? "complete"
          : "todo",
      count: blockingByKind(["critical_finding"]) || undefined,
    },
    {
      id: "confirmation",
      label: STEP_LABELS.confirmation,
      status:
        confirmByKind(["ai_filled_field", "warning_finding"]) > 0
          ? "needs_action"
          : input.hasTp
          ? "complete"
          : "todo",
      count: confirmByKind(["ai_filled_field", "warning_finding"]) || undefined,
    },
    {
      id: "package",
      label: STEP_LABELS.package,
      status: gate.canSubmit ? "complete" : input.hasTp ? "in_progress" : "todo",
    },
  ];

  // Текущий шаг — первый не-complete
  const current =
    steps.find((s) => s.status !== "complete") ?? steps[steps.length - 1]!;

  return {
    steps,
    currentStep: current.id,
    canSubmit: gate.canSubmit,
  };
}
