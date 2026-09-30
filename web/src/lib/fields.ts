import { castCheck } from "@/lib/cast";
import { ANKETA, anketaExtraRows, type Profile, type ProfileKey } from "@/lib/profile";
import type { Purchase } from "@/lib/purchase";
import { profileProblems } from "@/lib/requisites-check";
import { needsFill, type TpForm, type TpResult } from "@/lib/tp";
import { PART_TITLES, partsOf, type TpPart } from "@/lib/tp-parts";

// Карта полей заявки — ядро «заявки под ключ». По каждому полю документов заявки видно, что с ним:
//   auto    — заполнено само: реквизиты, пункты ТЗ, характеристики из документов;
//   confirm — значение есть, но нужно подтверждение человека: цена, подписант, найденные договоры, цифры со скана;
//   manual  — поле нужно, а значения нет: жёлтые места «[…]», строки анкеты заказчика, исполнители;
//   unknown — не удалось определить: файл закупки не прочитан, что в нём требуется — неизвестно;
//   sign    — только человек: подписать заявку электронной подписью и подать на площадке.
// У поля — источник значения («Реквизиты», «ТЗ, п. 2.1», имя файла) и обязательность. Из карты считаются сводка
// «Заполнение заявки», очередь пошагового мастера и итоговая проверка комплекта перед скачиванием.
// Модуль без зависимостей от браузера и сервера: его проверяют тесты (npm test), им пользуется любой экран.

export type FieldKind = "auto" | "confirm" | "manual" | "unknown" | "sign";
export type FieldStatus = "filled" | "needs_confirmation" | "needs_input" | "invalid" | "action";

export type ApplicationField = {
  key: string;
  label: string;
  // В каком документе поле: название части заявки или «Подача на площадке».
  doc: string;
  part: TpPart | null;
  kind: FieldKind;
  status: FieldStatus;
  value: string;
  // Откуда значение: «Реквизиты», «Реквизиты — из «Карточка предприятия.pdf»», «ТЗ, п. 2.1».
  source: string;
  required: boolean;
  // Почему не так: «120 — по ТЗ не меньше 150», «ИНН: не сходится контрольное число».
  problem?: string;
  // Где стоит поле — пункт ТЗ, товар, строка анкеты.
  context?: string;
};

export type FieldsInput = {
  purchase: Purchase;
  profile: Profile;
  // Откуда взялись реквизиты: поле, заполненное из документа участника, помнит его название.
  profileSources?: Partial<Record<ProfileKey, string>>;
  // Сколько документов участника нашлось для опыта и для специалистов («Образцы и реквизиты»).
  evidence?: Partial<Record<"experience" | "staff", number>>;
};

// Реквизиты, без которых документ не подать: в анкете — наименование, ИНН, ОГРН, адрес и руководитель,
// в декларации — наименование и категория МСП, в предложении о цене — НДС. Остальные строки анкеты — по возможности.
const NEED: Partial<Record<TpPart, ProfileKey[]>> = {
  participant: ["fullName", "inn", "ogrn", "legalAddress", "head"],
  declaration: ["fullName", "smeCategory"],
  price: ["vatNote"],
};
const LABELS = Object.fromEntries(ANKETA.map(({ key, label }) => [key, label])) as Partial<Record<ProfileKey, string>>;
const labelOf = (key: ProfileKey) => LABELS[key] ?? (key === "vatNote" ? "Как писать НДС в цене" : key === "signer" ? "Подписант" : key);

const PLACEHOLDER = /\[[^\]]+\]/g;
const AT_LEAST = /^\[число, не меньше (\d+(?:[.,]\d+)?)\]$/;
const toNum = (s: string) => Number(s.replace(",", "."));

