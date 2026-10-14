import { FIELD_LABELS, identityFieldsOf, type ProductCard } from "@/lib/product-card";
import type { RegistryDemand } from "@/lib/registry-demand";
import type { Signal, SignalField } from "@/lib/registry-match";
import type { Candidate, CandidateSearch, SearchTier } from "@/lib/registry-search";
import { REGISTRY_SHORT, gispUrl, moscowDay, type RegistryDatasetInfo, type RegistryKind, type StoredRegistryRecord } from "@/lib/registry-types";

// Правила принятия решения по одной товарной позиции. Решение — не оценка «насколько похоже», а проверка условий:
//   кто производитель + какая модель/артикул/ТУ + нет противоречий + запись действует на дату подачи.
// Если условия не доказаны, безопасный результат — объяснить неопределённость и передать выбор человеку, а не угадать номер.

export type DecisionStatus =
  | "no_requirement"
  | "unsupported_registry"
  | "no_dataset"
  | "pending"
  | "confirmed"
  | "choose"
  | "need_data"
  | "contradiction"
  | "not_found"
  | "inactive"
  | "needs_update";

/** Подписи состояний — как в экране; смысл не передаётся одним цветом. */
export const STATUS_TEXT: Record<DecisionStatus, string> = {
  no_requirement: "В документах закупки о реестровом номере не сказано, но номер нужен",
  unsupported_registry: "Нужен реестр, которого нет в системе",
  no_dataset: "Данные реестра не загружены",
  pending: "Требование о реестровом номере обнаружено — поиск не выполнен",
  confirmed: "Найдена подтверждённая запись",
  choose: "Требуется выбор пользователя",
  need_data: "Недостаточно данных",
  contradiction: "Обнаружено противоречие",
  not_found: "Запись не найдена",
  inactive: "Запись неактуальна",
  needs_update: "Данные требуют обновления",
};

/** Сценарий из описания задачи: 1 подтверждено, 2 несколько, 3 мало данных, 4 противоречие, 5 не найдено, 6 неактуальна. */
export type Scenario = 1 | 2 | 3 | 4 | 5 | 6;

/** Выгрузка старше этого срока считается устаревшей: автоматически предложенный номер требует обновить данные. */
export const STALE_DAYS = 30;
const SOON_DAYS = 30;

export type Activity = { active: boolean; reasons: string[]; warnings: string[] };

export type CandidateView = {
  recordId: string;
  registryNumber: string;
  /** Реестр, из которого взято описание записи, и все реестры, где этот номер есть. Номер в заявку идёт с подписью реестра `registryKind`. */
  registryKind: RegistryKind;
  registries: RegistryKind[];
  enterpriseName: string;
  inn: string;
  productName: string;
  okpd2: string;
  tnved: string | null;
  madeBy: string | null;
  addedAt: string | null;
  validUntil: string | null;
  validUntilMin: string | null;
  basisCount: number;
  /** Баллы и процентный показатель из записи реестра; null — в записи их нет. */
  points: number | null;
  percent: number | null;
  /** Текст колонки «О соответствии»: на каком основании запись подтверждает российское происхождение. */
  conformity: string | null;
  /** «Уровень радиоэлектронной продукции» и выписка из реестра на gisp.gov.ru — есть не у всех записей. */
  radioLevel: string | null;
  extractUrl: string | null;
  recordStatus: "active" | "absent";
  activity: Activity;
  tiers: SearchTier[];
  signals: Signal[];
  identity: SignalField[];
  proven: boolean;
  hasIdentity: boolean;
  /** Есть противоречие по существенному признаку: выбрать такую запись нельзя. */
  blocked: boolean;
  rank: number;
};

export type DatasetRef = { id: string; fileSha256: string; formatVersion: string; exportedAt: string | null; importedAt: string };

