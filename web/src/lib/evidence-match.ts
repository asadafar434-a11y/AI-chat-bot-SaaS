// Что есть у компании → подходит ли под требование. Потребность (evidence-need.ts) сверяется с базой доказательств: находятся факты
// нужного вида и по предмету, проверяется срок действия на дату подачи, свежесть документа, подтверждение человеком и числа
// заказчика («не менее 150 мест»). Итог — статус, а не догадка:
//   ok             — есть доказательство, действует, подходит;
//   expiring       — всё подходит, но срок кончится вскоре после даты подачи;
//   expired        — документ просрочен или старше, чем просит заказчик;
//   mismatch       — есть, но не подходит: число меньше нужного, срок ещё не начался, договоров не хватает;
//   needs_evidence — в базе нет того, чем это подтвердить (нет факта или нет документа к нему) — система ничего не подставляет;
//   need_human     — есть, но решает человек: ИИ нашёл и не подтвердили, нет срока, нет числа, неясно, какой документ имеется в виду.
// Модуль без зависимостей от браузера и сервера: его проверяют тесты (npm test).
import { describeCondition, satisfies, unitKey, type Condition } from "@/lib/conditions";
import {
  answersRequirement,
  daysBetween,
  dayOf,
  EXPIRING_DAYS,
  isoOf,
  stemShare,
  textWords,
  validityAt,
  factText,
  type Fact,
} from "@/lib/evidence-base";
import { needsOfPurchase, type Need } from "@/lib/evidence-need";
import type { Profile, ProfileKey } from "@/lib/profile";
import { titleOf, type Purchase } from "@/lib/purchase";
import type { Requirement } from "@/lib/requirement-engine";
import { profileProblems } from "@/lib/requisites-check";
import { parseRubles } from "@/lib/rub-words";

export type EvidenceStatus = "ok" | "expiring" | "expired" | "mismatch" | "needs_evidence" | "need_human";

export const EVIDENCE_TEXT: Record<EvidenceStatus, string> = {
  ok: "Подтверждено",
  expiring: "Скоро истечёт",
  expired: "Просрочено",
  mismatch: "Не подходит",
  needs_evidence: "Нет доказательства",
  need_human: "Решает человек",
};

// Чем хуже статус, тем выше номер: из нескольких проверок берётся худшая.
const SEVERITY: Record<EvidenceStatus, number> = { ok: 0, expiring: 1, need_human: 2, needs_evidence: 3, mismatch: 4, expired: 5 };
export const worst = (list: EvidenceStatus[]): EvidenceStatus => list.reduce((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a), "ok" as EvidenceStatus);
// Из нескольких фактов на одну потребность берётся лучший: достаточно одного подходящего. need_human лучше просрочки — человек
// может подтвердить, а просроченное не исправить.
const GOODNESS: EvidenceStatus[] = ["ok", "expiring", "need_human", "expired", "mismatch", "needs_evidence"];
const best = (list: EvidenceStatus[]): EvidenceStatus => list.reduce((a, b) => (GOODNESS.indexOf(b) < GOODNESS.indexOf(a) ? b : a));

export type Check = {
  need: Need;
  status: EvidenceStatus;
  // Подошедшие факты: лучшие первыми. Для реквизитов пусто — они в профиле.
  facts: Fact[];
  // Почему такой статус, по пунктам, словами.
  reasons: string[];
  // Факты нужного вида, которые по словам не узнаны, но могут быть тем, что просит заказчик: человек может сказать «это оно».
  similar?: Fact[];
};

// Что есть у компании: факты базы и реквизиты профиля с тем, откуда они взяты.
export type Base = { facts: Fact[]; profile: Profile; sources?: Partial<Record<ProfileKey, string>> };
// На какую дату проверять (дата подачи заявки, а без неё — сегодня) и начальная цена закупки.
export type When = { on: string; nmck?: number | null };

type Verdict = { status: EvidenceStatus; reasons: string[] };

const dm = (iso: string) => iso.split("-").reverse().join(".");
const days = (n: number) => `${n} ${n % 100 > 10 && n % 100 < 20 ? "дней" : n % 10 === 1 ? "день" : n % 10 >= 2 && n % 10 <= 4 ? "дня" : "дней"}`;
const rub = (n: number) => `${n.toLocaleString("ru-RU")} руб.`;

// ———— Подходит ли факт по виду и предмету ————

