// Требование → какое доказательство нужно. Заказчик требует «лицензию на образовательную деятельность», «опыт не менее 3 договоров
// за 3 года», «зал не менее 150 мест», «выписку не старше 30 дней» — здесь это превращается в потребность: что именно нужно
// подтвердить (лицензия, договоры, оборудование…), какими словами искать подходящий факт в базе, какие числа он должен подтвердить
// и насколько свежим должен быть документ. Кто и что есть у компании — в evidence-match.ts; здесь только то, что нужно.
// Модуль без зависимостей от браузера и сервера: его проверяют тесты (npm test).
import { unitKey, type Condition } from "@/lib/conditions";
import { stemsOf, type FactKind } from "@/lib/evidence-base";
import { contextOf, ruleOf, type RulePlan, type RuleId } from "@/lib/fulfillment";
import type { Profile, ProfileKey } from "@/lib/profile";
import type { Purchase } from "@/lib/purchase";
import { requirementOf, supplierChoices, type Requirement, type RequirementGroup } from "@/lib/requirement-engine";
import { criteriaRequirement } from "@/lib/requirement-offers";
import { REQ_GROUP_KEYS } from "@/lib/requirements";

// requisite — реквизиты в профиле компании: они не факты базы, а поля профиля.
export type NeedKind = FactKind | "requisite";

export type Need = {
  id: string;
  kind: NeedKind;
  // Что нужно подтвердить, словами для человека: «Лицензия или членство в СРО», «Опыт: исполненные договоры».
  label: string;
  // document — нужен документ-подтверждение (копию приложат к заявке); statement — хватит слов компании: её собственные числа.
  proof: "document" | "statement";
  // Начала слов, по которым ищется факт; anyOf — хотя бы одно из этих слов обязано найтись в факте (виды документов компании).
  stems: string[];
  anyOf: string[];
  // Числа, которые факт должен подтвердить: граница заказчика («не менее 150 мест»).
  measures: Condition[];
  // Документ не старше стольких дней на дату подачи: «выписка, полученная не ранее чем за 30 дней».
  freshnessDays?: number;
  // Опыт считается за последние стольки месяцев до даты подачи: «за последние 3 года».
  windowMonths?: number;
  // Для requisite — какие поля профиля нужны.
  requisites?: ProfileKey[];
  // За это дают баллы или заказчик просит «по желанию»: без доказательства заявку не отклонят, но баллы пропадут.
  optional: boolean;
  scoring: boolean;
  // Откуда потребность: «Что подать: Устав», «Требование к участнику», «Критерий оценки».
  basis: string;
  requirement: { id: string; group: RequirementGroup; text: string };
};

type Seed = {
  kind: NeedKind;
  label: string;
  proof: "document" | "statement";
  anyOf?: string[];
  requisites?: ProfileKey[];
};

// Слова, которые говорят о виде факта, но не о предмете: по ним факт уже отобран по виду, искать их в названии незачем.
const KIND_STEMS: Record<NeedKind, string[]> = {
  license: ["лицен", "допус", "члене", "членс", "самор", "сро"],
  certificate: ["серти", "свиде", "регис", "удост", "декла", "соотв"],
  document: ["устав", "выпис", "довер", "карто", "учред"],
  experience: ["опыт", "догов", "контр", "испол", "аналог", "акт", "актам", "акты", "реест"],
  employee: ["специ", "квали", "дипло", "удост", "стаж", "сотру", "персо", "кадро", "штатн", "работ"],
  qualification: ["квали", "дипло", "удост"],
  equipment: ["обору", "техни", "матер", "площа", "транс"],
  finance: ["выруч", "оборо", "финан", "бухга", "налог", "справ"],
  requisite: [],
};

// ———— Что в тексте требования ————

const CAPS = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

const PERSON = /специалист|ведущ|работник|сотрудник|персонал|артист|кадров|штатн|инженер|режисс|диплом|квалификаци|удостоверени|допуск[а-яё]*\s+(?:по\s+)?электробезопасн|стаж/i;

