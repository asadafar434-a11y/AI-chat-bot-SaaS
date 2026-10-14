import { cardHash, type CardEdits, type ProductCard } from "@/lib/product-card";
import { STALE_DAYS, selectable, type CandidateView, type Decision, type DatasetRef } from "@/lib/registry-decision";
import { REGISTRY_LINE_LABEL, REGISTRY_SHORT, registryLine, registryLineUnverified, type RegistryKind } from "@/lib/registry-types";

export { REGISTRY_LINE_LABEL };

// Решения участника по реестровым номерам и журнал. Живут в закупке (в браузере), рядом с ТП: сервер выбор не хранит.
// По журналу можно ответить: «Почему в заявке указан именно этот номер и на каких данных основан выбор?»

/** auto_picked — номер подобрала система, участник его ещё не проверил (confirmedAt пусто): в заявке он выделен словом «ПРОВЕРЬТЕ». */
export type ChoiceBasis = "auto_proven" | "user_selected" | "auto_picked";

/** Что запомнено о записи в момент выбора: даже если реестр потом обновится, видно, на чём основывалось решение. */
export type RecordSnapshot = {
  registryNumber: string;
  enterpriseName: string;
  inn: string;
  productName: string;
  okpd2: string;
  madeBy: string | null;
  validUntil: string | null;
  validUntilMin: string | null;
  basisCount: number;
  /** Баллы и процентный показатель на момент выбора; в выборах, сделанных раньше, их нет. */
  points?: number | null;
  percent?: number | null;
};

export type Considered = { registryNumber: string; enterpriseName: string; productName: string; identity: string[]; contradictions: string[]; active: boolean };

export type RegistryChoice = {
  positionKey: string;
  registryKind: RegistryKind;
  registryNumber: string;
  /** auto_proven — система доказала совпадение, участник подтвердил; user_selected — участник выбрал сам, объективных подтверждений мало. */
  basis: ChoiceBasis;
  /** Когда номер подтвердил участник. Пусто — номер подобран автоматически и ждёт проверки (basis = auto_picked). */
  confirmedAt: string;
  /** Сколько подходящих вариантов было, когда номер подбирали автоматически. */
  options?: number;
  note: string;
  /** Отпечаток карточки товара на момент выбора. */
  cardHash: string;
  decisionStatus: Decision["status"];
  record: RecordSnapshot;
  dataset: DatasetRef | null;
  datasetAgeDays: number | null;
  asOf: string;
  searchedAt: string;
  /** Рассмотренные кандидаты (не больше 30) и то, чем они совпали или не совпали. */
  considered: Considered[];
  /** Что было названо подтверждающим, а что — допущением. */
  reasons: string[];
  assumptions: string[];
  warnings: string[];
};

export type LogEvent = "search" | "select" | "autopick" | "cancel" | "autofill" | "skip" | "card_changed" | "registry_chosen";

export type RegistryLogEntry = {
  at: string;
  positionKey: string;
  event: LogEvent;
  /** Коротко и словами: что произошло и почему. Без секретов и лишних персональных данных. */
  text: string;
  registryNumber?: string;
  status?: Decision["status"];
};

export type RegistryState = {
  /** Что участник вписал в карточки товаров: по ключу позиции. */
  cards: Record<string, CardEdits>;
  /** Принятые решения: по ключу позиции. */
  choices: Record<string, RegistryChoice>;
  /** Реестр, который выбрал участник, когда документы его не назвали. */
  registry?: RegistryKind;
  /** Позиции, где участник отказался от номера («Нет в реестре»): ключ позиции → отпечаток карточки. Автоподбор их не трогает, пока данные те же. */
  skipped?: Record<string, string>;
  /** Журнал событий, только дополняется (не больше LOG_LIMIT последних). */
  log: RegistryLogEntry[];
};

export const EMPTY_REGISTRY_STATE: RegistryState = { cards: {}, choices: {}, log: [] };
export const LOG_LIMIT = 500;

export const appendLog = (state: RegistryState, entry: RegistryLogEntry): RegistryState => ({
  ...state,
  log: [...state.log, entry].slice(-LOG_LIMIT),
});

const snapshotOf = (view: CandidateView): RecordSnapshot => ({
  registryNumber: view.registryNumber,
  enterpriseName: view.enterpriseName,
  inn: view.inn,
  productName: view.productName,
  okpd2: view.okpd2,
  madeBy: view.madeBy,
  validUntil: view.validUntil,
  validUntilMin: view.validUntilMin,
  basisCount: view.basisCount,
  points: view.points,
  percent: view.percent,
});