const KIND_OF: Record<string, Fact["kind"][]> = {
  license: ["license"],
  certificate: ["certificate"],
  document: ["document"],
  experience: ["experience"],
  employee: ["employee", "qualification"],
  qualification: ["qualification"],
  equipment: ["equipment"],
  finance: ["finance"],
};

const NUMBER_STEM = /^\d{3,}$/;

// Факт отвечает предмету потребности: нужные слова на месте, номера стандартов («9001») совпадают. Человек сказал «это оно» —
// предмет совпал; срок, свежесть, числа и документ проверяются дальше как обычно.
export function matches(need: Need, fact: Fact): boolean {
  if (!KIND_OF[need.kind]?.includes(fact.kind)) return false;
  if (answersRequirement(fact, need.requirement.text)) return true;
  const words = textWords(factText(fact));
  if (need.anyOf.length > 0 && !need.anyOf.some((s) => words.some((w) => w.startsWith(s)))) return false;
  const numbers = need.stems.filter((s) => NUMBER_STEM.test(s));
  if (numbers.some((s) => !words.some((w) => w === s || w.startsWith(s)))) return false;
  return stemShare(need.stems.filter((s) => !NUMBER_STEM.test(s)), words) >= 0.6;
}

// ———— Один факт против потребности ————

// Срок, свежесть, подтверждение, документ-источник и числа. Худшая из найденных проблем — статус факта.
function verdictOf(fact: Fact, need: Need, when: When): Verdict {
  const found: Verdict[] = [];
  const add = (status: EvidenceStatus, reason: string) => found.push({ status, reasons: [reason] });
  const name = `«${fact.title}»`;

  if (fact.origin === "ai" && !fact.confirmed) {
    add("need_human", `${name} нашёл ИИ${fact.source.type === "document" ? ` в «${fact.source.docName}»` : ""} — проверьте и подтвердите`);
  }
  if (need.proof === "document" && fact.source.type !== "document") {
    add("needs_evidence", `${name}: вписано без документа — нужен файл, которым это подтверждается`);
  }

  // Срок действия.
  const needsTerm = fact.kind === "license" || fact.kind === "certificate" || fact.kind === "qualification";
  const at = validityAt(fact.validity, when.on);
  if (at.state === "expired") add("expired", `${name} просрочен: действовал до ${dm(fact.validity.until!)}, на ${dm(when.on)} уже нет`);
  else if (at.state === "not_started") add("mismatch", `${name} начнёт действовать только ${dm(fact.validity.from!)}`);
  else if (at.state === "unknown" && needsTerm) add("need_human", `${name}: не указан срок действия — укажите дату или «бессрочно»`);
  else if (at.state === "valid" && at.days! <= EXPIRING_DAYS) add("expiring", `${name} действует до ${dm(fact.validity.until!)} — через ${days(at.days!)} после даты подачи`);

  // Свежесть документа: «не ранее чем за 30 дней до подачи».
  if (need.freshnessDays !== undefined) {
    const issued = fact.fields.issuedAt;
    const age = issued ? daysBetween(issued, when.on) : null;
    if (age === null) add("need_human", `${name}: не указана дата документа — заказчик просит не старше ${days(need.freshnessDays)}`);
    else if (age > need.freshnessDays) add("expired", `${name} от ${dm(issued!)}: на дату подачи ему ${days(age)}, заказчик просит не старше ${days(need.freshnessDays)}`);
  }

  // Числа заказчика: факт должен их подтвердить.
  for (const c of need.measures) {
    const m = measureFor(fact, c);
    if (c.parts) add("need_human", `${name}: размеры «${describeCondition(c)}» сверьте сами`);
    else if (m === null) {
      if (fact.kind === "equipment" || fact.kind === "employee" || fact.kind === "finance") add("need_human", `${name}: нет числа для «${describeCondition(c)}» — впишите его в факт`);
    } else if (!satisfies(c, [m.value])) add("mismatch", `${name}: ${m.what} — ${m.value.toLocaleString("ru-RU")} ${m.unit}, а по требованию ${describeCondition(c)}`);
  }

  if (found.length === 0) return { status: "ok", reasons: [`${name} подходит`] };
  return { status: worst(found.map((v) => v.status)), reasons: found.flatMap((v) => v.reasons) };
}