// Что вписано на месте жёлтых полей заготовки: заготовку разбираем на куски и находим их в тексте.
// Участник переписал текст так, что куски не находятся, — значений не знаем (null).
export function filledValues(template: string, text: string): (string | null)[] {
  const bits = template.split(/(\[[^\]]+\])/);
  const holes = bits.filter((_, i) => i % 2).length;
  if (!holes) return [];
  const escaped = bits.map((b, i) => (i % 2 ? "([\\s\\S]*?)" : b.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&")));
  const m = new RegExp(`^${escaped.join("")}$`).exec(text);
  return m ? m.slice(1).map((v) => v) : Array.from({ length: holes }, () => null);
}

// Поля одного текста с жёлтыми местами: оставшиеся «[…]» — вписать, заполненные — сверить с заготовкой.
function textFields(
  base: { key: string; doc: string; part: TpPart; context: string; source: string },
  text: string,
  template: string | undefined
): ApplicationField[] {
  const out: ApplicationField[] = [];
  const open = text.match(PLACEHOLDER) ?? [];
  open.forEach((hole, j) =>
    out.push({ ...base, key: `${base.key}:${j}`, label: hole.slice(1, -1), kind: "manual", status: "needs_input", value: "", required: true })
  );
  if (!template) {
    if (!open.length) out.push({ ...base, key: base.key, label: base.context, kind: "auto", status: "filled", value: text, required: true });
    return out;
  }
  const holes = template.match(PLACEHOLDER) ?? [];
  if (!holes.length) {
    out.push({ ...base, key: base.key, label: base.context, kind: "auto", status: "filled", value: text, required: true });
    return out;
  }
  // Заполненные места: вписанное значение и проверка числа по заготовке — «[число, не меньше 150]».
  const values = filledValues(template, text);
  holes.forEach((hole, j) => {
    const value = values[j];
    if (value === null || value === undefined || value === hole) return;
    const min = AT_LEAST.exec(hole);
    const got = min ? /\d+(?:[.,]\d+)?/.exec(value) : null;
    const low = min && got && toNum(got[0]) < toNum(min[1]);
    out.push({
      ...base,
      key: `${base.key}:done:${j}`,
      label: hole.slice(1, -1),
      kind: "manual",
      status: low ? "invalid" : "filled",
      value: value.trim(),
      required: true,
      ...(low && { problem: `${got![0]} — по ТЗ не меньше ${min![1]}` }),
    });
  });
  return out;
}

// Строки анкеты заказчика со значениями, которые участник вписал, — для файла Word.
export const anketaExtraValues = (purchase: Pick<Purchase, "fieldValues">, form: TpForm): Record<string, string> =>
  Object.fromEntries(anketaExtraRows(form.participantFields).map((label) => [label, purchase.fieldValues?.[`anketa:${label}`] ?? ""]));

const confirmedOf = (p: Purchase) => new Set(p.confirmed ?? []);

export function fieldsOf({ purchase: p, profile, profileSources = {}, evidence = {} }: FieldsInput): ApplicationField[] {
  const out: ApplicationField[] = [];
  const confirmed = confirmedOf(p);
  const tp: TpResult | undefined = p.tp;
  const parts = tp ? partsOf(tp.form, p.criteria, p.kind) : [];
  const problems = profileProblems(profile);

  // Реквизиты — в анкету, декларацию и цену. Каждое поле — один раз, в первом документе, где оно нужно.
  const used = new Map<ProfileKey, TpPart>();
  for (const part of parts) {
    const keys = part === "participant" ? ANKETA.map((a) => a.key) : (NEED[part] ?? []);
    for (const key of keys) if (!used.has(key)) used.set(key, part);
  }
  const required = new Set(parts.flatMap((part) => NEED[part] ?? []));
  for (const [key, part] of used) {
    const value = profile[key].trim();
    const problem = value ? problems[key] : undefined;
    out.push({
      key: `profile:${key}`,
      label: labelOf(key),
      doc: PART_TITLES[part],
      part,
      kind: value ? "auto" : "manual",
      status: problem ? "invalid" : value ? "filled" : "needs_input",
      value,
      source: value ? (profileSources[key] ? `Реквизиты — из «${profileSources[key]}»` : "Реквизиты") : "",
      required: required.has(key),
      ...(problem && { problem }),
    });
  }
  // Кто подписывает документы с реквизитами — подтверждает человек: подпись ставит он.
  if (parts.some((part) => part !== "tp")) {
    const signer = profile.signer.trim() || profile.head.trim();
    out.push({
      key: "confirm:signer",
      label: "Кто подписывает заявку",
      doc: PART_TITLES.participant,
      part: "participant",
      kind: signer ? "confirm" : "manual",
      status: !signer ? "needs_input" : confirmed.has("confirm:signer") ? "filled" : "needs_confirmation",
      value: signer,
      source: signer ? "Реквизиты" : "",
      required: true,
    });
  }

  if (tp) {
    const draft = p.tpDraft;
    const doc = PART_TITLES.tp;
    tp.goods.forEach((g, i) =>
      out.push(
        ...textFields(
          { key: `tp:good:${i}`, doc, part: "tp", context: g.name, source: g.source || "ТЗ" },
          g.characteristics,
          draft?.goods[i]?.characteristics
        )
      )
    );
    tp.items.forEach((it, i) =>
      out.push(
        ...textFields(
          { key: `tp:item:${i}`, doc, part: "tp", context: it.topic, source: it.clause ? `ТЗ, п. ${it.clause}` : "ТЗ" },
          it.offer,
          draft?.items[i]?.offer
        )
      )
    );
    if (needsFill(tp.form.consent)) {
      out.push(...textFields({ key: "tp:consent", doc, part: "tp", context: "Согласие участника", source: tp.form.source || "Форма заказчика" }, tp.form.consent, undefined));
    }
    // Исполнители: кто выступит, знает только участник. Звание ниже требуемого — ошибка.
    if (tp.cast) {
      castCheck(tp.cast).forEach((c, gi) => {
        const g = tp.cast!.groups[gi];
        out.push({
          key: `cast:${g.key}`,
          label: g.title,
          doc,
          part: "tp",
          kind: "manual",
          status: c.ok ? "filled" : c.rankFail ? "invalid" : "needs_input",
          value: tp.cast!.rows.filter((r) => r.group === g.key && r.name.trim()).map((r) => r.name.trim()).join(", "),
          source: tp.cast!.clause ? `ТЗ, п. ${tp.cast!.clause}` : "ТЗ",
          required: true,
          context: "Состав исполнителей",
          ...(!c.ok && { problem: c.text }),
        });
      });
    }
    // Строки формы анкеты заказчика сверх реквизитов — вписываются под эту закупку.
    if (parts.includes("participant")) {
      for (const label of anketaExtraRows(tp.form.participantFields)) {
        const value = (p.fieldValues?.[`anketa:${label}`] ?? "").trim();
        out.push({
          key: `anketa:${label}`,
          label,
          doc: PART_TITLES.participant,
          part: "participant",
          kind: "manual",
          status: value ? "filled" : "needs_input",
          value,
          source: value ? "Вписано для этой закупки" : "",
          required: true,
          context: tp.form.source || "Форма анкеты заказчика",
        });
      }
    }
    // Опыт и специалисты: ИИ собирает сведения из договоров и дипломов участника — человек подтверждает.
    for (const part of parts.filter((x): x is "experience" | "staff" => x === "experience" || x === "staff")) {
      const n = evidence[part] ?? 0;
      const key = `confirm:${part}`;
      out.push({
        key,
        label: part === "experience" ? "Договоры с актами для опыта" : "Документы специалистов",
        doc: PART_TITLES[part],
        part,
        kind: n ? "confirm" : "manual",
        status: !n ? "needs_input" : confirmed.has(key) ? "filled" : "needs_confirmation",
        value: n ? `${n} в «Образцах и реквизитах»` : "",
        source: n ? "Образцы и реквизиты" : "",
        // За опыт и специалистов дают баллы — без них заявку не отклонят, но баллов будет меньше.
        required: false,
      });
    }
  }

  // Цену предлагает расчёт, выбирает участник. Выше начальной — заявку отклонят.
  const price = p.tpPrice ?? p.priceCalc?.price ?? null;
  const nmck = Number(String(p.price ?? "").replace(/[^\d,.]/g, "").replace(",", ".")) || null;
  if (tp) {
    out.push({
      key: "confirm:price",
      label: "Цена заявки",
      doc: parts.includes("price") ? PART_TITLES.price : "Подача на площадке",
      part: parts.includes("price") ? "price" : null,
      kind: "confirm",
      status: !price ? "needs_confirmation" : nmck && price > nmck ? "invalid" : "filled",
      value: price ? String(price) : "",
      source: price ? "Расчёт цены" : "",
      required: parts.includes("price"),
      ...(price && nmck && price > nmck && { problem: `выше начальной цены — ${nmck}` }),
    });
  }

  // Цифры из скана — ИИ мог ошибиться при распознавании: человек сверяет с оригиналом.
  for (const name of p.scans ?? []) {
    const key = `confirm:scan:${name}`;
    out.push({ key, label: `Цифры из скана «${name}»`, doc: "Документы закупки", part: null, kind: "confirm", status: confirmed.has(key) ? "filled" : "needs_confirmation", value: "", source: name, required: false });
  }
  // Непрочитанный файл закупки: что в нём требуется, определить нельзя.
  for (const f of p.unreadable) {
    out.push({ key: `file:${f.name}`, label: `Файл «${f.name}» не прочитан`, doc: "Документы закупки", part: null, kind: "unknown", status: "needs_input", value: "", source: f.name, required: true, problem: f.reason });
  }
  // Подпись — только человек, на площадке: сервис её не ставит.
  out.push({ key: "sign", label: "Подписать заявку электронной подписью и подать на площадке", doc: "Подача на площадке", part: null, kind: "sign", status: "action", value: "", source: "", required: true });
  return out;
}

// Сводка «Заполнение заявки»: сколько заполнено само, что подтвердить, что вписать, что не определено.
export function fieldSummary(fields: ApplicationField[]) {
  const count = (test: (f: ApplicationField) => boolean) => fields.filter(test).length;
  const work = fields.filter((f) => f.kind !== "sign");
  const done = work.filter((f) => f.status === "filled").length;
  return {
    auto: count((f) => f.kind === "auto" && f.status === "filled"),
    confirm: count((f) => f.status === "needs_confirmation"),
    manual: count((f) => f.kind === "manual" && f.status === "needs_input"),
    unknown: count((f) => f.kind === "unknown"),
    invalid: count((f) => f.status === "invalid"),
    sign: count((f) => f.kind === "sign"),
    done,
    total: work.length,
    // Доля готового — для полосы «Подготовка заявки 82 %».
    share: work.length ? done / work.length : 0,
  };
}

// Очередь пошагового мастера: сначала ошибки, потом непонятное, потом обязательное к вписыванию,
// потом необязательное, в конце — подтверждения.
export function fieldQueue(fields: ApplicationField[]): ApplicationField[] {
  const rank = (f: ApplicationField) =>
    f.status === "invalid" ? 0 : f.kind === "unknown" ? 1 : f.status === "needs_input" ? (f.required ? 2 : 3) : f.status === "needs_confirmation" ? 4 : 9;
  return fields.filter((f) => rank(f) < 9).sort((a, b) => rank(a) - rank(b));
}

// Записать значение из мастера: жёлтое место в ТП, строку анкеты или подтверждение. Реквизиты — общие для всех
// закупок, их правят в «Реквизитах» (null). Возвращает изменения закупки.
// Другое значение на месте, которое уже вписано: заготовку разбираем на куски, вписанное берём из текста, нужное меняем.
function refill(template: string, text: string, j: number, value: string): string {
  const values = filledValues(template, text);
  let n = -1;
  return template
    .split(/(\[[^\]]+\])/)
    .map((bit, k) => (k % 2 ? (++n === j ? value : (values[n] ?? bit)) : bit))
    .join("");
}