/** Запись выбора: что выбрано, на каких данных и что рассматривалось. Общая для выбора участником и автоматического подбора. */
function choiceFrom(card: ProductCard, decision: Decision, view: CandidateView, basis: ChoiceBasis, confirmedAt: string, note: string, options?: number): RegistryChoice {
  return {
    positionKey: card.key,
    // Реестр — тот, из которого взята запись: с его названием номер пойдёт в заявку.
    registryKind: view.registryKind,
    registryNumber: view.registryNumber,
    basis,
    confirmedAt,
    ...(options !== undefined && { options }),
    note,
    cardHash: cardHash(card),
    decisionStatus: decision.status,
    record: snapshotOf(view),
    dataset: decision.search.dataset,
    datasetAgeDays: decision.search.datasetAgeDays,
    asOf: decision.search.asOf,
    searchedAt: decision.search.searchedAt,
    considered: decision.candidates.slice(0, 30).map((c) => ({
      registryNumber: c.registryNumber,
      enterpriseName: c.enterpriseName,
      productName: c.productName,
      identity: c.identity,
      contradictions: c.signals.filter((x) => x.verdict === "contradict").map((x) => x.text),
      active: c.activity.active,
    })),
    reasons: decision.reasons,
    assumptions: decision.assumptions,
    warnings: view.activity.warnings,
  };
}

/** Варианты, из которых можно выбрать: запись действует и нет противоречия с данными о товаре. Порядок — по убыванию совпадения. */
export const optionsOf = (decision: Decision): CandidateView[] => decision.candidates.filter(selectable);

/**
 * Автоматический подбор (решение владельца 13.10.2026): если вариантов несколько или совпадение неполное, программа не оставляет поле
 * пустым, а подставляет лучший номер и помечает его «ПРОВЕРЬТЕ» — участник выбирает верный из списка или подтверждает. Лучший — тот, что
 * система доказала (decision.proposed), иначе первый по совпадению. Выбор человека не трогаем, пока сведения о товаре те же; подобранный
 * автоматически — пересчитываем при каждом новом поиске. Состояние возвращается тем же объектом, если менять нечего.
 */
export function autoPick(state: RegistryState, input: { card: ProductCard; decision: Decision; now?: Date; demanded?: boolean }): RegistryState {
  const { card, decision } = input;
  const now = input.now ?? new Date();
  const existing = state.choices[card.key];
  const hash = cardHash(card);
  if (state.skipped?.[card.key] === hash) return state;
  if (existing && existing.basis !== "auto_picked" && existing.cardHash === hash) return state;

  const options = optionsOf(decision);
  // Реестровый номер нужен всегда (решение владельца 14.10.2026), поиск идёт всегда. Но если закупка про номер не говорит, сам номер ставим,
  // только когда запись доказана по названию и характеристикам товара (decision.proposed); иначе варианты остаются списком на выбор участнику.
  const sure = input.demanded !== false || Boolean(decision.proposed);
  const best = sure ? (options.find((v) => v.registryNumber === decision.proposed) ?? options[0]) : undefined;
  if (!best) {
    if (!existing || existing.basis !== "auto_picked") return state;
    const rest = { ...state.choices };
    delete rest[card.key];
    const why = sure ? "подходящих записей нет" : "закупка про номер не говорит, а совпадение не доказано — выберите номер из списка сами";
    return appendLog({ ...state, choices: rest }, { at: now.toISOString(), positionKey: card.key, event: "skip", text: `Подобранный ранее номер ${existing.registryNumber} больше не подходит: ${why}.`, registryNumber: existing.registryNumber });
  }
  if (existing && existing.basis === "auto_picked" && existing.registryNumber === best.registryNumber && existing.cardHash === hash && existing.options === options.length) return state;

  const choice = choiceFrom(card, decision, best, "auto_picked", "", "", options.length);
  const text = `Номер ${best.registryNumber} подобран автоматически (вариантов: ${options.length}) и ждёт проверки участником.`;
  return appendLog({ ...state, choices: { ...state.choices, [card.key]: choice } }, { at: now.toISOString(), positionKey: card.key, event: "autopick", text, registryNumber: best.registryNumber, status: decision.status });
}

export type SelectResult = { ok: true; state: RegistryState; choice: RegistryChoice } | { ok: false; reason: string };

/**
 * Участник подтверждает запись для позиции. Выбрать можно только запись из результатов поиска, которая действует и не
 * противоречит данным о товаре. Выбор вручную не выдаётся за доказанный: basis = user_selected, пока система сама не доказала.
 */