// Число факта с той же единицей, что у условия.
function measureFor(fact: Fact, c: Condition) {
  const key = unitKey(c.unit);
  return fact.measures.find((m) => unitKey(m.unit) === key) ?? null;
}

// Среди подходящих фактов — лучший: достаточно одного. Причины — лучшего, чтобы человек видел, что поправить.
function oneOf(candidates: Fact[], need: Need, when: When): Check {
  const verdicts = candidates.map((fact) => ({ fact, ...verdictOf(fact, need, when) }));
  const top = best(verdicts.map((v) => v.status));
  const ranked = verdicts.filter((v) => v.status === top);
  // Нет подсказки, какой именно документ имеется в виду: подходящий найден, но выбор — за человеком.
  const vague = need.stems.length === 0 && need.anyOf.length === 0 && need.measures.length === 0 && (need.kind === "license" || need.kind === "certificate");
  const status = top === "ok" && vague && candidates.length > 1 ? "need_human" : top;
  const reasons = ranked[0].reasons.slice();
  if (status === "need_human" && top === "ok") reasons.push(`в требовании не сказано, какой именно документ нужен, а в базе их несколько: ${candidates.map((f) => `«${f.title}»`).join(", ")}`);
  return { need, status, facts: verdicts.sort((a, b) => GOODNESS.indexOf(a.status) - GOODNESS.indexOf(b.status)).map((v) => v.fact), reasons };
}

// ———— Опыт: договоры за период ————

const COUNT_UNIT = new Set(["дого", "конт", "раз", "шт", "случ"]);

function experienceCheck(need: Need, base: Base, when: When): Check {
  const all = base.facts.filter((f) => f.kind === "experience");
  if (all.length === 0) return { need, status: "needs_evidence", facts: [], reasons: ["В базе нет ни одного исполненного договора."] };

  const reasons: string[] = [];
  let doubtful = false;
  const onDay = dayOf(when.on);
  const from = need.windowMonths && onDay !== null ? isoOf(onDay - Math.round(need.windowMonths * 30.4375)) : null;
  const eachPercent = need.measures.find((c) => unitKey(c.unit) === "%");
  const eachMin = eachPercent && when.nmck ? (when.nmck * eachPercent.value) / 100 : null;
  if (eachPercent && !when.nmck) {
    doubtful = true;
    reasons.push(`заказчик считает ${describeCondition(eachPercent)}, но начальная цена закупки не известна`);
  }

  const good: Fact[] = [];
  // Договоры, у которых по предмету не видно, что это опыт, которого просит заказчик: человек может сказать «это оно».
  const similar: Fact[] = [];
  for (const fact of all) {
    const name = `«${fact.title}»`;
    if (fact.origin === "ai" && !fact.confirmed) {
      doubtful = true;
      reasons.push(`${name} нашёл ИИ — подтвердите`);
      continue;
    }
    // Исполнен — значит, есть акт о приёмке; без акта договор опытом не считают.
    const actDate = fact.fields.actDate;
    if (!actDate && !fact.fields.actNo) {
      reasons.push(`${name}: нет акта о приёмке — договор без акта опытом не считается`);
      continue;
    }
    if (from && actDate) {
      if (actDate < from || actDate > when.on) {
        reasons.push(`${name}: акт от ${dm(actDate)} — вне периода ${dm(from)} — ${dm(when.on)}`);
        continue;
      }
    } else if (from && !actDate) {
      doubtful = true;
      reasons.push(`${name}: не указана дата акта — не ясно, входит ли в период`);
      continue;
    }
    const price = fact.measures.find((m) => unitKey(m.unit) === "руб")?.value;
    if (eachMin !== null && (price === undefined || price < eachMin)) {
      reasons.push(price === undefined ? `${name}: не указана цена договора` : `${name}: цена ${rub(price)} меньше ${rub(Math.round(eachMin))}, которые просит заказчик`);
      if (price === undefined) doubtful = true;
      continue;
    }
    // Предмет: если требование называет его словами, договор должен им отвечать; иначе — решает человек.
    if (need.stems.length > 0 && !answersRequirement(fact, need.requirement.text) && stemShare(need.stems, textWords(factText(fact))) < 0.5) {
      doubtful = true;
      similar.push(fact);
      reasons.push(`${name}: по предмету не видно, что это опыт, который просит заказчик, — проверьте`);
      continue;
    }
    good.push(fact);
  }

  const fails: string[] = [];
  for (const c of need.measures) {
    const key = unitKey(c.unit);
    if (key === "%") continue;
    if (COUNT_UNIT.has(key)) {
      if (!satisfies(c, [good.length])) fails.push(`подходящих договоров ${good.length}, а нужно ${describeCondition(c)}`);
    } else if (key === "руб") {
      const sum = good.reduce((acc, f) => acc + (f.measures.find((m) => unitKey(m.unit) === "руб")?.value ?? 0), 0);
      if (!satisfies(c, [sum])) fails.push(`общая цена подходящих договоров ${rub(sum)}, а нужно ${describeCondition(c)}`);
    }
  }
  const status: EvidenceStatus =
    good.length === 0 ? (doubtful ? "need_human" : "needs_evidence") : fails.length ? (doubtful ? "need_human" : "mismatch") : doubtful ? "need_human" : "ok";
  const summary = good.length ? [`Подходящих договоров: ${good.length}`] : [];
  return { need, status, facts: good, reasons: [...summary, ...fails, ...reasons], similar };
}