/** Поиск идёт сразу во всех загруженных реестрах; `demanded` — реестр, который назвала закупка (записи из него предпочтительны). */
export type Decision = {
  status: DecisionStatus;
  scenario: Scenario | null;
  /** Предложенный номер — только когда он доказан (confirmed) или доказан, но данные устарели (needs_update). */
  proposed: string | null;
  candidates: CandidateView[];
  matchedTotal: number;
  truncated: boolean;
  /** Чего не хватает, чтобы подтвердить запись. */
  missing: string[];
  /** По чему кандидаты различаются: помогает выбрать. */
  differences: string[];
  reasons: string[];
  /** Допущения, которые сделал код: человек должен о них знать. */
  assumptions: string[];
  similarElsewhere: number | null;
  /** Сколько найденных записей не подошли (другая модель или параметр у записей чужого производителя) и не показаны. */
  dismissed: number;
  search: {
    /** Реестр, который требует закупка; null — документы реестр не назвали. Поиск от этого не ограничивается. */
    registry: RegistryKind | null;
    /** В каких реестрах искали (у каких есть выгрузка). */
    searched: RegistryKind[];
    filters: string[];
    /** Самая старая из использованных выгрузок: по ней считается «данные устарели». */
    dataset: DatasetRef | null;
    datasetAgeDays: number | null;
    asOf: string;
    searchedAt: string;
  };
};

const DAY = 86400000;
const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);

/** Действует ли запись на дату asOf (ГГГГ-ММ-ДД). Срок записи — самое позднее из оснований; ранний срок — предупреждение. */
export function activityOf(record: StoredRegistryRecord, asOf: string): Activity {
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (record.status === "absent") reasons.push("записи нет в последней загруженной выгрузке реестра");
  if (record.terminatedAt && record.terminatedAt <= asOf) reasons.push(`действие записи прекращено ${record.terminatedAt}`);
  if (record.validUntil && record.validUntil < asOf) reasons.push(`срок действия истёк ${record.validUntil}`);
  if (!record.validUntil && reasons.length === 0) warnings.push("срок действия в записи не указан — проверьте на сайте ГИСП");
  if (reasons.length === 0 && record.validUntil) {
    if (record.validUntilMin && record.validUntilMin < asOf) {
      warnings.push(`у записи несколько оснований: одно действует только до ${record.validUntilMin}, другое до ${record.validUntil}; срок принят по позднему — проверьте`);
    } else if (dayNumber(record.validUntil) - dayNumber(asOf) <= SOON_DAYS) {
      warnings.push(`срок действия скоро истечёт: ${record.validUntil}`);
    }
  }
  return { active: reasons.length === 0, reasons, warnings };
}

/** Реестры расходятся в сведениях об одном номере — запись остаётся, но человек предупреждён: проверьте на сайте ГИСП. */
const withDisagreements = (activity: Activity, disagreements: string[] | undefined): Activity =>
  disagreements?.length ? { ...activity, warnings: [...activity.warnings, `реестры расходятся в сведениях об этом номере (${disagreements.join("; ")}) — проверьте на сайте ГИСП`] } : activity;

export function viewOf(candidate: Candidate, asOf: string): CandidateView {
  const { record, matching } = candidate;
  return {
    recordId: record.id,
    registryNumber: record.registryNumber,
    registryKind: record.registryKind,
    registries: candidate.registries,
    enterpriseName: record.enterpriseName,
    inn: record.inn,
    productName: record.productName,
    okpd2: record.okpd2,
    tnved: record.tnved,
    madeBy: record.madeBy,
    addedAt: record.addedAt,
    validUntil: record.validUntil,
    validUntilMin: record.validUntilMin,
    basisCount: record.bases.length,
    points: record.points,
    percent: record.percent,
    conformity: record.conformity,
    radioLevel: record.flags.radioLevel ?? null,
    extractUrl: gispUrl(record.flags.extractUrl),
    recordStatus: record.status,
    activity: withDisagreements(activityOf(record, asOf), candidate.disagreements),
    tiers: candidate.tiers,
    signals: matching.signals,
    identity: matching.identity,
    proven: matching.provenIdentity,
    hasIdentity: matching.hasIdentity,
    blocked: matching.critical.length > 0,
    rank: Math.round(matching.rank * 10) / 10,
  };
}

