// Персональные данные — перед отправкой в ИИ. Claude работает у Anthropic в США, и всё, что уходит к нему,
// по 152-ФЗ — трансграничная передача. Поэтому ФИО, телефоны, почта, паспорт, СНИЛС, ИНН и ОГРНИП физлица,
// счета физлиц и ИП, даты рождения и адреса регистрации заменяются метками: ⟦ФИО-1⟧, ⟦ТЕЛЕФОН-2⟧.
// Значения остаются у нас на время запроса, а в ответе модели метки меняются обратно — пользователь
// видит обычный текст. Находится не всё: имя без отчества и инициалов, адрес без слов «адрес регистрации»
// уходят как есть. Передачу это уменьшает, но не отменяет.
//
// Одно значение — одна метка, во всех документах запроса. Документы маскируются первыми и всегда
// одинаково: начало запроса не меняется, и документы по-прежнему читаются из кеша.

export type PdKind = "ФИО" | "ТЕЛЕФОН" | "ПОЧТА" | "ПАСПОРТ" | "СНИЛС" | "ИНН" | "ОГРНИП" | "СЧЕТ" | "ДАТА-РОЖДЕНИЯ" | "АДРЕС";

// Выключить — PD_MASK=off: например, чтобы сравнить ответы с маскировкой и без.
export const PD_MASK_ON = process.env.PD_MASK !== "off";

export const PD_MASK_NOTE = `Персональные данные в документах и сообщениях скрыты метками вида ⟦ВИД-N⟧: ВИД — ФИО, ТЕЛЕФОН, ПОЧТА, ПАСПОРТ, СНИЛС, ИНН (физлица или ИП), ОГРНИП, СЧЕТ, ДАТА-РОЖДЕНИЯ или АДРЕС, N — номер значения. Пользователь видит на месте метки настоящее значение, поэтому метка — не пропуск и не ошибка. Одно значение везде скрыто одной меткой. У ФИО номер — это человек, а после косой черты — форма: без черты — полностью в именительном падеже; /р — в родительном (у мужчин он же винительный), /в — в винительном, /д — в дательном (у женщин он же предложный), /т — в творительном, /п — в предложном; /ФИ — фамилия и инициалы, /ИФ — инициалы и фамилия, /ИО — имя и отчество. Если значение нужно в ответе, пиши метку точно как в тексте — пользователь увидит значение. Нужной формы ФИО нет — бери ту, что есть. Не угадывай скрытые значения и не пиши меток, которых нет в тексте.`;

// person — один человек в разных формах: основа фамилии и инициалы; gender — по отчеству, если оно есть.
type Found = { start: number; end: number; kind: PdKind; person?: string; form?: string; gender?: "м" | "ж" };

const collapse = (s: string) => s.replace(/[\s ]+/g, " ").trim();
const digitsOf = (s: string) => s.replace(/\D/g, "");

// ---------- номера с контрольными цифрами ----------