// Что просит текст. Порядок — от частного к общему; одно требование может просить сразу несколько вещей.
const KINDS: { id: string; re: RegExp; make: (text: string) => Seed }[] = [
  {
    id: "license",
    re: /лиценз|(?<![а-яё])СРО(?![а-яё])|саморегулируем|свидетельств[а-яё]*\s+о\s+допуск|допуск[а-яё]*\s+к\s+(?:определ|вид|работ)|членств[а-яё]*\s+в\s+(?:СРО|саморег)/i,
    make: () => ({ kind: "license", label: "Лицензия или допуск", proof: "document" }),
  },
  {
    id: "certificate",
    re: /сертификат|регистрационн[а-яё]*\s+удостоверени|санитарно-эпидемиологическ|(?<![а-яё])ISO\s*\d|ГОСТ\s*Р|декларац[а-яё]*\s+о\s+соответстви[а-яё]*\s+(?:ЕАЭС|ТР\s*ТС|товар|продукц)/i,
    make: () => ({ kind: "certificate", label: "Сертификат или свидетельство", proof: "document" }),
  },
  {
    id: "company-document",
    re: /устав|учредительн[а-яё]*\s+документ|выписк[а-яё]*\s+из\s+(?:единого\s+)?(?:государственного|ЕГРЮЛ|ЕГРИП)|(?<![а-яё])ЕГР(?:ЮЛ|ИП)(?![а-яё])|доверенност|(?:приказ|решени)[а-яё]*\s+(?:о\s+)?(?:назначени|избрани)|карточк[а-яё]*\s+(?:предприяти|организаци)/i,
    make: (text) => {
      if (/устав|учредительн/i.test(text)) return { kind: "document", label: "Устав", proof: "document", anyOf: ["устав", "учред"] };
      if (/выписк|ЕГР/i.test(text)) return { kind: "document", label: "Выписка из ЕГРЮЛ или ЕГРИП", proof: "document", anyOf: ["выпис", "егрюл", "егрип"] };
      if (/доверенност/i.test(text)) return { kind: "document", label: "Доверенность", proof: "document", anyOf: ["довер"] };
      if (/карточк/i.test(text)) return { kind: "document", label: "Карточка предприятия", proof: "document", anyOf: ["карто"] };
      return { kind: "document", label: "Приказ или решение о руководителе", proof: "document", anyOf: ["прика", "решен", "назна", "избра", "прото"] };
    },
  },
  {
    id: "finance",
    re: /выручк|оборот|финансов[а-яё]*\s+(?:устойчивост|показател|состояни)|бухгалтерск[а-яё]*\s+(?:отч[её]тност|баланс)|чист[а-яё]*\s+актив|налогов[а-яё]*\s+деклараци|отсутстви[а-яё]*\s+(?:недоимк|задолженност)|справк[а-яё]*\s+(?:об\s+)?(?:исполнени\S*\s+обязанност|отсутстви|налогов)|среднесписочн[а-яё]*\s+численност|доход[а-яё]*\s+от\s+предпринимательск/i,
    make: () => ({ kind: "finance", label: "Финансовые данные", proof: "document" }),
  },
  {
    id: "staff",
    re: /специалист|квалификаци|диплом|удостоверени[а-яё]*|повышени[а-яё]*\s+квалификаци|стаж[а-яё]*|работник|персонал|кадров|трудов[а-яё]*\s+ресурс|штатн[а-яё]*|сотрудник|допуск[а-яё]*\s+(?:по\s+)?электробезопасн|группа\s+(?:по\s+)?электробезопасн|образовани[а-яё]*\s+(?:не\s+ниже|высшее)|высшее\s+(?:профессиональн|образовани)/i,
    make: () => ({ kind: "employee", label: "Специалисты и их документы", proof: "document" }),
  },
  {
    id: "experience",
    re: /опыт[а-яё]*\s+(?:выполнени|оказани|исполнени|поставк|производств)|(?:наличие\s+)?опыт[а-яё]*\s+участник|исполненн[а-яё]*\s+(?:договор|контракт)|аналогичн[а-яё]*\s+(?:договор|контракт|услуг|работ)|реестр[а-яё]*\s+контрактов|акт[а-яё]*\s+(?:о\s+)?(?:приёмк|приемк|выполненн|оказанн)/i,
    make: () => ({ kind: "experience", label: "Опыт: исполненные договоры", proof: "document" }),
  },
  {
    id: "equipment",
    re: /оборудован|материально[-\s]техническ|транспортн[а-яё]*\s+средств|автотранспорт|(?:в\s+)?собственност[а-яё]*\s+или\s+(?:на\s+ином|в\s+аренде)|площадк[а-яё]*\s+(?:провед|мероприят)|производственн[а-яё]*\s+(?:баз|мощност)|техническ[а-яё]*\s+средств|светодиодн|помещени[а-яё]*|зал[а-яё]*\s+вместимост|(?<![а-яё])зал(?![а-яё])/i,
    make: () => ({ kind: "equipment", label: "Оборудование или площадка", proof: "statement" }),
  },
];