// ———— Сотрудники ————

const PEOPLE_UNIT = new Set(["спец", "чело", "сотр", "рабо", "лицо", "лиц"]);

const personOf = (f: Fact) => (f.kind === "qualification" ? f.fields.holder || f.title : f.title).toLowerCase().replace(/ё/g, "е").replace(/[^а-яa-z]+/g, " ").trim();

function employeeCheck(need: Need, base: Base, when: When): Check {
  const candidates = base.facts.filter((f) => matches(need, f));
  if (candidates.length === 0) {
    const people = base.facts.filter((f) => f.kind === "employee" || f.kind === "qualification");
    return {
      need,
      status: "needs_evidence",
      facts: [],
      reasons: [people.length ? "Среди сотрудников и их документов в базе не видно подходящих по требованию." : "В базе нет ни сотрудников, ни их документов."],
      similar: people,
    };
  }
  const people = new Set<string>();
  const reasons: string[] = [];
  const verdicts = candidates.map((fact) => ({ fact, ...verdictOf(fact, need, when) }));
  for (const v of verdicts) {
    if (v.status === "ok" || v.status === "expiring") people.add(personOf(v.fact));
    else reasons.push(...v.reasons);
  }
  const fails: string[] = [];
  for (const c of need.measures) {
    if (PEOPLE_UNIT.has(unitKey(c.unit)) && !satisfies(c, [people.size])) fails.push(`подходящих специалистов ${people.size}, а нужно ${describeCondition(c)}`);
  }
  const counted = verdicts.filter((v) => v.status === "ok" || v.status === "expiring");
  let status: EvidenceStatus;
  if (counted.length === 0) status = best(verdicts.map((v) => v.status));
  else if (fails.length) status = verdicts.some((v) => v.status === "need_human") ? "need_human" : "mismatch";
  else status = counted.every((v) => v.status === "expiring") ? "expiring" : "ok";
  const ranked = verdicts.sort((a, b) => GOODNESS.indexOf(a.status) - GOODNESS.indexOf(b.status)).map((v) => v.fact);
  return { need, status, facts: ranked, reasons: [...(people.size ? [`Подходящих специалистов: ${people.size}`] : []), ...fails, ...reasons] };
}

// ———— Реквизиты ————

const LABEL: Partial<Record<ProfileKey, string>> = {
  fullName: "полное наименование", inn: "ИНН", ogrn: "ОГРН", legalAddress: "юридический адрес", head: "руководитель", account: "расчётный счёт",
  bankName: "банк", bik: "БИК", corrAccount: "корреспондентский счёт", smeCategory: "категория МСП",
};

function requisiteCheck(need: Need, base: Base): Check {
  const keys = need.requisites ?? [];
  const problems = profileProblems(base.profile);
  const missing = keys.filter((k) => !base.profile[k].trim());
  const wrong = keys.filter((k) => base.profile[k].trim() && problems[k]);
  const reasons = [
    ...missing.map((k) => `не заполнено: ${LABEL[k] ?? k}`),
    ...wrong.map((k) => `${LABEL[k] ?? k}: ${problems[k]}`),
  ];
  // Нет значения — система его не подставляет; есть, но не сходятся контрольные цифры — смотрит человек.
  const status: EvidenceStatus = missing.length ? "needs_evidence" : wrong.length ? "need_human" : "ok";
  return { need, status, facts: [], reasons: reasons.length ? reasons : ["Реквизиты заполнены и проходят проверку по контрольным цифрам."] };
}

