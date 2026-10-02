// База доказательств компании: факты о ней — лицензии, сертификаты, документы, опыт, сотрудники, оборудование, финансы — и то, чем
// каждый подтверждён и до какого срока действует. Это не второй склад поверх «Образцов и реквизитов»: реквизиты остаются в профиле,
// файлы — в образцах и документах; здесь — то, что из них следует, с источником. Факт без источника — слова человека, не доказательство.
// Правило базы: значение не придумывается. Нет документа или факта — система так и говорит (evidence-match.ts), а не подставляет.
// Модуль без зависимостей от браузера и сервера: его проверяют тесты (npm test).

export type FieldDef = { key: string; label: string; example?: string; date?: boolean };

// validity — нужен ли факту срок действия: required — без него человек должен решить, действует ли документ; none — срока нет.
type KindMeta = { title: string; one: string; hint: string; fields: FieldDef[]; validity: "required" | "optional" | "none" };

export const FACT_KINDS = {
  license: {
    title: "Лицензии и допуски",
    one: "Лицензия или допуск",
    hint: "Лицензии, членство в СРО, допуски — без них нельзя заниматься делом или участвовать в закупке.",
    fields: [
      { key: "number", label: "Номер", example: "например, Л035-00115-77/00123456" },
      { key: "issuer", label: "Кем выдана" },
      { key: "issuedAt", label: "Дата выдачи", date: true },
      { key: "scope", label: "На что выдана", example: "виды работ, адреса" },
    ],
    validity: "required",
  },
  certificate: {
    title: "Сертификаты",
    one: "Сертификат или свидетельство",
    hint: "Сертификаты соответствия, ISO, свидетельства — подтверждают товар, услугу или систему менеджмента.",
    fields: [
      { key: "number", label: "Номер" },
      { key: "issuer", label: "Кем выдан" },
      { key: "issuedAt", label: "Дата выдачи", date: true },
      { key: "subject", label: "Что подтверждает", example: "товар, стандарт, например ISO 9001" },
    ],
    validity: "required",
  },
  document: {
    title: "Документы компании",
    one: "Документ компании",
    hint: "Устав, выписка из ЕГРЮЛ или ЕГРИП, доверенность, приказ о руководителе, справка ФНС. У выписок и справок важна дата: заказчики просят «не старше 30 дней».",
    fields: [
      { key: "number", label: "Номер" },
      { key: "issuedAt", label: "Дата документа", date: true },
      { key: "issuer", label: "Кто выдал" },
    ],
    validity: "optional",
  },
  experience: {
    title: "Опыт: договоры",
    one: "Исполненный договор",
    hint: "Исполненные договоры и контракты с актами о приёмке — из них считается опыт для допуска и баллов.",
    fields: [
      { key: "customer", label: "Заказчик" },
      { key: "subject", label: "Предмет договора" },
      { key: "contractNo", label: "Номер договора" },
      { key: "contractDate", label: "Дата договора", date: true },
      { key: "actNo", label: "Номер акта о приёмке" },
      { key: "actDate", label: "Дата акта", date: true },
    ],
    validity: "none",
  },
  employee: {
    title: "Сотрудники",
    one: "Сотрудник",
    hint: "Специалисты компании: кто, в какой роли, с каким образованием и стажем.",
    fields: [
      { key: "position", label: "Должность или роль" },
      { key: "education", label: "Образование" },
      { key: "basis", label: "Основание работы", example: "трудовой договор или договор ГПХ" },
    ],
    validity: "none",
  },
  qualification: {
    title: "Квалификация сотрудников",
    one: "Документ сотрудника",
    hint: "Дипломы, удостоверения, допуски: у них есть срок, и просроченный документ баллов не даст.",
    fields: [
      { key: "holder", label: "Сотрудник", example: "фамилия и инициалы" },
      { key: "number", label: "Номер" },
      { key: "level", label: "Уровень, группа", example: "например, IV группа до 1000 В" },
      { key: "issuer", label: "Кем выдан" },
      { key: "issuedAt", label: "Дата выдачи", date: true },
    ],
    validity: "required",
  },
  equipment: {
    title: "Оборудование и площадки",
    one: "Оборудование или площадка",
    hint: "То, чем компания располагает: техника, транспорт, зал. Числа — вместимость, мощность, размеры — сверяются с требованием заказчика.",
    fields: [
      { key: "model", label: "Модель" },
      { key: "ownership", label: "Чьё", example: "собственность или аренда" },
      { key: "details", label: "Описание" },
    ],
    validity: "none",
  },
  finance: {
    title: "Финансовые данные",
    one: "Финансовый показатель",
    hint: "Выручка, доход, численность, отсутствие задолженности — то, что просят в декларациях и для допуска.",
    fields: [{ key: "period", label: "За какой период", example: "например, 2025 год" }],
    validity: "none",
  },
} as const satisfies Record<string, KindMeta>;