const FIELD_NAME: Record<SignalField, string> = {
  inn: "ИНН производителя",
  manufacturer: "производитель",
  model: "модель",
  article: "артикул",
  madeBy: "ТУ или ГОСТ",
  okpd2: "ОКПД2",
  name: "название",
  measure: "параметры",
  registryNumber: "реестровый номер",
  brand: "торговая марка",
};

const registryAssumption = (searched: RegistryKind[]): string =>
  `Реестры указаны при загрузке выгрузок (${searched.map((k) => REGISTRY_SHORT[k]).join(", ")}); сами файлы свои реестры не называют.`;

function differencesOf(views: CandidateView[]): string[] {
  if (views.length < 2) return [];
  const distinct = (pick: (v: CandidateView) => string | null) => new Set(views.map((v) => (pick(v) ?? "").toLowerCase())).size > 1;
  const out: string[] = [];
  if (distinct((v) => v.inn)) out.push("производитель");
  if (distinct((v) => v.okpd2)) out.push("код ОКПД2");
  if (distinct((v) => v.productName)) out.push("наименование и модель");
  if (distinct((v) => v.madeBy)) out.push("ТУ или ГОСТ");
  if (distinct((v) => v.validUntil)) out.push("срок действия");
  return out;
}

function missingOf(card: ProductCard): string[] {
  const own = new Set(identityFieldsOf(card));
  const missing: string[] = [];
  if (!own.has("inn") && !own.has("manufacturer")) missing.push("производитель (название или ИНН)");
  if (!own.has("model") && !own.has("article") && !own.has("madeBy")) missing.push("модель, артикул или ТУ/ГОСТ");
  if (!card.fields.okpd2) missing.push(FIELD_LABELS.okpd2);
  return missing;
}

export type DecideInput = {
  card: ProductCard;
  /** Реестр, который назвала закупка. Не сужает поиск: ищем сразу во всех загруженных реестрах; этот — предпочтительный. */
  demanded?: RegistryKind | null;
  /** Выгрузки, по которым искали (по одной на реестр). Пусто — ни один реестр не загружен. */
  datasets: RegistryDatasetInfo[];
  search: CandidateSearch | null;
  /** Дата, на которую запись должна действовать: подача заявки (ГГГГ-ММ-ДД). */
  asOf: string;
  now?: Date;
};

const refOf = (d: RegistryDatasetInfo): DatasetRef => ({ id: d.id, fileSha256: d.fileSha256, formatVersion: d.formatVersion, exportedAt: d.exportedAt, importedAt: d.importedAt });

const stampOf = (d: RegistryDatasetInfo) => Date.parse(d.exportedAt ?? d.importedAt);
const exportedText = (d: RegistryDatasetInfo) => (d.exportedAt ? moscowDay(d.exportedAt) : "даты не указано");