// ———— Потребность целиком ————

export function checkNeed(need: Need, base: Base, when: When): Check {
  if (need.kind === "requisite") return requisiteCheck(need, base);
  if (need.kind === "experience") return experienceCheck(need, base, when);
  if (need.kind === "employee") return employeeCheck(need, base, when);

  const candidates = base.facts.filter((f) => matches(need, f));
  if (candidates.length === 0) {
    const same = base.facts.filter((f) => KIND_OF[need.kind]?.includes(f.kind));
    return {
      need,
      status: "needs_evidence",
      facts: [],
      reasons: [
        same.length
          ? `В базе есть другое (${same.map((f) => `«${f.title}»`).join(", ")}), но по названию и описанию не видно, что это то, что просит заказчик. Если это оно — отметьте ниже.`
          : `В базе нет: ${need.label.toLowerCase()}.`,
      ],
      similar: same,
    };
  }
  return oneOf(candidates, need, when);
}

// Дата, на которую проверять закупку: срок подачи, если он известен, иначе сегодня.
export const onDateOf = (deadline: { date: string }, today: string) => (dayOf(deadline.date) !== null ? deadline.date : today);

// ———— Закупка целиком и пробелы по всем закупкам ————

export type PurchaseCheck = { requirement: Requirement; needs: Need[]; checks: Check[] };

// Каждое требование закупки с тем, что для него нужно, и тем, что с этим в базе. Дата проверки — срок подачи закупки.
export function checkPurchase(p: Purchase, base: Base, today: string): PurchaseCheck[] {
  const when: When = { on: onDateOf(p.deadline, today), nmck: parseRubles(p.price) };
  return needsOfPurchase(p, base.profile).map(({ requirement, needs }) => ({
    requirement,
    needs,
    checks: needs.map((need) => checkNeed(need, base, when)),
  }));
}

// Что нужно закупкам, а в базе нет или не подходит, — одной строкой на потребность: у закупок одно и то же требуют часто.
export type Gap = {
  key: string;
  kind: Need["kind"];
  label: string;
  status: EvidenceStatus;
  // Только «за баллы» или «по желанию»: заявку без этого подадут, но баллов будет меньше.
  optional: boolean;
  purchases: { id: string; title: string }[];
  // Откуда потребность: из какого требования закупки («Критерий оценки» — текст требования). Без этого две строки с одним названием
  // («Оборудование или площадка») не отличить: у одной граница «не менее 150 мест», у другой — звук и свет.
  from: { basis: string; text: string }[];
  reasons: string[];
  facts: Fact[];
  // Факты нужного вида, которых по словам не узнали: «это оно» — решает человек (связь факта с требованием).
  similar: Fact[];
};

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, " ").trim();

export function gapsOf(purchases: Purchase[], base: Base, today: string): Gap[] {
  const gaps = new Map<string, Gap>();
  for (const p of purchases) {
    for (const { checks } of checkPurchase(p, base, today)) {
      for (const check of checks) {
        const n = check.need;
        const key = [n.kind, norm(n.label), n.stems.join(","), n.anyOf.join(","), n.measures.map(describeCondition).join(";")].join("|");
        const gap = gaps.get(key);
        const title = { id: p.id, title: titleOf(p) };
        const from = { basis: n.basis, text: n.requirement.text.trim() };
        if (!gap) {
          gaps.set(key, { key, kind: n.kind, label: n.label, status: check.status, optional: n.optional, purchases: [title], from: [from], reasons: check.reasons, facts: check.facts, similar: check.similar ?? [] });
          continue;
        }
        // Одну закупку и одно требование называем один раз, сколько бы потребностей из них ни вышло.
        if (!gap.purchases.some((x) => x.id === p.id)) gap.purchases.push(title);
        if (!gap.from.some((x) => x.basis === from.basis && x.text === from.text)) gap.from.push(from);
        for (const f of check.similar ?? []) if (!gap.similar.some((x) => x.id === f.id)) gap.similar.push(f);
        gap.optional = gap.optional && n.optional;
        if (SEVERITY[check.status] > SEVERITY[gap.status]) Object.assign(gap, { status: check.status, reasons: check.reasons, facts: check.facts });
      }
    }
  }
  return [...gaps.values()];
}