export type FactKind = keyof typeof FACT_KINDS;
export const FACT_KIND_KEYS = Object.keys(FACT_KINDS) as [FactKind, ...FactKind[]];
export const kindMeta = (kind: FactKind): KindMeta => FACT_KINDS[kind];

// Срок действия. Даты — «ГГГГ-ММ-ДД». perpetual — бессрочно: у лицензий, которые выдают без срока, и у устава.
export type Validity = { from?: string; until?: string; perpetual?: boolean };

// Число, по которому факт сверяется с требованием заказчика: «вместимость — 200 мест», «стаж — 5 лет», «цена договора — 1 200 000 руб.».
export type Measure = { what: string; value: number; unit: string };

// Источник — откуда известен факт. document — найден в документе: docName и дословная цитата (quote пуста, если человек только
// указал документ); manual — вписан человеком без документа: это его слова, а не доказательство.
export type Source =
  | { type: "document"; docId: string; docName: string; quote: string; where?: string }
  | { type: "manual"; note?: string };

// origin — кто назвал факт: ИИ нашёл в документе или человек вписал сам. Найденное ИИ ждёт подтверждения (confirmed): само
// по себе оно «решает человек», а не доказательство.
export type Fact = {
  id: string;
  kind: FactKind;
  title: string;
  fields: Record<string, string>;
  measures: Measure[];
  validity: Validity;
  source: Source;
  origin: "ai" | "human";
  confirmed: boolean;
  createdAt: string;
  updatedAt: string;
  // Требования заказчика (их тексты), под которые человек подобрал этот факт: «это оно». Длинное требование («Зал от 150 мест в
  // пределах города, с гардеробом…») по словам с коротким названием («Актовый зал») не узнать; человек сказал «это оно» — и предмет
  // считается совпавшим. Срок, числа и документ при этом проверяются как всегда.
  answers?: string[];
};

export type FactInput = {
  kind: FactKind;
  title: string;
  fields?: Record<string, string>;
  measures?: Measure[];
  validity?: Validity;
  source?: Source;
  origin?: Fact["origin"];
  answers?: string[];
};

const clean = (fields: Record<string, string>) =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v !== ""));

// Требование для сравнения: без регистра, «ё» и знаков. По нему факт связывается с требованием и находит его снова.
export const answerKey = (text: string) => text.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, " ").trim().slice(0, 200);

// Связи с требованиями в порядке добавления, без пустых и повторов; не больше 20 — факт не должен тащить за собой всю закупку.
export function cleanAnswers(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    const text = typeof item === "string" ? item.replace(/\s+/g, " ").trim().slice(0, 300) : "";
    if (text && !out.some((o) => answerKey(o) === answerKey(text))) out.push(text);
  }
  return out.slice(0, 20);
}

// Человек сказал, что этот факт отвечает требованию.
export const answersRequirement = (fact: Pick<Fact, "answers">, requirement: string) =>
  (fact.answers ?? []).some((a) => answerKey(a) === answerKey(requirement));