export function decide(input: DecideInput): Decision {
  const { card, datasets, search, asOf } = input;
  const registry = input.demanded ?? null;
  const now = input.now ?? new Date();
  // Самая старая из выгрузок: по ней считаем, устарели ли данные (честнее, чем по самой свежей).
  const dataset = datasets.length ? datasets.reduce((oldest, d) => (stampOf(d) < stampOf(oldest) ? d : oldest)) : null;
  const searched = datasets.map((d) => d.registryKind);
  const searchedText = searched.map((k) => REGISTRY_SHORT[k]).join(", ");
  const ageDays = dataset ? Math.floor((now.getTime() - stampOf(dataset)) / DAY) : null;
  const base: Decision = {
    status: "not_found",
    scenario: null,
    proposed: null,
    candidates: [],
    matchedTotal: 0,
    truncated: false,
    missing: [],
    differences: [],
    reasons: [],
    assumptions: [],
    similarElsewhere: search?.similarElsewhere ?? null,
    dismissed: 0,
    search: { registry, searched, filters: search?.filters ?? [], dataset: dataset ? refOf(dataset) : null, datasetAgeDays: ageDays, asOf, searchedAt: now.toISOString() },
  };

  if (!dataset || !search) {
    return { ...base, status: "no_dataset", reasons: ["Выгрузки реестров не загружены, поиск невозможен. Номер не подставляется."] };
  }

  // Противоречие (другая модель, другой параметр, другой ИНН) важно, только если производитель или номер уже совпали:
  // «тот же производитель, но модель другая». Запись чужого производителя с другой моделью — просто не ваш товар.
  const allViews = search.candidates.map((c) => viewOf(c, asOf));
  const relevant = (v: CandidateView) => !v.blocked || v.identity.some((f) => f === "inn" || f === "manufacturer" || f === "registryNumber");
  const views = allViews.filter(relevant);
  const dismissed = allViews.length - views.length;
  const typed = card.fields.registryNumber;
  if (typed && typed.origin !== "tz" && search.tierTotals.number === 0) {
    return {
      ...base,
      status: "not_found",
      scenario: 5,
      candidates: views,
      matchedTotal: search.matchedTotal,
      truncated: search.truncated,
      assumptions: [registryAssumption(searched)],
      reasons: [`Указанного вами номера ${typed.value} нет в выгрузках реестров (${searchedText})${dataset.exportedAt ? `, самая старая от ${moscowDay(dataset.exportedAt)}` : ""}. Номер не подставляется — проверьте его на сайте ГИСП.`],
    };
  }
  const active = views.filter((v) => v.activity.active);
  const inactive = views.filter((v) => !v.activity.active);
  const usable = active.filter((v) => !v.blocked);
  const blocked = active.filter((v) => v.blocked);
  const proven = usable.filter((v) => v.proven);
  const inactiveProven = inactive.filter((v) => v.proven);
  const hasIdentityData = identityFieldsOf(card).length > 0;

  const assumptions: string[] = [registryAssumption(searched)];
  if (dataset.exportedAt) assumptions.push("Время выгрузки в файле указано без часового пояса, принято московское.");
  else assumptions.push("В файле нет времени выгрузки, возраст данных считается по дате загрузки.");
  if (card.fields.okpd2?.origin === "tz") assumptions.push(`Код ОКПД2 ${card.fields.okpd2.value} взят из документов закупки (${card.fields.okpd2.source}) — это категория, которую хочет заказчик, а не сведения о товаре участника.`);
  if (!hasIdentityData) assumptions.push("Наименование товара взято из ТЗ — оно не доказывает, что именно такой товар поставляет участник.");
  if (views.some((v) => v.validUntilMin && v.validUntilMin !== v.validUntil)) assumptions.push("У части записей несколько оснований с разными сроками; срок действия принят по самому позднему.");

  const stale = ageDays !== null && ageDays > STALE_DAYS;
  const out: Decision = {
    ...base,
    candidates: views,
    matchedTotal: search.matchedTotal,
    truncated: search.truncated,
    dismissed,
    differences: differencesOf(usable.length > 1 ? usable : views),
    assumptions,
  };
  if (search.broadened && views.length > 0) {
    const { wanted, used } = search.broadened;
    out.reasons.push(`Точного названия «${wanted}» в реестре нет — показаны записи по общему названию «${used}»${search.truncated || search.matchedTotal > views.length ? ` (показано ${views.length} из ${search.matchedTotal})` : ""}. Сверьте с вашим товаром и выберите нужный номер.`);
  }
  if (stale) out.reasons.push(`Выгрузка реестра ${ageDays} дн. назад — старше ${STALE_DAYS}: загрузите свежую и повторите поиск.`);

  // Сценарий 1 / 2: есть доказанные записи.
  if (proven.length === 1) {
    const only = proven[0];
    const labels = only.identity.map((f) => FIELD_NAME[f]).join(", ");
    return {
      ...out,
      status: stale ? "needs_update" : "confirmed",
      scenario: 1,
      proposed: only.registryNumber,
      reasons: [`Совпали устойчивые идентификаторы: ${labels}. Противоречий нет, запись действует на ${asOf}.`, ...out.reasons],
    };
  }
  if (proven.length > 1) {
    return {
      ...out,
      status: "choose",
      scenario: 2,
      reasons: [`Подходят сразу ${proven.length} записей с подтверждёнными идентификаторами. Выбрать одну автоматически нельзя — выберите свою.`, ...out.reasons],
    };
  }

  // Сценарий 6: подходящая запись есть, но уже не действует. Похожую вместо неё автоматически не берём.
  if (inactiveProven.length > 0) {
    const one = inactiveProven[0];
    return {
      ...out,
      status: "inactive",
      scenario: 6,
      reasons: [`Запись ${one.registryNumber} подходит по идентификаторам, но неактуальна: ${one.activity.reasons.join("; ")}. Другую запись вместо неё автоматически не выбираем — проверьте, не выпущена ли новая.`, ...out.reasons],
    };
  }

  // Сценарий 4: всё, что нашлось, противоречит данным о товаре.
  if (usable.length === 0 && blocked.length > 0) {
    const reasons = blocked.slice(0, 3).map((v) => `Запись ${v.registryNumber}: ${v.signals.filter((s) => s.critical).map((s) => s.text).join("; ")}`);
    return { ...out, status: "contradiction", scenario: 4, reasons: [...reasons, "Исправьте данные о товаре или передайте проверку специалисту.", ...out.reasons] };
  }
  if (usable.length === 0 && inactive.length > 0) {
    return {
      ...out,
      status: "inactive",
      scenario: 6,
      reasons: [`Найденные записи неактуальны (${inactive[0].activity.reasons.join("; ")}). Действующей подходящей записи нет.`, ...out.reasons],
    };
  }

  // Сценарий 5: ничего не нашлось.
  if (usable.length === 0) {
    const elsewhere = out.similarElsewhere ? ` Записи с похожим названием есть у других производителей (${out.similarElsewhere}), но это не ваш товар.` : dismissed ? ` Похожих по названию записей других производителей или с другой моделью: ${dismissed} — это не ваш товар.` : "";
    return {
      ...out,
      status: "not_found",
      scenario: 5,
      reasons: [`Поиск выполнен в реестрах: ${searchedText} (выгрузки от ${datasets.map(exportedText).join(", ")}), подходящая запись не подтверждена. Номер не подставляется.${elsewhere}`, "Обновите выгрузку или проверьте на сайте ГИСП.", ...out.reasons],
    };
  }

  // Есть подходящие, но не доказанные записи.
  const withIdentity = usable.filter((v) => v.hasIdentity);
  if (hasIdentityData && withIdentity.length > 0) {
    return {
      ...out,
      status: "choose",
      scenario: 2,
      missing: missingOf(card),
      reasons: [
        withIdentity.length === 1
          ? "Найдена одна запись, по которой совпало часть названного вами, но для уверенности данных не хватает. Подтвердите её сами или дополните карточку товара."
          : `Найдено записей: ${withIdentity.length}. Названных вами сведений не хватает, чтобы выбрать одну. Выберите свою или дополните карточку товара.`,
        ...out.reasons,
      ],
    };
  }
  return {
    ...out,
    status: "need_data",
    scenario: 3,
    missing: missingOf(card),
    reasons: [
      hasIdentityData
        ? "Найдены похожие записи, но названные вами сведения о товаре не подтверждаются ни одной из них."
        : "Найдены похожие записи, но о товаре участника ничего не известно: название из ТЗ — это желание заказчика, а не ваш товар. Укажите производителя и модель.",
      ...out.reasons,
    ],
  };
}

/**
 * Состояние позиции для экрана: требование закупки + что нашёл поиск. Реестр участник не выбирает: ищем сразу во всех загруженных,
 * поэтому поиск возможен и тогда, когда требование в документах не найдено или реестр не назван.
 */
export function statusOf(demand: Pick<RegistryDemand, "status" | "unsupported">, decision: Decision | null): DecisionStatus {
  if (decision) return decision.status;
  if (demand.unsupported) return "unsupported_registry";
  return demand.status === "none" ? "no_requirement" : "pending";
}

/** Можно ли выбрать эту запись вручную: действует и нет противоречия по существенному признаку. */
export const selectable = (view: CandidateView): boolean => view.activity.active && !view.blocked;