export function applyField(p: Purchase, key: string, value: string): Partial<Purchase> | null {
  const fill = (text: string, j: number) => {
    let n = -1;
    return text.replace(PLACEHOLDER, (hole) => (++n === j ? value : hole));
  };
  const [kind, what, index, hole] = key.split(":");
  if (key.startsWith("confirm:")) return { confirmed: [...new Set([...(p.confirmed ?? []), key])] };
  // tp:item:<пункт>:done:<место>, tp:good:<товар>:done:<место>, tp:consent:done:<место>
  const parts = key.split(":");
  const doneAt = parts.indexOf("done");
  if (kind === "tp" && doneAt > 0 && p.tp && p.tpDraft) {
    const draft = p.tpDraft;
    const i = Number(index);
    const j = Number(parts[doneAt + 1]);
    if (what === "item" && p.tp.items[i] && draft.items[i]) {
      return { tp: { ...p.tp, items: p.tp.items.map((it, k) => (k === i ? { ...it, offer: refill(draft.items[i].offer, it.offer, j, value) } : it)) } };
    }
    if (what === "good" && p.tp.goods[i] && draft.goods[i]) {
      return { tp: { ...p.tp, goods: p.tp.goods.map((g, k) => (k === i ? { ...g, characteristics: refill(draft.goods[i].characteristics, g.characteristics, j, value) } : g)) } };
    }
    if (what === "consent") {
      return { tp: { ...p.tp, form: { ...p.tp.form, consent: refill(draft.form.consent, p.tp.form.consent, j, value) } } };
    }
    return null;
  }
  if (kind === "anketa") return { fieldValues: { ...p.fieldValues, [key]: value } };
  if (kind === "tp" && p.tp && hole !== undefined && hole !== "done") {
    const i = Number(index);
    const j = Number(hole);
    if (what === "item" && p.tp.items[i]) return { tp: { ...p.tp, items: p.tp.items.map((it, k) => (k === i ? { ...it, offer: fill(it.offer, j) } : it)) } };
    if (what === "good" && p.tp.goods[i]) return { tp: { ...p.tp, goods: p.tp.goods.map((g, k) => (k === i ? { ...g, characteristics: fill(g.characteristics, j) } : g)) } };
  }
  if (kind === "tp" && what === "consent" && p.tp && index !== undefined) {
    return { tp: { ...p.tp, form: { ...p.tp.form, consent: fill(p.tp.form.consent, Number(index)) } } };
  }
  return null;
}

