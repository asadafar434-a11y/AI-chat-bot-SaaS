// Сборка заявки по 7 этапам — агрегирует все существующие проверки в единый статус готовности.
// Никогда не заполняет данные предположениями: только подтверждённые факты, только известные значения.
// Модуль без зависимостей от браузера и сервера: его проверяют тесты (npm test).

import type { ApplicationField, Completeness } from "@/lib/fields";
import type { FulfillmentPlan } from "@/lib/fulfillment";
import { plural } from "@/lib/plural";
import type { TpPart } from "@/lib/tp-parts";

export type BuildStepStatus = "done" | "partial" | "pending" | "na";

export type BuildStepId =
  | "required_documents"   // 1. все требуемые документы определены
  | "existing_documents"   // 2. установлено, какие уже существуют
  | "generated_documents"  // 3. недостающие документы сгенерированы
  | "auto_filled"          // 4. известные поля заполнены автоматически
  | "confirmed_facts"      // 5. вставлены только подтверждённые факты
  | "unknown_marked"       // 6. неизвестные значения отмечены
  | "package_assembled";   // 7. единый пакет собран

export const BUILD_STEP_TITLES: Record<BuildStepId, string> = {
  required_documents: "Требуемые документы определены",
  existing_documents: "Состав пакета известен",
  generated_documents: "Документы сгенерированы",
  auto_filled: "Известные поля заполнены автоматически",
  confirmed_facts: "Только подтверждённые факты",
  unknown_marked: "Неизвестные значения отмечены",
  package_assembled: "Единый пакет собран",
};

export type BuildStep = {
  id: BuildStepId;
  title: string;
  status: BuildStepStatus;
  // Что именно сделано или не сделано — для человека.
  detail: string;
};

export type BuildReport = {
  steps: BuildStep[];
  // Худший статус среди блокирующих шагов.
  overall: BuildStepStatus;
  // Количество блокирующих шагов, не завершённых.
  blockingCount: number;
  // То же, что completeness().ready — для удобства калькуляторов вне модуля.
  ready: boolean;
};

export type BuildInput = {
  // Планы из fulfillmentOf() по всем пунктам «Что подать».
  plans: FulfillmentPlan[];
  // Поля из fieldsOf() — карта всей заявки.
  fields: ApplicationField[];
  // Итог из completeness() — что мешает подаче.
  final: Completeness;
  // ТП составлено (purchase.tp != null).
  hasTp: boolean;
  // Части, которые уже сгенерированы: «tp» если есть ТП, остальные — из purchase.parts.
  generatedParts: TpPart[];
};

// Шаги, незавершённость которых блокирует скачивание пакета.
const BLOCKING: ReadonlySet<BuildStepId> = new Set([
  "generated_documents",
  "confirmed_facts",
  "package_assembled",
]);

function worstStatus(statuses: BuildStepStatus[]): BuildStepStatus {
  const active = statuses.filter((s) => s !== "na");
  if (active.length === 0) return "na";
  if (active.includes("pending")) return "pending";
  if (active.includes("partial")) return "partial";
  return "done";
}

