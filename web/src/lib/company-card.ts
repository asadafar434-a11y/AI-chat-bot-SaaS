import { filledCount, PROFILE_KEYS, type Profile } from "@/lib/profile";

// Карточка компании рядом с реквизитами: опыт и финансы, специализация, лицензии и сертификаты. Всё это слова самого участника
// («заявлено вами»): доказательством становится документ в базе доказательств (evidence-base.ts). От заполнения зависит «сила профиля» — число на
// экране «Профиль компании»; это полнота данных, а не оценка шансов на победу.

export const EXPERIENCE_FIELDS = [
  { key: "years", label: "Лет опыта" },
  { key: "contractsWon", label: "Выиграно контрактов" },
  { key: "employees", label: "Сотрудников" },
  { key: "turnover", label: "Годовой оборот, ₽" },
  { key: "maxContract", label: "Максимальный контракт, ₽" },
  { key: "foundedYear", label: "Год основания" },
] as const;

export type ExperienceKey = (typeof EXPERIENCE_FIELDS)[number]["key"];

export type ChipSet = "industries" | "licenses" | "permits" | "certificates";

export type CompanyCard = {
  experience: Record<ExperienceKey, string>;
  industries: string[];
  licenses: string[];
  permits: string[];
  certificates: string[];
  // Свои пункты по группам плашек — и выбранные, и снятые: снятый пункт остаётся на экране, пока его не удалят крестиком.
  custom: Record<ChipSet, string[]>;
  // «Лицензий нет» / «Сертификатов нет»: компания без них тоже может довести профиль до конца.
  noLicenses: boolean;
  noCertificates: boolean;
};

export const EMPTY_CARD: CompanyCard = {
  experience: { years: "", contractsWon: "", employees: "", turnover: "", maxContract: "", foundedYear: "" },
  industries: [],
  licenses: [],
  permits: [],
  certificates: [],
  custom: { industries: [], licenses: [], permits: [], certificates: [] },
  noLicenses: false,
  noCertificates: false,
};

export const INDUSTRY_OPTIONS = [
  "Строительство и ремонт",
  "ИТ и телекоммуникации",
  "Поставка товаров",
  "Медицина и фармацевтика",
  "Транспорт и логистика",
  "Образование",
  "Энергетика",
  "ЖКХ и благоустройство",
  "Безопасность",
  "Консалтинг и услуги",
  "Промышленность",
  "Сельское хозяйство",
  "Культура и спорт",
  "Экология",
  "Питание и общепит",
  "Мебель и оборудование",
  "Топливо и энергоресурсы",
];

export const LICENSE_OPTIONS = [
  "СРО на строительные работы",
  "СРО на проектные работы",
  "СРО на инженерные изыскания",
  "Медицинская лицензия",
  "Образовательная лицензия",
  "Лицензия МЧС (пожарная безопасность)",
  "Лицензия ФСБ (гостайна)",
  "Лицензия Росприроднадзора",
  "Лицензия на фармацевтическую деятельность",
  "Лицензия на перевозку пассажиров",
  "Лицензия на управление МКД",
  "Лицензия на обращение с отходами",
];

export const PERMIT_OPTIONS = [
  "Работы на высоте",
  "Огневые работы",
  "Электробезопасность (группа допуска)",
  "Земляные работы",
  "Грузоподъёмные работы",
  "Газоопасные работы",
  "Работы в замкнутых пространствах",
];

export const CERTIFICATE_OPTIONS = [
  "ISO 9001 (менеджмент качества)",
  "ISO 14001 (экологический менеджмент)",
  "ISO 45001 (охрана труда)",
  "ГОСТ Р ИСО 9001",
  "ГОСТ Р",
  "ИНТЕРГАЗСЕРТ",
  "СТО Газпром",
  "Сертификат ТР ТС",
  "Декларация ТР ТС",
  "OHSAS 18001",
];

const digits = (x: unknown, max = 15) => (typeof x === "string" || typeof x === "number" ? String(x).replace(/\D/g, "").slice(0, max) : "");
const list = (x: unknown): string[] =>
  Array.isArray(x)
    ? [...new Set(x.filter((s): s is string => typeof s === "string").map((s) => s.trim().slice(0, 120)).filter(Boolean))].slice(0, 60)
    : [];