// Из текста — что просят: виды, которые он называет. «Опыт» при словах о людях — это опыт специалиста, а не компании.
export function classify(text: string): Seed[] {
  const seeds: Seed[] = [];
  const person = PERSON.test(text);
  for (const kind of KINDS) {
    if (!kind.re.test(text)) continue;
    // Опыт компании — исполненные договоры; «опыт работы ведущего не менее 3 лет» — это сотрудник.
    if (kind.id === "experience" && person && !/исполненн|договор|контракт/i.test(text)) continue;
    seeds.push(kind.make(text));
  }
  // «Опыт» отдельным словом: если о людях — сотрудник, иначе — опыт компании.
  if (/(?<![а-яё])опыт/i.test(text) && !seeds.some((s) => s.kind === "experience" || s.kind === "employee")) {
    seeds.push(person ? { kind: "employee", label: "Специалисты и их документы", proof: "document" } : { kind: "experience", label: "Опыт: исполненные договоры", proof: "document" });
  }
  // Один вид — одна потребность.
  return seeds.filter((s, i) => seeds.findIndex((o) => o.kind === s.kind && o.label === s.label) === i).slice(0, 3);
}

// ———— Свежесть и период ————

const WORD_NUMBERS: Record<string, number> = {
  один: 1, одного: 1, два: 2, двух: 2, три: 3, трех: 3, трёх: 3, четыре: 4, четырех: 4, четырёх: 4, пять: 5, пяти: 5, шесть: 6, шести: 6,
  семь: 7, семи: 7, десять: 10, десяти: 10, пятнадцать: 15, пятнадцати: 15, двадцать: 20, двадцати: 20, тридцать: 30, тридцати: 30,
};
const numberOf = (digits: string | undefined, word: string | undefined) => (digits ? Number(digits) : word ? WORD_NUMBERS[word.toLowerCase()] : undefined);

// «не ранее чем за 30 календарных дней до даты подачи» → 30; «не старше 6 месяцев» → 180. Не сказано — undefined.
export function freshnessDaysOf(text: string): number | undefined {
  const m =
    /(?:не\s+ранее\s+чем\s+за|не\s+более\s+чем\s+за|давност[а-яё]*\s+не\s+более|не\s+старше|не\s+позднее\s+чем\s+за)\s+(?:(\d+)|([а-яё]+))\s*(?:\([^)]*\)\s*)?(?:календарн[а-яё]*\s+|рабоч[а-яё]*\s+)?(дн[а-яё]*|дне[йя]|месяц[а-яё]*|недел[а-яё]*)/i.exec(
      text
    );
  if (!m) return undefined;
  const n = numberOf(m[1], m[2]);
  if (!n) return undefined;
  const unit = m[3].toLowerCase();
  return /^недел/.test(unit) ? n * 7 : /^месяц/.test(unit) ? n * 30 : n;
}

// «за последние 3 года», «в течение трёх лет до даты подачи», «за 5 лет» → в месяцах. Не сказано — undefined.
export function windowMonthsOf(text: string): number | undefined {
  const m =
    /(?:за\s+(?:последни[а-яё]+|предшествующи[а-яё]+)|в\s+течение|за)\s+(?:(\d+)|([а-яё]+))\s*(?:\([^)]*\)\s*)?(лет|года|год|месяц[а-яё]*)/i.exec(text);
  if (!m) return undefined;
  const n = numberOf(m[1], m[2]);
  return n ? (/^месяц/i.test(m[3]) ? n : n * 12) : undefined;
}

// ———— Что просит пункт «Что подать» ————

// Правила «Что подать» (fulfillment.ts) знают закон и вид закупки; здесь — какое доказательство стоит за каждым правилом.
// null — правило ничего не говорит о доказательстве, смотрим на текст; [] — доказательства не нужно.
function submitSeeds(rule: RuleId, found: { title: string; plan: RulePlan }): Seed[] | null {
  switch (rule) {
    case "charter":
      return [{ kind: "document", label: found.title, proof: "document", anyOf: ["устав", "учред"] }];
    case "extract":
      return [{ kind: "document", label: found.title, proof: "document", anyOf: ["выпис", "егрюл", "егрип"] }];
    case "fns":
      return [{ kind: "document", label: found.title, proof: "document", anyOf: ["сервис", "фнс", "оценк", "справ"] }];
    case "authority":
      return [{ kind: "document", label: found.title, proof: "document", anyOf: ["довер", "прика", "решен", "назна", "избра", "прото"] }];
    case "bigdeal":
      return [{ kind: "document", label: found.title, proof: "document", anyOf: ["решен", "одобр", "сделк", "прото"] }];
    case "license":
      return null;
    case "conformity":
      return null;
    case "bank":
      return [{ kind: "requisite", label: found.title, proof: "statement", requisites: ["account", "bankName", "bik", "corrAccount"] }];
    case "participant":
      return [{ kind: "requisite", label: found.title, proof: "statement", requisites: ["fullName", "inn", "ogrn", "legalAddress", "head"] }];
    case "sme":
      return [{ kind: "requisite", label: "Категория субъекта МСП", proof: "statement", requisites: ["smeCategory"] }];
    case "points":
    case "additional":
      return null;
    default:
      // Декларации, ТП, цена, изображения, обеспечение, консорциум, страна происхождения: составляет приложение или подтверждает человек.
      return [];
  }
}