export function buildReport({ plans, fields, final, hasTp, generatedParts }: BuildInput): BuildReport {
  const generated = new Set(generatedParts);

  // ——— Шаг 1: требуемые документы определены ———
  // Всегда выполнен: fulfillmentOf() всегда разбирает «Что подать».
  const blocking = plans.filter((p) => p.mandatory && p.blocks).length;
  const notRequired = plans.filter((p) => !p.mandatory || !p.blocks).length;
  const step1: BuildStep = {
    id: "required_documents",
    title: BUILD_STEP_TITLES.required_documents,
    status: "done",
    detail: blocking
      ? `${blocking} ${plural(blocking, "обязательный", "обязательных", "обязательных")}${notRequired ? `, ${notRequired} прочих` : ""}`
      : plans.length
        ? `${plans.length} ${plural(plans.length, "пункт", "пункта", "пунктов")} — все по желанию или передаст площадка`
        : "Нет пунктов «Что подать»",
  };

  // ——— Шаг 2: состав пакета известен ———
  // Зависит от ТП: форма заказчика в нём определяет, какие части нужны.
  const n = generatedParts.length;
  const step2: BuildStep = {
    id: "existing_documents",
    title: BUILD_STEP_TITLES.existing_documents,
    status: hasTp ? "done" : "pending",
    detail: hasTp
      ? `${n} ${plural(n, "часть готова", "части готово", "частей готово")}`
      : "Составьте ТП на шаге «Проверка» — тогда будет известна форма заявки",
  };

  // ——— Шаг 3: недостающие документы сгенерированы ———
  // Каждый обязательный пункт типа «compose» должен иметь готовую часть.
  const composePlans = plans.filter((p) => p.mode === "compose" && p.mandatory);
  const missing = composePlans.filter((p) => p.part && !generated.has(p.part));
  const done3 = composePlans.length - missing.length;
  const step3Status: BuildStepStatus = !hasTp
    ? "pending"
    : missing.length === 0
      ? "done"
      : done3 > 0
        ? "partial"
        : "pending";
  const step3: BuildStep = {
    id: "generated_documents",
    title: BUILD_STEP_TITLES.generated_documents,
    status: step3Status,
    detail: !hasTp
      ? "Сначала составьте ТП"
      : missing.length === 0
        ? composePlans.length
          ? `Все ${composePlans.length} ${plural(composePlans.length, "документ сгенерирован", "документа сгенерировано", "документов сгенерировано")}`
          : "Нет документов для автогенерации"
        : `${missing.length} из ${composePlans.length} ещё не ${missing.length === 1 ? "сгенерирован" : "сгенерировано"}`,
  };

  // ——— Шаг 4: известные поля заполнены автоматически ———
  // «auto» — поля, заполненные из реквизитов и ТЗ без участия человека.
  const autoFilled = fields.filter((f) => f.kind === "auto" && f.status === "filled").length;
  const step4: BuildStep = {
    id: "auto_filled",
    title: BUILD_STEP_TITLES.auto_filled,
    status: !hasTp ? "pending" : autoFilled > 0 ? "done" : "done",
    detail: !hasTp
      ? "Будет известно после составления ТП"
      : autoFilled > 0
        ? `${autoFilled} ${plural(autoFilled, "поле", "поля", "полей")} из реквизитов и ТЗ`
        : "Нет полей для автозаполнения",
  };

  // ——— Шаг 5: только подтверждённые факты ———
  // Факты-«confirm» вставляются, только когда участник их подтвердил.
  // Сюда входят: цена, подписант, опыт, специалисты, значения подобранные ИИ, цифры со сканов.
  const confirmFields = fields.filter((f) => f.kind === "confirm");
  const confirmed = confirmFields.filter((f) => f.status === "filled").length;
  const pendingConf = confirmFields.filter((f) => f.status === "needs_confirmation").length;
  const step5Status: BuildStepStatus =
    confirmFields.length === 0
      ? "na"
      : pendingConf === 0
        ? "done"
        : confirmed > 0
          ? "partial"
          : "pending";
  const step5: BuildStep = {
    id: "confirmed_facts",
    title: BUILD_STEP_TITLES.confirmed_facts,
    status: step5Status,
    detail:
      confirmFields.length === 0
        ? "Нет фактов, требующих подтверждения"
        : pendingConf === 0
          ? `Все ${confirmed} ${plural(confirmed, "факт подтверждён", "факта подтверждено", "фактов подтверждено")}`
          : `${pendingConf} из ${confirmFields.length} ждут подтверждения — цена, подписант, доказательства`,
  };

  // ——— Шаг 6: неизвестные значения отмечены ———
  // Система всегда отмечает жёлтыми «[…]» то, что не знает. Шаг завершён, когда ТП составлено.
  // Счётчик пустых полей показывает, сколько мест ещё вписывает участник.
  const empty = fields.filter(
    (f) => f.required && f.status === "needs_input" && f.kind !== "sign" && f.kind !== "unknown"
  ).length;
  const step6: BuildStep = {
    id: "unknown_marked",
    title: BUILD_STEP_TITLES.unknown_marked,
    status: !hasTp ? "pending" : "done",
    detail: !hasTp
      ? "Будет известно после составления ТП"
      : empty === 0
        ? "Все жёлтые места заполнены участником"
        : `${empty} ${plural(empty, "жёлтое место", "жёлтых места", "жёлтых мест")} — вписывает участник`,
  };

  // ——— Шаг 7: единый пакет собран ———
  const step7Status: BuildStepStatus = !hasTp
    ? "pending"
    : final.ready
      ? "done"
      : "partial";
  const step7: BuildStep = {
    id: "package_assembled",
    title: BUILD_STEP_TITLES.package_assembled,
    status: step7Status,
    detail: !hasTp
      ? "Сначала составьте документы на шаге «Проверка»"
      : final.ready
        ? "Комплект готов к подаче"
        : final.blocking.length
          ? final.blocking[0]!
          : "Есть незакрытые пункты",
  };

  const steps: BuildStep[] = [step1, step2, step3, step4, step5, step6, step7];

  const blockingStatuses = steps.filter((s) => BLOCKING.has(s.id)).map((s) => s.status);
  const overall = worstStatus(blockingStatuses);
  const blockingCount = steps.filter((s) => BLOCKING.has(s.id) && s.status !== "done" && s.status !== "na").length;

  return { steps, overall, blockingCount, ready: final.ready };
}