// Итоговая проверка перед скачиванием — ни одного пустого обязательного поля. Документы заказчика — пункты
// «Что подать» с отметкой «готово». Подпись сервис не ставит: комплект готов, когда осталось только подписать.
export type Completeness = {
  fields: { required: number; filled: number; empty: number; invalid: number };
  documents: { required: number; ready: number };
  confirmations: { required: number; done: number };
  signatures: { required: number; done: number };
  blocking: string[];
  ready: boolean;
  text: string;
};

const count = (n: number, one: string, few: string, many: string) => {
  const a = n % 100, b = n % 10;
  return `${n} ${a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many}`;
};

export function completeness(p: Purchase, fields: ApplicationField[]): Completeness {
  const need = fields.filter((f) => f.required && f.kind !== "sign" && f.kind !== "confirm");
  const confirms = fields.filter((f) => f.required && f.kind === "confirm");
  const filled = need.filter((f) => f.status === "filled").length;
  const invalid = fields.filter((f) => f.status === "invalid").length;
  const empty = need.filter((f) => f.status === "needs_input").length;
  const docs = p.requirements.submit;
  const ready = docs.filter((d) => (p.submitReady ?? []).includes(d.text)).length;
  const done = confirms.filter((f) => f.status === "filled").length;
  const signs = fields.filter((f) => f.kind === "sign").length;

  const blocking = [
    ...(!p.tp ? ["документы заявки ещё не составлены"] : []),
    ...(empty ? [`не заполнено обязательных полей: ${empty}`] : []),
    ...(invalid ? [`с ошибкой: ${count(invalid, "поле", "поля", "полей")}`] : []),
    ...(confirms.length - done ? [`не подтверждено: ${confirms.length - done}`] : []),
    ...(docs.length - ready ? [`не готово документов заказчика: ${docs.length - ready} из ${docs.length}`] : []),
  ];
  const isReady = blocking.length === 0;
  return {
    fields: { required: need.length, filled, empty, invalid },
    documents: { required: docs.length, ready },
    confirmations: { required: confirms.length, done },
    signatures: { required: signs, done: 0 },
    blocking,
    ready: isReady,
    text: isReady
      ? "Формальный комплект заявки сформирован. Осталось подписать его электронной подписью и подать на площадке."
      : `Заявка ещё не готова к подаче: ${blocking.join(", ")}.`,
  };
}