// Новый факт. Вписанный человеком подтверждён сразу; найденный ИИ — нет.
export function makeFact(input: FactInput, now: Date = new Date(), id: string = crypto.randomUUID()): Fact {
  const origin = input.origin ?? "human";
  const stamp = now.toISOString();
  const answers = cleanAnswers(input.answers);
  return {
    id,
    kind: input.kind,
    title: input.title.trim(),
    fields: clean(input.fields ?? {}),
    measures: (input.measures ?? []).filter((m) => m.what.trim() && Number.isFinite(m.value)).map((m) => ({ ...m, what: m.what.trim(), unit: m.unit.trim() })),
    validity: input.validity ?? {},
    source: input.source ?? { type: "manual" },
    origin,
    confirmed: origin === "human",
    createdAt: stamp,
    updatedAt: stamp,
    ...(answers.length > 0 && { answers }),
  };
}

// ———— Даты ————
// Дни считаются по календарю, без часов и поясов: срок «до 31.12.2026» действует весь этот день.

const DAY = 86_400_000;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

// «2026-12-31» → номер дня от начала эпохи; не дата — null (30 февраля — тоже).
export function dayOf(iso: string): number | null {
  const m = ISO.exec(iso.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const check = new Date(t);
  return check.getUTCFullYear() === y && check.getUTCMonth() === mo - 1 && check.getUTCDate() === d ? Math.round(t / DAY) : null;
}

export const isoOf = (day: number): string => new Date(day * DAY).toISOString().slice(0, 10);

// Сегодня по часам компьютера, а не по Гринвичу: в 01:00 по Москве дата уже новая.
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Сколько дней от одной даты до другой: положительное — вторая позже.
export function daysBetween(fromIso: string, toIso: string): number | null {
  const a = dayOf(fromIso);
  const b = dayOf(toIso);
  return a === null || b === null ? null : b - a;
}

// «до 31 декабря» → прибавить месяцы и годы к дате («на 5 лет» от даты выдачи): месяц короче — последний день месяца.
export function addMonths(iso: string, months: number): string | null {
  const m = ISO.exec(iso.trim());
  if (!m || dayOf(iso) === null) return null;
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + months;
  const y = Math.floor(total / 12);
  const mo = (total % 12) + 1;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const d = Math.min(Number(m[3]), last);
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// perpetual — бессрочно; valid — действует; expired — срок прошёл; not_started — ещё не начался; unknown — срока нет.
export type ValidityState = "perpetual" | "valid" | "expired" | "not_started" | "unknown";

// Состояние срока на дату on. days — дней до конца срока (после конца — отрицательное; до начала — сколько дней до него).
export function validityAt(v: Validity, on: string): { state: ValidityState; days?: number } {
  if (v.perpetual) return { state: "perpetual" };
  const now = dayOf(on);
  if (now === null) return { state: "unknown" };
  const from = v.from ? dayOf(v.from) : null;
  const until = v.until ? dayOf(v.until) : null;
  if (until !== null) {
    if (now > until) return { state: "expired", days: until - now };
    if (from !== null && now < from) return { state: "not_started", days: from - now };
    return { state: "valid", days: until - now };
  }
  if (from !== null && now < from) return { state: "not_started", days: from - now };
  // Известно только начало («выдана 01.03.2024») — конца нет: действует ли ещё, по документу не сказать.
  return { state: "unknown" };
}

// Скоро кончается: действует, но осталось не больше этого числа дней.
export const EXPIRING_DAYS = 30;

const MONTHS: Record<string, number> = {
  января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6, июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12,
};

const iso = (y: number, m: number, d: number) => {
  const text = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return dayOf(text) === null ? null : text;
};

// Даты в тексте: «31.12.2026», «31.12.26», «31 декабря 2026 г.», ««31» декабря 2026», «2026-12-31». at и end — место в тексте.
const DATE = new RegExp(
  [
    String.raw`(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?![\d.]\d)`,
    String.raw`[«"“]?(\d{1,2})[»"”]?\s+(${Object.keys(MONTHS).join("|")})\s+(\d{4})`,
    String.raw`(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)`,
  ].join("|"),
  "gi"
);

export type FoundDate = { iso: string; at: number; end: number };

export function datesIn(text: string): FoundDate[] {
  const out: FoundDate[] = [];
  for (const m of text.matchAll(DATE)) {
    let value: string | null;
    if (m[1] !== undefined) {
      const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      value = iso(year, Number(m[2]), Number(m[1]));
    } else if (m[4] !== undefined) {
      value = iso(Number(m[6]), MONTHS[m[5].toLowerCase()], Number(m[4]));
    } else {
      value = iso(Number(m[7]), Number(m[8]), Number(m[9]));
    }
    if (value) out.push({ iso: value, at: m.index, end: m.index + m[0].length });
  }
  return out;
}

// Первая дата из строки, которую вписал человек или вернула модель: «31.12.2026» или «2026-12-31» → «2026-12-31».
export const parseRuDate = (text: string): string | null => datesIn(text)[0]?.iso ?? null;

// ———— Срок действия в тексте документа ————
// Искать срок в документе умеет и код: без ИИ и без денег. Найденное — подсказка человеку, а не решение: он подтверждает.

export type ValidityFound = Validity & {
  // Дословный кусок документа, где это написано.
  quote: string;
  // Конец срока посчитан («сроком на 5 лет» от даты выдачи), а не написан.
  computed?: boolean;
};

const SPAN = String.raw`[^.;\n]{0,40}?`;
const KEYS = String.raw`(?:действител[а-яё]*|действу[а-яё]*|срок[а-яё]*\s+действия|окончани[а-яё]*\s+(?:срока\s+)?действия|годн[а-яё]*)`;
const WORD_YEARS: Record<string, number> = { один: 1, одного: 1, два: 2, двух: 2, три: 3, трех: 3, трёх: 3, четыре: 4, четырех: 4, четырёх: 4, пять: 5, пяти: 5, десять: 10, десяти: 10 };

export function findValidity(text: string): ValidityFound[] {
  const found: ValidityFound[] = [];
  const seen = new Set<string>();
  const add = (v: ValidityFound) => {
    const key = `${v.from ?? ""}|${v.until ?? ""}|${v.perpetual ?? ""}|${v.computed ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      found.push(v);
    }
  };
  const dateRe = DATE.source;
  // \b в JavaScript не знает кириллицу: границы слов — через соседние буквы.
  const word = (w: string) => `(?<![а-яё])${w}(?![а-яё])`;

  // «срок действия с 05.03.2023 по 04.03.2026»
  for (const m of text.matchAll(new RegExp(`${KEYS}${SPAN}${word("с")}\\s+(${dateRe})\\s+${word("по")}\\s+(${dateRe})`, "gi"))) {
    const dates = datesIn(m[0]);
    if (dates.length >= 2) add({ from: dates[0].iso, until: dates[1].iso, quote: m[0].trim() });
  }
  // «действительна до 31.12.2026», «срок действия: по 12.05.2027»
  for (const m of text.matchAll(new RegExp(`${KEYS}${SPAN}(?:${word("до")}|${word("по")}|:|—|-)\\s*(?:включительно\\s+)?(${dateRe})`, "gi"))) {
    const dates = datesIn(m[0]);
    const last = dates.at(-1);
    if (last && !new RegExp(`${word("с")}\\s+\\d`, "i").test(m[0])) add({ until: last.iso, quote: m[0].trim() });
  }
  // «бессрочно», «без ограничения срока действия»
  for (const m of text.matchAll(/(?<![а-яё])(?:бессрочн[а-яё]*|без\s+ограничени[а-яё]*\s+срока(?:\s+действия)?)/gi)) {
    add({ perpetual: true, quote: m[0].trim() });
  }
  // «сроком на 5 лет» от даты выдачи — конец срока считается
  for (const m of text.matchAll(/(?:сроком|на\s+срок)\s+(?:на\s+)?(\d+|[а-яё]+)\s+(лет|года|год|месяц[а-яё]*)/gi)) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORD_YEARS[m[1].toLowerCase()];
    if (!n) continue;
    const issued = datesIn(text.slice(Math.max(0, (m.index ?? 0) - 160), (m.index ?? 0) + 160))[0];
    if (!issued) continue;
    const until = addMonths(issued.iso, /^месяц/i.test(m[2]) ? n : n * 12);
    if (until) add({ from: issued.iso, until, quote: m[0].trim(), computed: true });
  }
  return found;
}

// ———— Что показать про срок ————

// Словами: «действует до 31.12.2026», «истекает через 12 дн.», «просрочено 3 дн. назад», «бессрочно», «срок не указан».
export function validityText(v: Validity, on: string): string {
  const at = validityAt(v, on);
  const dm = (iso: string) => iso.split("-").reverse().join(".");
  const plural = (n: number) => (n % 100 > 10 && n % 100 < 20 ? "дней" : n % 10 === 1 ? "день" : n % 10 >= 2 && n % 10 <= 4 ? "дня" : "дней");
  switch (at.state) {
    case "perpetual":
      return "бессрочно";
    case "valid":
      return at.days! <= EXPIRING_DAYS ? `истекает через ${at.days} ${plural(at.days!)} (${dm(v.until!)})` : `действует до ${dm(v.until!)}`;
    case "expired":
      return `просрочено: действовало до ${dm(v.until!)}`;
    case "not_started":
      return `начнёт действовать ${dm(v.from!)}`;
    case "unknown":
      return "срок не указан";
  }
}

// Весь текст факта для поиска: название, поля и числа — по ним требование находит подходящий факт.
export const factText = (f: Pick<Fact, "title" | "fields" | "measures">): string =>
  [f.title, ...Object.values(f.fields), ...f.measures.map((m) => m.what)].join(" ");

// ———— Слова для поиска ————
// Требование и факт называют одно и то же разными формами слова: «образовательную» и «образовательной». Поэтому слова
// сравниваются по началу — первым пяти буквам. Предлоги и слова, которые есть в любом требовании («копия», «наличие»), не в счёт.

// Общие слова — по началу слова, чтобы не перечислять все формы: «подтверждающая», «подтверждающих», «подтверждение».
const STOP_STEMS = new Set([
  "для", "при", "над", "под", "без", "или", "что", "как", "его", "ее", "их", "это", "эти", "тот", "так", "все", "всех", "быть", "был",
  "она", "они", "оно", "про", "после", "перед", "между", "через", "также", "либо", "если", "когда", "котор",
  "копия", "копии", "копию", "копий", "докум", "налич", "участ", "закуп", "заказ", "предо", "прило", "подтв", "треб", "соотв",
  "дейст", "осуще", "указа", "устан", "настоя", "выпол", "оказа", "являю", "право", "права", "прав", "деяте", "работ", "услуг",
  "должн", "заявк", "форма", "порядк", "желан", "вправе", "рекоме", "предст", "необх", "обяза", "возмож", "иного", "иные", "иных",
]);

export const wordsOf = (text: string): string[] => text.toLowerCase().replace(/ё/g, "е").split(/[^a-zа-я0-9]+/).filter(Boolean);

const stem = (word: string) => (word.length > 5 ? word.slice(0, 5) : word);

// Начала слов требования, по которым ищется факт. Слова короче трёх знаков и общие слова отбрасываются.
export const stemsOf = (text: string): string[] => [
  ...new Set(wordsOf(text).filter((w) => (w.length >= 3 || /^\d+$/.test(w)) && !/^\d{1,2}$/.test(w) && !STOP_STEMS.has(stem(w))).map(stem)),
];

// Слова факта, по которым его ищут: готовятся один раз, потом сверяются со многими требованиями.
export const textWords = (text: string): string[] => [...new Set(wordsOf(text))];

// Сколько начал слов из stems нашлось среди слов текста: от 0 до 1. Нет слов для сверки — 1 («искать нечего, подходит любой»).
export function stemShare(stems: string[], words: string[]): number {
  if (stems.length === 0) return 1;
  const hit = stems.filter((s) => words.some((w) => w.startsWith(s))).length;
  return hit / stems.length;
}