function innOk(d: string): boolean {
  const n = [...d].map(Number);
  const check = (weights: number[]) => (weights.reduce((sum, w, i) => sum + w * n[i], 0) % 11) % 10;
  return check([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === n[10] && check([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === n[11];
}

function snilsOk(d: string): boolean {
  if (Number(d.slice(0, 9)) <= 1001998) return true;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * (9 - i);
  const check = sum < 100 ? sum : sum === 100 || sum === 101 ? 0 : (sum % 101) % 100;
  return check === Number(d.slice(9));
}

const ogrnipOk = (d: string) => (Number(d.slice(0, 14)) % 13) % 10 === Number(d[14]);

// ---------- образцы ----------

const SEP = "[ \\u00a0\\t\\-‐–()]";
const PHONE_LABEL = /(?:тел|факс|моб|сот|phone)[\p{L}.]*[\s:№]*$/iu;

type Rule = { kind: PdKind; re: RegExp; group?: number; ok?: (value: string, text: string, at: number) => boolean };

const RULES: Rule[] = [
  { kind: "ПОЧТА", re: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu },
  {
    // +7 и 8 с десятью цифрами. Восьмёрка без единого разделителя похожа на ОКТМО или другой код —
    // такую считаем телефоном, только если перед ней написано «тел.».
    kind: "ТЕЛЕФОН",
    re: new RegExp(`(?<![\\p{L}\\p{N}+])(?:\\+7|8)(?:${SEP}{0,3}\\d){10}(?!\\d)`, "gu"),
    ok: (value, text, at) => {
      const rest = value.startsWith("+7") ? value.slice(2) : value.slice(1);
      if (!"34789".includes(digitsOf(rest)[0])) return false;
      return value.startsWith("+7") || /\D/.test(rest) || PHONE_LABEL.test(text.slice(Math.max(0, at - 20), at));
    },
  },
  { kind: "ТЕЛЕФОН", re: new RegExp(`(?<![\\p{L}\\p{N}+])\\+(?!7)\\d{1,3}(?:${SEP}{0,3}\\d){6,12}(?!\\d)`, "gu") },
  {
    kind: "ТЕЛЕФОН",
    re: /(?<![\p{L}\p{N}])\(\d{3,5}\)(?:[  \-‐–]{0,2}\d){5,7}(?!\d)/gu,
    ok: (value) => digitsOf(value).length === 10 && "3489".includes(digitsOf(value)[0]),
  },
  {
    // Городской номер без кода — только рядом со словом «тел.»: «тел. 12-34-56».
    kind: "ТЕЛЕФОН",
    re: /(?<!\p{L})(?:тел(?:ефон\p{L}*)?|факс|моб(?:ильн\p{L}*)?|сот(?:ов\p{L}*)?)\.?[  ]*(?:[:№][  ]*)?(\+?[\d(][\d  \-‐–()]{3,22}\d)(?!\d)/giu,
    group: 1,
    ok: (value) => digitsOf(value).length >= 5,
  },
  {
    kind: "ПАСПОРТ",
    re: /(?:паспорт\p{L}*|сери[яи])[^\d\n]{0,40}?(\d{2}[  ]?\d{2}[^\d\n]{0,12}?\d{6})(?!\d)/giu,
    group: 1,
  },
  { kind: "ПАСПОРТ", re: /код(?:а|ом)?[  ]+подразделения[^\d\n]{0,5}(\d{3}-\d{3})(?!\d)/giu, group: 1 },
  {
    kind: "СНИЛС",
    re: /(?<!\d)\d{3}[- \u00a0]\d{3}[- \u00a0]\d{3}[- \u00a0]\d{2}(?!\d)/gu,
    ok: (value, text, at) => snilsOk(digitsOf(value)) || /СНИЛС[^\d\n]{0,12}$/u.test(text.slice(Math.max(0, at - 16), at)),
  },
  { kind: "СНИЛС", re: /СНИЛС[^\d\n]{0,12}(\d{11})(?!\d)/gu, group: 1 },
  { kind: "ИНН", re: /(?<!\d)\d{12}(?!\d)/gu, ok: innOk },
  { kind: "ИНН", re: /ИНН[^\d\n]{0,12}(\d{12})(?!\d)/gu, group: 1 },
  { kind: "ОГРНИП", re: /(?<!\d)3\d{14}(?!\d)/gu, ok: ogrnipOk },
  { kind: "ОГРНИП", re: /ОГРНИП[^\d\n]{0,12}(\d{15})(?!\d)/gu, group: 1 },
  // Счета физлиц (408 17, 408 20, вклады 423, 426) и ИП (408 02). Счета организаций — не персональные данные.
  { kind: "СЧЕТ", re: /(?<!\d)(?:40802|40817|40820|423\d\d|426\d\d)\d{15}(?!\d)/gu },
  {
    kind: "ДАТА-РОЖДЕНИЯ",
    re: /(?:дат[аы][  ]+рождения|д\.[  ]?р\.|родил(?:ся|ась))[\s:—–-]*(\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{1,2}[  ]+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)[  ]+\d{4})/giu,
    group: 1,
  },
  { kind: "ДАТА-РОЖДЕНИЯ", re: /(?<!\d)(\d{1,2}[./]\d{1,2}[./]\d{4}|\d{4})[  ]*(?:г\.[  ]?р\.|года[  ]+рождения)/giu, group: 1 },
];

// Адрес — только после слов «адрес регистрации», «место жительства» и похожих и только если похож на адрес:
// в требовании «укажите адрес регистрации, паспортные данные» прятать нечего.
const ADDRESS = /(?:адрес\p{L}{0,2}[  ]+(?:регистрации|места[  ]+жительства|проживания|прописки)|мест[оа][  ]+жительства|зарегистрирован\p{L}*[  ]+по[  ]+адресу|проживающ\p{L}*[  ]+по[  ]+адресу)[  ):—–-]*([^\n;]{5,200})/giu;
const ADDRESS_LIKE = /\d{6}|(?:^|[\s,(])(?:г|ул|д|обл|пр-т|просп|пер|ш|кв|пос|р-н|мкр|корп|стр)\.[  ]?\S/iu;

function findAddresses(text: string): Found[] {
  const out: Found[] = [];
  for (const m of text.matchAll(ADDRESS)) {
    const value = m[1].replace(/[\s.,]+$/u, "");
    if (!ADDRESS_LIKE.test(value)) continue;
    const start = m.index + m[0].length - m[1].length;
    out.push({ start, end: start + value.length, kind: "АДРЕС" });
  }
  return out;
}

function findByRules(text: string): Found[] {
  const out: Found[] = [];
  for (const rule of RULES) {
    for (const m of text.matchAll(rule.re)) {
      const value = rule.group ? m[rule.group] : m[0];
      const start = rule.group ? m.index + m[0].lastIndexOf(value) : m.index;
      if (rule.ok && !rule.ok(value, text, start)) continue;
      out.push({ start, end: start + value.length, kind: rule.kind });
    }
  }
  return out;
}

// ---------- ФИО ----------

// Слово с большой буквы или целиком заглавными: «Иванов», «ИВАНОВ», «Петров-Водкин».
const NAME_WORD = /(?<![\p{L}\p{N}-])(?:[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?|[А-ЯЁ]{2,}(?:-[А-ЯЁ]{2,})?)(?![\p{L}\p{N}])/gu;

// Слова с большой буквы, которые в документах стоят рядом с ФИО, но ими не бывают.
const NOT_NAME =
  /^(?:генеральн|директор|руковод|начальник|заместител|главн|председател|президент|управляющ|исполнительн|заведующ|ректор|министр|специалист|менеджер|инженер|бухгалтер|юрист|представител|уполномоченн|ответственн|контрактн|заказчик|поставщик|подрядчик|исполнител|участник|покупател|продав|приложени|российск|федерац|москв(?:а|ы|е|у|ой)$|санкт|петербург|област|республик|город(?:а|е|у|ом|ской|ского)?$|район(?:а|е|у|ом|ный|ного)?$|обществ|акционерн|государствен|муниципальн|бюджетн|казенн|казённ|автономн|учреждени|предприяти|компани|контракт|договор|извещени|документац|закупк|техническ|спецификац|стать|пункт|раздел|форм[аеуы]?$|таблиц|итог|всего|дат[аеуы]$|подпис|печат|место|уважаем|настоящ|декларац|анкет|заявк|сведени|наименовани|фамили|имя$|отчеств|согласи|приказ|постановлени|распоряжени|банк|адрес|почт|телефон|факс|сайт|гражданин|паспорт|выдан|серия|номер|код|индивидуальн|предпринимател|ооо$|оао$|зао$|пао$|ао$|ип$|рф$|тз$|фз$|мп$|снилс$|инн$|огрн|кпп$|бик$)/;

const MALE_PATRONYMIC = /^[а-яё]{2,}ич(а|у|ем|е)?$/;
const FEMALE_PATRONYMIC = /^[а-яё]{2,}[вч]н(а|ы|е|у|ой)$/;
const MALE_CASE: Record<string, string> = { "": "", а: "р", у: "д", ем: "т", е: "п" };
const FEMALE_CASE: Record<string, string> = { а: "", ы: "р", е: "д", у: "в", ой: "т" };

const lower = (w: string) => w.toLowerCase().replace(/ё/g, "е");

// Падеж по отчеству: «Ивановича» — родительный, «Сергеевной» — творительный. Не отчество — null.
function patronymicCase(word: string): string | null {
  const w = lower(word);
  const male = w.match(MALE_PATRONYMIC);
  if (male) return MALE_CASE[male[1] ?? ""];
  const female = w.match(FEMALE_PATRONYMIC);
  return female ? FEMALE_CASE[female[1]] : null;
}

const nameLike = (w: string) => !NOT_NAME.test(lower(w)) && patronymicCase(w) === null;

// Основа фамилии — чтобы «Иванов», «Иванова» и «Иванову И. И.» узнавались как один человек.
function surnameStem(surname: string): string {
  const w = lower(surname);
  const sky = w.match(/^(.+?[сц]к)(?:ий|ого|ому|им|ом|ая|ой|ую)$/);
  if (sky) return sky[1];
  const ov = w.match(/^(.+?(?:ов|ев|ин|ын))(?:а|у|ым|ом|е|ой|ы)?$/);
  if (ov) return ov[1];
  return w.replace(/(?:ого|его|ому|ему|ым|им|ой|ей|ом|ем|а|я|у|ю|е|ы|и|ь)$/, "") || w;
}

type Word = { start: number; end: number; text: string };

// Между словами одного ФИО — пробелы и не больше одного переноса строки: в таблицах ФИО переносится.
const next = (text: string, a: Word, b: Word | undefined) =>
  !!b && b.start - a.end <= 4 && /^[ \t ]*\n?[ \t ]*$/.test(text.slice(a.end, b.start)) && b.start > a.end;

function findFullNames(text: string): Found[] {
  const words: Word[] = [...text.matchAll(NAME_WORD)].map((m) => ({ start: m.index, end: m.index + m[0].length, text: m[0] }));
  const used = new Set<number>();
  const out: Found[] = [];
  for (let i = 1; i < words.length; i++) {
    const grammar = patronymicCase(words[i].text);
    if (grammar === null || used.has(i)) continue;
    const first = i - 1;
    if (used.has(first) || !next(text, words[first], words[i]) || !nameLike(words[first].text)) continue;
    let surname = -1;
    if (first > 0 && !used.has(first - 1) && next(text, words[first - 1], words[first]) && nameLike(words[first - 1].text)) {
      surname = first - 1;
    } else if (
      i + 1 < words.length &&
      next(text, words[i], words[i + 1]) &&
      nameLike(words[i + 1].text) &&
      // «Иван Иванович Пётр Петрович» — «Пётр» не фамилия, а имя следующего человека.
      !(i + 2 < words.length && next(text, words[i + 1], words[i + 2]) && patronymicCase(words[i + 2].text) !== null)
    ) {
      surname = i + 1;
    }
    const from = surname >= 0 ? Math.min(surname, first) : first;
    const to = surname > i ? surname : i;
    for (let k = from; k <= to; k++) used.add(k);
    const initials = lower(words[first].text[0] + words[i].text[0]);
    const gender = MALE_PATRONYMIC.test(lower(words[i].text)) ? "м" : "ж";
    out.push({
      start: words[from].start,
      end: words[to].end,
      kind: "ФИО",
      person: surname >= 0 ? `${surnameStem(words[surname].text)}|${initials}` : `ио|${lower(words[first].text).slice(0, 3)}|${initials}`,
      form: surname >= 0 ? grammar : grammar ? `ИО-${grammar}` : "ИО",
      gender,
    });
  }
  return out;
}

const WORD = "(?:[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?|[А-ЯЁ]{2,}(?:-[А-ЯЁ]{2,})?)";
// «Иванов И. И.»; три инициала подряд — это «Ф.И.О.», а не человек.
const SURNAME_INITIALS = new RegExp(
  `(?<![\\p{L}\\p{N}-])(${WORD})[ \\u00a0]{1,2}([А-ЯЁ])\\.[ \\u00a0]?([А-ЯЁ])\\.(?![ \\u00a0]?[А-ЯЁ]\\.)`,
  "gu"
);
// «И. И. Иванов»; «И.О. Директора» — исполняющий обязанности, не человек: должности в NOT_NAME.
const INITIALS_SURNAME = new RegExp(
  `(?<![\\p{L}\\p{N}])(?<!\\p{L}\\.[ \\u00a0]?)([А-ЯЁ])\\.[ \\u00a0]?([А-ЯЁ])\\.[ \\u00a0]?(${WORD})(?![\\p{L}\\p{N}])`,
  "gu"
);

function findInitials(text: string): Found[] {
  const out: Found[] = [];
  for (const m of text.matchAll(SURNAME_INITIALS)) {
    if (!nameLike(m[1])) continue;
    out.push({ start: m.index, end: m.index + m[0].length, kind: "ФИО", person: `${surnameStem(m[1])}|${lower(m[2] + m[3])}`, form: "ФИ" });
  }
  for (const m of text.matchAll(INITIALS_SURNAME)) {
    if (!nameLike(m[3])) continue;
    out.push({ start: m.index, end: m.index + m[0].length, kind: "ФИО", person: `${surnameStem(m[3])}|${lower(m[1] + m[2])}`, form: "ИФ" });
  }
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Пересечения: берём найденное раньше, из начатых в одном месте — более длинное.
// Адрес с телефоном внутри скрывается одной меткой.
function pick(found: Found[]): Found[] {
  const out: Found[] = [];
  let at = 0;
  for (const f of [...found].sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (f.start < at) continue;
    out.push(f);
    at = f.end;
  }
  return out;
}

// ---------- маскировка ----------

export class PdMasker {
  // «ФИО:Иванов Иван Иванович» → «⟦ФИО-1⟧» и обратно. Значения — без лишних пробелов и переносов.
  private readonly tokens = new Map<string, string>();
  private readonly values = new Map<string, string>();
  private readonly persons = new Map<string, { n: number; gender?: "м" | "ж" }>();
  private readonly counts = new Map<PdKind, number>();
  private readonly on: boolean;

  constructor(on = PD_MASK_ON) {
    this.on = on;
  }

  get size() {
    return this.values.size;
  }

  mask(text: string): string {
    if (!this.on || !text) return text;
    // Сначала метки для всего найденного образцами — по порядку в тексте, потом поиск уже известных
    // значений: так почтовый адрес ИП ниже адреса регистрации скрывается и в том же документе.
    const found = pick([...findByRules(text), ...findAddresses(text), ...findFullNames(text), ...findInitials(text)]);
    for (const f of found) this.token(f, text.slice(f.start, f.end));
    let out = "";
    let at = 0;
    for (const f of pick([...found, ...this.known(text)])) {
      out += text.slice(at, f.start) + this.token(f, text.slice(f.start, f.end));
      at = f.end;
    }
    return out + text.slice(at);
  }

  // Уже скрытые значения ищем и там, где образцы их не находят: например, адрес регистрации ИП,
  // повторённый как почтовый адрес без пометки. Короткие значения — нет: слишком легко ошибиться.
  private known(text: string): Found[] {
    const out: Found[] = [];
    for (const [key, token] of this.tokens) {
      const kind = key.slice(0, key.indexOf(":")) as PdKind;
      const value = this.values.get(token)!;
      if (value.length < 8) continue;
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${value.split(" ").map(escape).join("[\\s\\u00a0]+")}(?![\\p{L}\\p{N}])`, "gu");
      for (const m of text.matchAll(re)) out.push({ start: m.index, end: m.index + m[0].length, kind });
    }
    return out;
  }

  private token(f: Found, surface: string): string {
    const value = collapse(surface);
    const key = `${f.kind}:${value}`;
    const known = this.tokens.get(key);
    if (known) return known;
    let token: string;
    if (f.kind === "ФИО" && f.person) {
      const label = f.form ? `/${f.form}` : "";
      const person = this.persons.get(f.person);
      // Один номер — если пол по отчеству не спорит и такой формы у человека ещё нет: у метки одно значение.
      // «Иванов Алексей Сергеевич» и «Ивановой Анны Сергеевны» — разные люди, хоть основа и инициалы те же.
      let n: number;
      if (person && (!person.gender || !f.gender || person.gender === f.gender) && !this.values.has(`⟦ФИО-${person.n}${label}⟧`)) {
        n = person.n;
        person.gender ??= f.gender;
      } else {
        n = this.bump("ФИО");
        if (!person) this.persons.set(f.person, { n, gender: f.gender });
      }
      token = `⟦ФИО-${n}${label}⟧`;
    } else {
      token = `⟦${f.kind}-${this.bump(f.kind)}⟧`;
    }
    this.tokens.set(key, token);
    this.values.set(token, value);
    return token;
  }

  private bump(kind: PdKind): number {
    const n = (this.counts.get(kind) ?? 0) + 1;
    this.counts.set(kind, n);
    return n;
  }

  private value(token: string): string {
    const exact = this.values.get(token);
    if (exact !== undefined) return exact;
    // Модель взяла форму ФИО, которой в тексте нет, — даём основную форму того же человека.
    const person = token.match(/^⟦(ФИО-\d+)\//)?.[1];
    if (person) {
      const base = this.values.get(`⟦${person}⟧`);
      if (base !== undefined) return base;
      for (const [known, value] of this.values) if (known.startsWith(`⟦${person}/`)) return value;
    }
    return "[данные скрыты]";
  }

  unmask(text: string): string {
    if (!this.on || !text.includes("⟦")) return text;
    return text.replace(/⟦([^⟦⟧\n]{1,40})⟧/g, (_, inner: string) => this.value(`⟦${inner.replace(/\s+/g, "").replace(/Ё/g, "Е")}⟧`));
  }

  // Ответ в формате JSON: метки меняются во всех строках.
  unmaskDeep<T>(value: T): T {
    if (typeof value === "string") return this.unmask(value) as T;
    if (Array.isArray(value)) return value.map((v) => this.unmaskDeep(v)) as T;
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.unmaskDeep(v)])) as T;
    }
    return value;
  }

  // Ответ по кусочкам: метка может прийти разрезанной — «⟦ФИ» в одном куске, «О-1⟧» в другом.
  // Хвост с незакрытой меткой ждёт следующего куска.
  stream() {
    let pending = "";
    return {
      push: (delta: string): string => {
        pending += delta;
        const open = pending.lastIndexOf("⟦");
        const cut = open >= 0 && !pending.includes("⟧", open) && pending.length - open <= 48 ? open : pending.length;
        const ready = pending.slice(0, cut);
        pending = pending.slice(cut);
        return this.unmask(ready);
      },
      flush: (): string => {
        const rest = this.unmask(pending);
        pending = "";
        return rest;
      },
    };
  }
}