export function selectRecord(state: RegistryState, input: { card: ProductCard; decision: Decision; registryNumber: string; note?: string; now?: Date }): SelectResult {
  const { card, decision, registryNumber } = input;
  const now = input.now ?? new Date();
  const view = decision.candidates.find((c) => c.registryNumber === registryNumber);
  if (!view) return { ok: false, reason: "Этой записи нет среди найденных для позиции: выберите из списка." };
  if (!view.activity.active) return { ok: false, reason: `Запись неактуальна: ${view.activity.reasons.join("; ")}.` };
  if (!selectable(view)) return { ok: false, reason: "У записи есть противоречие с данными о товаре — исправьте данные или передайте проверку специалисту." };
  const proven = decision.proposed === registryNumber && (decision.status === "confirmed" || decision.status === "needs_update");
  const choice = choiceFrom(card, decision, view, proven ? "auto_proven" : "user_selected", now.toISOString(), (input.note ?? "").slice(0, 500));
  const text = proven
    ? `Подтверждена запись ${registryNumber}: система доказала совпадение (${view.identity.join(", ")}), участник подтвердил.`
    : `Участник выбрал запись ${registryNumber} сам; объективных подтверждений недостаточно, выбор отмечен как решение участника.`;
  // Участник сам выбрал номер — прежний отказ от него снимается.
  const kept = state.skipped && card.key in state.skipped ? Object.fromEntries(Object.entries(state.skipped).filter(([key]) => key !== card.key)) : state.skipped;
  const next = appendLog({ ...state, ...(kept !== undefined && { skipped: kept }), choices: { ...state.choices, [card.key]: choice } }, { at: now.toISOString(), positionKey: card.key, event: "select", text, registryNumber, status: decision.status });
  return { ok: true, state: next, choice };
}

/**
 * Участник отказался от номера для позиции («Нет в реестре» или «Отменить выбор»). Отказ запоминается до смены данных о товаре: иначе
 * автоподбор подставил бы номер снова при следующем заходе. Выбрать номер в списке можно в любой момент — отказ тогда снимается.
 */
export function cancelChoice(state: RegistryState, positionKey: string, now = new Date()): RegistryState {
  const choice = state.choices[positionKey];
  if (!choice) return state;
  const rest = { ...state.choices };
  delete rest[positionKey];
  return appendLog(
    { ...state, choices: rest, skipped: { ...state.skipped, [positionKey]: choice.cardHash } },
    { at: now.toISOString(), positionKey, event: "cancel", text: `Выбор записи ${choice.registryNumber} отменён.`, registryNumber: choice.registryNumber },
  );
}

// ── Подстановка в заявку ───────────────────────────────────────────────────────────────────────────

/** unverified — номер подобрала система, участник его не проверил: в заявке он в скобках со словом «ПРОВЕРЬТЕ» (options — сколько было вариантов). */
export type AutofillCheck = { ok: true; line: string; registryNumber: string; unverified?: boolean; options?: number } | { ok: false; reason: string };

/**
 * Можно ли вписать выбранный номер в заявку. Номер не вписывается, если:
 *  — выбор не подтверждён участником (кроме подобранного автоматически: он вписывается с пометкой «ПРОВЕРЬТЕ»); — сведения о товаре изменились после выбора; — реестр не тот, что требует закупка;
 *  — запись на дату подачи уже не действует (по сохранённому при выборе сроку); — выгрузка, по которой выбирали, была устаревшей.
 */
export function autofillCheck(input: { choice: RegistryChoice | undefined; card: ProductCard; requiredRegistry: RegistryKind | null; asOf: string }): AutofillCheck {
  const { choice, card, requiredRegistry, asOf } = input;
  if (!choice) return { ok: false, reason: "Номер не выбран и не подтверждён участником" };
  const unverified = !choice.confirmedAt;
  if (unverified && choice.basis !== "auto_picked") return { ok: false, reason: "Выбор не подтверждён участником" };
  // Закупка реестр не назвала — участник сам выбрал запись, её реестр и есть реестр номера. Назвала — реестр записи должен совпасть.
  if (requiredRegistry && choice.registryKind !== requiredRegistry) return { ok: false, reason: `Выбрана запись другого реестра (${REGISTRY_SHORT[choice.registryKind]}), а закупка требует ${REGISTRY_SHORT[requiredRegistry]}` };
  if (choice.cardHash !== cardHash(card)) return { ok: false, reason: "Сведения о товаре изменились после выбора — найдите запись заново" };
  if (choice.record.validUntil && choice.record.validUntil < asOf) return { ok: false, reason: `Срок действия записи истёк ${choice.record.validUntil}` };
  if (choice.datasetAgeDays !== null && choice.datasetAgeDays > STALE_DAYS) return { ok: false, reason: "Выбор сделан по устаревшей выгрузке реестра — повторите поиск по свежей" };
  if (unverified) return { ok: true, registryNumber: choice.registryNumber, line: registryLineUnverified(choice.registryNumber, choice.registryKind, choice.options), unverified: true, ...(choice.options !== undefined && { options: choice.options }) };
  return { ok: true, registryNumber: choice.registryNumber, line: registryLine(choice.registryNumber, choice.registryKind) };
}

/** Сколько позиций получили номер, а сколько остались без него и почему. */
export function autofillSummary(cards: ProductCard[], state: RegistryState, requiredRegistry: RegistryKind | null, asOf: string) {
  const lines = new Map<string, string>();
  const skipped: { key: string; name: string; reason: string }[] = [];
  for (const card of cards) {
    const result = autofillCheck({ choice: state.choices[card.key], card, requiredRegistry, asOf });
    if (result.ok) lines.set(card.key, result.line);
    else skipped.push({ key: card.key, name: card.name, reason: result.reason });
  }
  return { lines, skipped };
}