// Из браузера приходит что угодно — берём только то, что похоже на карточку; недостающее — по умолчанию.
export function readCard(raw: unknown): CompanyCard {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const e = (typeof r.experience === "object" && r.experience !== null ? r.experience : {}) as Record<string, unknown>;
  const c = (typeof r.custom === "object" && r.custom !== null ? r.custom : {}) as Record<string, unknown>;
  return {
    experience: Object.fromEntries(EXPERIENCE_FIELDS.map((f) => [f.key, digits(e[f.key])])) as Record<ExperienceKey, string>,
    industries: list(r.industries),
    licenses: list(r.licenses),
    permits: list(r.permits),
    certificates: list(r.certificates),
    custom: {
      industries: list(c.industries),
      licenses: list(c.licenses),
      permits: list(c.permits),
      certificates: list(c.certificates),
    },
    noLicenses: r.noLicenses === true,
    noCertificates: r.noCertificates === true,
  };
}

export const toggleItem = (items: string[], item: string): string[] => (items.includes(item) ? items.filter((i) => i !== item) : [...items, item]);

// Свой пункт: без повтора (без учёта регистра); пустое не добавляется.
export function addItem(items: string[], text: string): string[] {
  const t = text.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!t || items.some((i) => i.toLowerCase() === t.toLowerCase())) return items;
  return [...items, t];
}

// Свой пункт группы: добавить (он сразу выбран), снять выбор (пункт остаётся), удалить совсем (из выбора и из своих).
export function addOwn(card: CompanyCard, group: ChipSet, text: string): CompanyCard {
  const value = addItem(card[group], text);
  if (value === card[group]) return card;
  const added = value[value.length - 1];
  return { ...card, [group]: value, custom: { ...card.custom, [group]: addItem(card.custom[group], added) } };
}

export function removeOwn(card: CompanyCard, group: ChipSet, item: string): CompanyCard {
  return { ...card, [group]: card[group].filter((i) => i !== item), custom: { ...card.custom, [group]: card.custom[group].filter((i) => i !== item) } };
}

// Свои пункты группы для показа: сохранённые плюс выбранные, которых нет среди готовых.
export const ownItems = (card: CompanyCard, group: ChipSet, options: string[]): string[] =>
  [...card.custom[group], ...card[group]].filter((v, i, all) => !options.includes(v) && all.indexOf(v) === i);

export const experienceFilled = (card: CompanyCard) => EXPERIENCE_FIELDS.filter((f) => card.experience[f.key] !== "").length;

export type StrengthKey = "requisites" | "experience" | "industries" | "licenses" | "certificates";
export type StrengthPart = { key: StrengthKey; label: string; weight: number; share: number; detail: string; done: boolean };
export type Strength = { percent: number; parts: StrengthPart[] };

// Доли: реквизиты — 40 (по числу заполненных полей), опыт и финансы — 20 (по шести полям), остальные три — всё или ничего:
// специализация 15, лицензии и допуски 15, сертификаты 10. Явное «нет» тоже считается ответом.
export function profileStrength(profile: Profile, card: CompanyCard): Strength {
  const req = filledCount(profile);
  const exp = experienceFilled(card);
  const licenseCount = card.licenses.length + card.permits.length;
  const licensesDone = licenseCount > 0 || card.noLicenses;
  const certsDone = card.certificates.length > 0 || card.noCertificates;
  const parts: StrengthPart[] = [
    { key: "requisites", label: "Реквизиты", weight: 40, share: req / PROFILE_KEYS.length, detail: `${req} из ${PROFILE_KEYS.length} полей`, done: req === PROFILE_KEYS.length },
    { key: "experience", label: "Опыт и финансы", weight: 20, share: exp / EXPERIENCE_FIELDS.length, detail: exp === 0 ? "не заполнено" : `${exp} из ${EXPERIENCE_FIELDS.length} полей`, done: exp === EXPERIENCE_FIELDS.length },
    { key: "industries", label: "Специализация", weight: 15, share: card.industries.length > 0 ? 1 : 0, detail: card.industries.length ? `выбрано ${card.industries.length}` : "не выбрано", done: card.industries.length > 0 },
    { key: "licenses", label: "Лицензии", weight: 15, share: licensesDone ? 1 : 0, detail: licenseCount ? `выбрано ${licenseCount}` : card.noLicenses ? "нет" : "не выбрано", done: licensesDone },
    { key: "certificates", label: "Сертификаты", weight: 10, share: certsDone ? 1 : 0, detail: card.certificates.length ? `выбрано ${card.certificates.length}` : card.noCertificates ? "нет" : "не выбрано", done: certsDone },
  ];
  const percent = Math.round(parts.reduce((sum, p) => sum + p.weight * p.share, 0));
  return { percent, parts };
}

export const rublesText = (digitsOnly: string): string => (digitsOnly ? `${Number(digitsOnly).toLocaleString("ru-RU").replace(/ /g, " ")} ₽` : "");