// ———— Потребности ————

export type NeedSource = {
  id: string;
  requirement: Requirement;
  // Правило «Что подать» и план его выполнения — только у пунктов «Что подать».
  rule?: { rule: RuleId | null; title: string; plan: RulePlan } | null;
};

export function needsOf({ id, requirement: r, rule }: NeedSource): Need[] {
  const plan = rule?.plan;
  // Площадка передаст сама, «не требуется» — доказательства не нужны.
  if (plan && (plan.mode === "platform" || plan.mode === "not_required")) return [];

  // Название критерия оценки — общее («Квалификация участников»): для него ищем вид по показателям и по тому, что приложить.
  const own = r.group === "criteria" && r.text.includes(" — ") ? r.text.split(" — ").slice(1).join(" — ") : r.text;
  const text = [own, r.quote].join(". ");
  const evidenceText = r.evidence.join(". ");
  const optional = r.mandatory === "optional" || r.mandatory === "conditional" || r.mandatory === "scored" || (plan ? !plan.mandatory : false) || r.group === "criteria";
  const scoring = r.mandatory === "scored" || r.group === "criteria" || rule?.rule === "points";

  let seeds: Seed[] | null = rule?.rule ? submitSeeds(rule.rule, { title: rule.title, plan: plan! }) : null;
  if (seeds === null) seeds = classify([text, evidenceText, r.check].join(". "));
  // Что просит Stage 3 в «чем подтвердить» — точнее общего текста: берём её слова для названия.
  const named = seeds.map((s) => {
    const own = r.evidence.find((e) => classify(e).some((c) => c.kind === s.kind));
    return own && s.kind !== "requisite" ? { ...s, label: CAPS(clip(own)) } : s;
  });

  const conditions = scoring ? [] : supplierChoices(r);
  const fresh = freshnessDaysOf([r.quote, r.text].join(". "));
  const window = windowMonthsOf([r.quote, r.text].join(". "));
  return named.map((seed, i): Need => {
    const kindStems = new Set(KIND_STEMS[seed.kind]);
    const stems = stemsOf([own, evidenceText].join(" ")).filter((s) => !kindStems.has(s));
    return {
      id: `${id}#${i}`,
      kind: seed.kind,
      label: seed.label,
      proof: seed.proof,
      stems,
      anyOf: seed.anyOf ?? [],
      measures: seed.kind === "requisite" || seed.kind === "document" ? [] : dedupe(conditions),
      ...(fresh !== undefined && seed.kind === "document" && { freshnessDays: fresh }),
      ...(window !== undefined && seed.kind === "experience" && { windowMonths: window }),
      ...(seed.requisites && { requisites: seed.requisites }),
      optional,
      scoring,
      basis: r.group === "submit" ? "Что подать" : r.group === "criteria" ? "Критерий оценки" : r.group === "who" ? "Требование к участнику" : "Требование заказчика",
      requirement: { id, group: r.group, text: r.text },
    };
  });
}

const dedupe = (list: Condition[]) => list.filter((c, i) => list.findIndex((o) => o.op === c.op && o.value === c.value && unitKey(o.unit) === unitKey(c.unit)) === i);

// Все потребности закупки по её требованиям: «Что подать» — по правилам и закону, остальное — по тексту, критерии — как «за баллы».
export function needsOfPurchase(p: Purchase, profile?: Profile): { requirement: Requirement; needs: Need[] }[] {
  const ctx = contextOf(p, profile);
  const out: { requirement: Requirement; needs: Need[] }[] = [];
  for (const group of REQ_GROUP_KEYS) {
    p.requirements[group].forEach((item, index) => {
      const requirement = requirementOf(item, group);
      const rule = group === "submit" ? ruleOf(item, ctx) : null;
      const id = `${group}-${index}`;
      out.push({ requirement, needs: needsOf({ id, requirement, rule }) });
    });
  }
  (p.criteria?.rows ?? []).forEach((row, index) => {
    const requirement = criteriaRequirement(row);
    out.push({ requirement, needs: needsOf({ id: `criteria-${index}`, requirement }) });
  });
  return out;
}
