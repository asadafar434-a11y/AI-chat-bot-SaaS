// Числовые условия заказчика: «не менее 150 мест», «не более 5 кг», «от 3 до 5 лет», «не менее 3×2 м», «в течение 5 рабочих дней».
// Зачем. Граница заказчика должна оставаться его границей: ИИ не знает, какое значение предложит поставщик, и не должен
// выводить его из минимума или максимума заказчика (tp-guard.ts). Здесь число находится в тексте, проверяется по цитате,
// сверяется с тем, что вписал участник, и записывается подсказкой «[число, не меньше 150]» на месте, где участник назовёт своё.
// Разбор — по правилам, без ИИ: он бесплатный и проверяемый. Модуль без зависимостей от браузера и сервера: его проверяют тесты.
import { normalize } from "@/lib/quotes";

// min — не менее, от; max — не более, до; gt — более, свыше; lt — менее; exact — ровно столько; range — от … до ….
export type Op = "min" | "max" | "gt" | "lt" | "exact" | "range";

export type Condition = {
  // О чём число: «вместимость зала». У условий, которые нашёл код, пусто — на экране тогда видно слова из документа.
  what: string;
  op: Op;
  // Граница; у range — нижняя.
  value: number;
  // Верхняя граница у range.
  value2?: number;
  // Размеры «3×2»: все числа; value — первое. У диапазона размеров — нижние; верхние — в parts2.
  parts?: number[];
  parts2?: number[];
  // Единица измерения, как в документе: «мест», «рабочих дней», «%». Пусто — единицы нет.
  unit: string;
  // Дословный кусок документа с этим условием.
  raw: string;
  // Срок исполнения, который задаёт заказчик: «в течение 5 рабочих дней». Участник принимает его как есть, а не выбирает.
  term?: true;
};

// Условие, найденное в тексте, и его место в тексте.
export type Found = Condition & { at: number; end: number };

// «Число и единица» из текста: сколько и чего. numberEnd — где кончается само число (дальше идёт единица).
export type Mention = { value: number; parts?: number[]; unit: string; at: number; numberEnd: number; end: number };

const WORD_NUMBERS: Record<string, number> = {
  один: 1, одного: 1, одна: 1, одной: 1, одну: 1, два: 2, две: 2, двух: 2, три: 3, трех: 3, четыре: 4, четырех: 4,
  пять: 5, пяти: 5, шесть: 6, шести: 6, семь: 7, семи: 7, восемь: 8, восьми: 8, девять: 9, девяти: 9, десять: 10, десяти: 10,
  одиннадцать: 11, одиннадцати: 11, двенадцать: 12, двенадцати: 12, тринадцать: 13, тринадцати: 13, четырнадцать: 14,
  четырнадцати: 14, пятнадцать: 15, пятнадцати: 15, шестнадцать: 16, шестнадцати: 16, семнадцать: 17, семнадцати: 17,
  восемнадцать: 18, восемнадцати: 18, девятнадцать: 19, девятнадцати: 19, двадцать: 20, двадцати: 20, тридцать: 30,
  тридцати: 30, сорок: 40, сорока: 40, пятьдесят: 50, пятидесяти: 50, шестьдесят: 60, шестидесяти: 60, семьдесят: 70,
  семидесяти: 70, восемьдесят: 80, восьмидесяти: 80, девяносто: 90, девяноста: 90, сто: 100, ста: 100,
};

// Граница ячейки таблицы « | » внутри разбора — не пробел: единица не берётся из соседней ячейки, а условие не склеивается
// из двух ячеек. Знак на месте «|» тот же по длине, поэтому места в тексте не сдвигаются. Метки страниц PDF в разбор не идут.
const CELL = "¦";
const prepare = (text: string) => text.replace(/\|/g, CELL).replace(/-- \d+ of \d+ --/g, (m) => " ".repeat(m.length));

const NUM = String.raw`-?(?:\d{1,3}(?:\s\d{3})+|\d+)(?:,\d+)?`;
const DIMS = String.raw`${NUM}(?:\s?[×xх*]\s?${NUM})+`;
const WORDS = Object.keys(WORD_NUMBERS).sort((a, b) => b.length - a.length).join("|");
// «двадцать пять», «тридцати двух»: десяток и единицы вместе — одно число.
const TENS = "двадцать|двадцати|тридцать|тридцати|сорок|сорока|пятьдесят|пятидесяти|шестьдесят|шестидесяти|семьдесят|семидесяти|восемьдесят|восьмидесяти|девяносто|девяноста";
const ONES = "один|одного|одна|одной|одну|два|две|двух|три|трех|четыре|четырех|пять|пяти|шесть|шести|семь|семи|восемь|восьми|девять|девяти";
const TOKEN = String.raw`(?:${DIMS}|${NUM}|(?:${TENS})\s(?:${ONES})(?![а-я])|(?:${WORDS})(?![а-я]))`;
const BEHIND = String.raw`(?<![а-яa-z0-9.,:-])`;

// «Не может составлять менее месяца» — это «не менее месяца»: двойное отрицание читается как граница.
const MIN_STRONG = String.raw`не\s+(?:может|долж[а-я]*)\s+(?:быть\s+|составлять\s+)?(?:менее|меньше|ниже)|не\s+менее|не\s+меньше|не\s+мене|не\s+ниже|как\s+минимум|минимум|по\s+меньшей\s+мере`;
const MAX_STRONG = String.raw`не\s+(?:может|долж[а-я]*)\s+(?:быть\s+|составлять\s+)?(?:более|больше|выше)|не\s+(?:может|долж[а-я]*)\s+превышать|не\s+более|не\s+боле|не\s+больше|не\s+выше|не\s+свыше|не\s+превыша[а-я]*|как\s+максимум|максимум`;
const WEAK = String.raw`более|свыше|больше|выше|превышающ[а-я]*|менее|меньше|ниже|от|до`;
const MIN_WORD = new RegExp(`^(?:${MIN_STRONG})$`);
const MAX_WORD = new RegExp(`^(?:${MAX_STRONG})$`);

const BOUND = new RegExp(
  String.raw`(?<![а-я])(${MIN_STRONG}|${MAX_STRONG}|${WEAK})(?![а-я])(?:\s*:)?(?:\s+чем)?(?:\s+(?:на|за|в|через))?\s+(${TOKEN})`,
  "g"
);
const RANGE_HEAD = new RegExp(String.raw`(?<![а-я])((?:в\s+диапазоне\s+)?(от|с))\s+(?=${TOKEN})`, "g");
const RANGE_MID = new RegExp(String.raw`\s+(?:до|по)\s+`, "y");
const POSTFIX = new RegExp(
  String.raw`${BEHIND}(${TOKEN})((?:\s+[а-я%²³₽°/·]+\.?){0,2}?)\s+(?:и|или)\s+(более|выше|больше|свыше|менее|ниже|меньше)(?![а-я])`,
  "g"
);
const TERM = new RegExp(
  String.raw`(?<![а-я])(в\s+течение(?:\s+не\s+(?:более|менее))?|не\s+(?:позднее|ранее|менее|более)\s+чем\s+(?:за|через))\s+(${TOKEN})`,
  "g"
);
const TOKEN_AT = new RegExp(`${BEHIND}(${TOKEN})`, "y");
const TOKEN_ANY = new RegExp(`${BEHIND}(${DIMS}|${NUM})`, "g");

const STOP = new Set([
  "в", "во", "на", "и", "или", "а", "но", "до", "от", "за", "с", "со", "по", "из", "при", "для", "не", "как", "то", "что", "чем",
  "у", "к", "о", "об", "же", "ли", "бы", "также", "либо", "над", "под", "между", "без", "через", "около", "после", "перед",
]);
const ABBREVIATIONS = new Set(["кв", "куб", "тыс", "млн", "млрд", "пог"]);
const ADJECTIVE = /(?:ых|их|ый|ой|ая|ое|ые|ого|ому|ым|ую)$/;
const MONTH = /^(?:январ|феврал|март|апрел|ма[яй]|июн|июл|август|сентябр|октябр|ноябр|декабр)/;
const TIME_UNIT = /^(?:дн|ден|дне|сут|час|ч$|мин|нед|мес|год|лет|квартал|сек)/;
// Единица одним словом: «мест», «г/м2», «кв.м», «гр./кв.м» (точка внутри — только если дальше идут буквы или «/»).
const UNIT_WORD = /[а-яa-z%²³₽°/·][а-яa-z%²³₽°/·\d]*(?:\.(?=[/а-яa-z])[а-яa-z%²³₽°/·\d]+)*\.?/y;
// Приставка числа, а не единица: «3-х», «5-ти», «5 (пяти)».
const NUMBER_TAIL = /(?:-\s?(?:х|ти|ми|ех)(?![а-я]))|(?:х(?=\s|¦|$))|(?:\s*\([а-я0-9\s,.-]{1,40}\))/y;

function tokenValue(token: string): number[] {
  const word = WORD_NUMBERS[token];
  if (word !== undefined) return [word];
  const compound = token.split(" ");
  if (compound.length === 2 && compound.every((w) => WORD_NUMBERS[w] !== undefined)) return [WORD_NUMBERS[compound[0]] + WORD_NUMBERS[compound[1]]];
  return token.split(/[×xх*]/).map((p) => Number(p.replace(/\s/g, "").replace(",", ".")));
}

// Число начинается не посреди слова и не кончается датой, временем или номером пункта: «2.1», «15:00», «01.10.2026», «п. 2».
function tokenOk(n: string, at: number, end: number): boolean {
  const next = n[end];
  const after = n[end + 1];
  if ((next === ":" || next === ".") && after !== undefined && after >= "0" && after <= "9") return false;
  if (next === "-" && after !== undefined && after >= "0" && after <= "9") return false;
  const head = n.slice(Math.max(0, at - 14), at);
  if (/(?:^|[^а-я])(?:п|пп|ст|ч|разд[а-я]*|прил[а-я]*|пункт[а-я]*|глав[а-я]*|табл[а-я]*|рис[а-я]*)\.?\s*$|№\s*$/.test(head)) return false;
  return true;
}

function readWord(n: string, from: number): { word: string; end: number } | null {
  UNIT_WORD.lastIndex = from;
  const m = UNIT_WORD.exec(n);
  return m ? { word: m[0], end: UNIT_WORD.lastIndex } : null;
}

// В таблицах ТЗ единица часто стоит в соседней ячейке: «Мощность | не менее 40 | кВт». Берётся только настоящая единица:
// слово из соседней ячейки — «функция», «внешний вид» — единицей не считается.
const UNIT_CELL = new RegExp(
  String.raw`¦\s*((?:кв\.?\s?м|куб\.?\s?м|м[²³23]|[кмгт]?гц|[кмгт]?вт(?:·ч)?|ма(?:/ч)?|а/ч|мпа|па|бар|кд/м[²2]|г/м[²2]|гр/м[²2]|кг/м[³3]|об/мин|дб|[кмгт]б|шт\.?|штук|кг|мг|мл|мм|см|км|дм|мин|сек|часов|час|дней|дня|дн\.?|сут|мес|лет|года|руб\.?|₽|%|°[cс]|литров|л|г|т|м|ч|в|а))(?=\s*(?:¦|$)|\s|[.,;])`,
  "y"
);

// Единица сразу после числа: «мест», «рабочих дней», «обработанных фотографий», «кв. м», «г/м²», «%». Прилагательные входят
// в единицу вместе с существительным; предлог, союз и граница ячейки — не единица. Нет единицы — end там, где кончилось число.
function unitAfter(n: string, from: number): { unit: string; end: number } {
  NUMBER_TAIL.lastIndex = from;
  const tail = NUMBER_TAIL.exec(n);
  const afterNumber = tail ? NUMBER_TAIL.lastIndex : from;
  const gap = /\s*/y;
  gap.lastIndex = afterNumber;
  gap.exec(n);
  let pos = gap.lastIndex;
  if (n[pos] === CELL) {
    UNIT_CELL.lastIndex = pos;
    const cell = UNIT_CELL.exec(n);
    // Одна буква («в», «а», «г») — единица, только если она одна в ячейке.
    if (cell && (cell[1].length > 1 || /^\s*(?:¦|$)/.test(n.slice(UNIT_CELL.lastIndex)))) {
      return { unit: cell[1].replace(/\.$/, ""), end: UNIT_CELL.lastIndex - (cell[1].endsWith(".") ? 1 : 0) };
    }
    return { unit: "", end: afterNumber };
  }
  const words: { text: string; end: number }[] = [];
  for (let k = 0; k < 3; k++) {
    const w = readWord(n, pos);
    if (!w) break;
    const bare = w.word.replace(/\.$/, "");
    if (STOP.has(bare)) break;
    const dot = w.word.endsWith(".");
    const abbreviation = ABBREVIATIONS.has(bare);
    words.push({ text: abbreviation && dot ? `${bare}.` : bare, end: w.end - (dot ? 1 : 0) });
    if (!abbreviation && !(ADJECTIVE.test(bare) && bare.length >= 5)) break;
    const space = / /y;
    space.lastIndex = w.end;
    if (!space.exec(n)) break;
    pos = space.lastIndex;
  }
  if (!words.length) return { unit: "", end: afterNumber };
  return { unit: words.map((w) => w.text).join(" "), end: words[words.length - 1].end };
}

// Один смысл у «дней», «дня», «дни»; у «лет» и «года»; у «кв. м», «м²», «м2»: единицы сравниваются по ключу.
export function unitKey(unit: string): string {
  const u = unit.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
  if (!u) return "";
  if (u === "%" || /^процент/.test(u)) return "%";
  // Составные единицы — «г/м²», «гр./кв.м», «кд/м2»: каждая часть приводится к одному виду, и «г/м²» не путается с «м²».
  if (u.includes("/")) {
    return u
      .split("/")
      .map((part) => {
        const p = part.replace(/[\s.]/g, "").replace(/²/g, "2").replace(/³/g, "3");
        return /^(?:кв|квадр)?м2?$/.test(p) && /кв/.test(p) ? "м2" : p === "гр" ? "г" : p;
      })
      .join("/");
  }
  if (/кв\.?\s*м|квадратн|м²|(?:^|\s)м2$/.test(u)) return "м2";
  if (/куб\.?\s*м|кубическ|м³|(?:^|\s)м3$/.test(u)) return "м3";
  const last = u.split(" ").pop()!.replace(/[.]/g, "");
  if (/^(?:дн|ден|дне|сут)/.test(last)) return "дн";
  if (/^(?:год|лет)/.test(last)) return "год";
  if (/^(?:руб|₽)/.test(last)) return "руб";
  if (/^(?:шт|штук)/.test(last)) return "шт";
  if (/^чел/.test(last)) return "чел";
  // «метра», «сантиметров», «килограммов» — то же, что «м», «см», «кг».
  const full: [RegExp, string][] = [
    [/^метр/, "м"], [/^километр/, "км"], [/^сантиметр/, "см"], [/^миллиметр/, "мм"], [/^килограмм/, "кг"],
    [/^грамм|^гр$/, "г"], [/^тонн/, "т"], [/^литр/, "л"], [/^секунд/, "сек"], [/^минут/, "мин"],
  ];
  for (const [re, key] of full) if (re.test(last)) return key;
  return last.slice(0, 4);
}

const isTime = (unit: string) => TIME_UNIT.test(unit.toLowerCase().split(" ").pop() ?? "");
// Месяц и «числа» — не единица измерения, а дата: «до 5 числа», «с 1 по 5 октября».
const notAUnit = (unit: string) => MONTH.test(unit) || /^числ/.test(unit);

const rawOf = (text: string, at: number[], from: number, to: number) => text.slice(at[from], at[to - 1] + 1);

// 2,5 и 685 000: запятая у дробей, пробелы между тысячами у больших чисел — как в документах заказчика.
const fmt = (n: number) => {
  const [whole, fraction] = String(Math.abs(n)).split(".");
  const grouped = Math.abs(n) >= 10_000 ? whole.replace(/\B(?=(\d{3})+$)/g, " ") : whole;
  return `${n < 0 ? "-" : ""}${grouped}${fraction ? `,${fraction}` : ""}`;
};
const fmtParts = (c: Pick<Condition, "value" | "parts">) => (c.parts ? c.parts.map(fmt).join("×") : fmt(c.value));
// Верхняя граница диапазона: число или размеры.
const upper = (c: Pick<Condition, "value" | "value2" | "parts2">) => (c.parts2 ? c.parts2.map(fmt).join("×") : fmt(c.value2 ?? c.value));

// Число в тексте с указанного места: значение или размеры, где оно кончается.
function tokenAt(n: string, from: number): { parts: number[]; at: number; end: number } | null {
  TOKEN_AT.lastIndex = from;
  const m = TOKEN_AT.exec(n);
  if (!m) return null;
  const end = from + m[1].length;
  if (!tokenOk(n, from, end)) return null;
  const parts = tokenValue(m[1]);
  return parts.some((p) => !Number.isFinite(p)) ? null : { parts, at: from, end };
}

// Куда направлен срок «не позднее чем за N …»: «за 10 дней до» — заранее, «за 3 часа после» — в пределах N после.
function leadOf(n: string, after: number): boolean {
  const tail = n.slice(after, after + 40);
  const before = /(?:^|[^а-я])до(?![а-я])/.exec(tail);
  const later = /(?:^|[^а-я])после(?![а-я])/.exec(tail);
  return !(later && (!before || later.index < before.index));
}

// Условия из текста: что заказчик ограничивает снизу или сверху. «Точное значение» без границы условием не считается:
// это просто число в тексте. «Не менее 1020 и не более 1100» — один диапазон. at и end — место условия в исходном тексте.
export function parseConditions(text: string): Found[] {
  const norm = normalize(prepare(text));
  const n = norm.text;
  const at = norm.at!;
  const out: (Found & { a: number; b: number })[] = [];
  const free = (a: number, b: number) => out.every((c) => b <= c.a || a >= c.b);
  const add = (a: number, b: number, c: Omit<Condition, "raw">) =>
    out.push({ ...c, raw: rawOf(text, at, a, b), at: at[a], end: at[b - 1] + 1, a, b });

  // 1. «от 3 до 5 лет», «в диапазоне от 10 до 20 мм», «от -20 до 40 °C».
  for (const head of n.matchAll(RANGE_HEAD)) {
    const start = head.index;
    const first = tokenAt(n, start + head[0].length);
    if (!first) continue;
    const u1 = unitAfter(n, first.end);
    RANGE_MID.lastIndex = u1.end;
    if (!RANGE_MID.exec(n)) continue;
    const second = tokenAt(n, RANGE_MID.lastIndex);
    if (!second) continue;
    const u2 = unitAfter(n, second.end);
    const unit = u2.unit || u1.unit;
    // Без единицы «от 1 до 5» — не условие; «с 10 до 12 часов» — время суток, «от 2 до 4 часов» — длительность.
    if (!unit || notAUnit(unit) || (head[2] === "с" && isTime(unit))) continue;
    if (first.parts.length !== second.parts.length) continue;
    const end = u2.end;
    if (!free(start, end)) continue;
    add(start, end, {
      what: "",
      op: "range",
      value: first.parts[0],
      value2: second.parts[0],
      ...(first.parts.length > 1 && { parts: first.parts, parts2: second.parts }),
      unit,
    });
  }

  // 2. Срок, который задаёт заказчик: «в течение 5 рабочих дней», «не позднее чем за 10 рабочих дней до», «не менее чем за 5 дней до».
  for (const m of n.matchAll(TERM)) {
    const start = m.index;
    const token = tokenAt(n, start + m[0].length - m[2].length);
    if (!token || token.parts.length > 1) continue;
    const u = unitAfter(n, token.end);
    if (!u.unit || !isTime(u.unit)) continue;
    if (!free(start, u.end)) continue;
    const head = m[1].replace(/\s+/g, " ");
    let op: Op;
    if (head.startsWith("в течение")) op = /не менее/.test(head) ? "min" : "max";
    else {
      const word = /^не (позднее|ранее|менее|более)/.exec(head)![1];
      const via = head.endsWith("через");
      if (via) op = word === "позднее" || word === "более" ? "max" : "min";
      else if (!leadOf(n, u.end)) op = "max";
      else op = word === "позднее" || word === "менее" ? "min" : "max";
    }
    add(start, u.end, { what: "", op, value: token.parts[0], unit: u.unit, term: true });
  }

  // 3. «150 мест и более», «5 лет или менее».
  for (const m of n.matchAll(POSTFIX)) {
    const start = m.index;
    const token = tokenAt(n, start);
    if (!token) continue;
    let unit = (m[2] ?? "").trim().replace(/\.$/, "");
    let end = start + m[0].length;
    // «на 25 и более процентов»: единица стоит после слов «и более».
    if (!unit) {
      const after = unitAfter(n, end);
      if (after.unit && !notAUnit(after.unit)) {
        unit = after.unit;
        end = after.end;
      }
    }
    if (!free(start, end)) continue;
    const op: Op = /^(?:более|выше|больше|свыше)$/.test(m[3]) ? "min" : "max";
    add(start, end, { what: "", op, value: token.parts[0], ...(token.parts.length > 1 && { parts: token.parts }), unit });
  }

  // 4. «не менее 150 мест», «не более 5 кг», «свыше 3 лет», «до 10 мм».
  for (const m of n.matchAll(BOUND)) {
    const word = m[1];
    const strong = /^(?:не\s|как\s|мин|макс|по\s+меньшей)/.test(word);
    const start = m.index;
    const token = tokenAt(n, start + m[0].length - m[2].length);
    if (!token) continue;
    const u = unitAfter(n, token.end);
    if (u.unit && notAUnit(u.unit)) continue;
    // «от», «до», «более» без единицы — не условие: «до 30», «от 1»; с единицей — да: «более 3 лет», «до 5 человек».
    if (!strong) {
      if (!u.unit || /^(?:час|ч$|мин)/.test(u.unit)) continue;
      if (unitKey(u.unit) === "год" && /^г/.test(u.unit) && token.parts[0] >= 1900 && token.parts[0] <= 2100) continue;
    }
    const end = u.unit ? u.end : token.end;
    if (!free(start, end)) continue;
    const op: Op = MIN_WORD.test(word)
      ? "min"
      : MAX_WORD.test(word)
        ? "max"
        : /^(?:более|свыше|больше|выше|превышающ)/.test(word)
          ? "gt"
          : word === "от"
            ? "min"
            : word === "до"
              ? "max"
              : "lt";
    add(start, end, { what: "", op, value: token.parts[0], ...(token.parts.length > 1 && { parts: token.parts }), unit: u.unit });
  }

  out.sort((x, y) => x.a - y.a);
  return mergeBounds(text, out).map(({ a: _a, b: _b, ...c }) => c);
}

// То же без места в тексте — условие, как оно хранится у требования.
export const conditionsOf = (text: string): Condition[] =>
  parseConditions(text).map((found) => {
    const { at, end, ...condition } = found;
    void at;
    void end;
    return condition;
  });

// «Не менее 1020 г/м² и не более 1100 г/м²», «не менее 1000 не более 1500 мА/ч» — одно условие: значение между границами.
// В разных ячейках таблицы границы не склеиваются.
function mergeBounds<T extends Found & { a: number; b: number }>(text: string, list: T[]): T[] {
  const out: T[] = [];
  for (const c of list) {
    const prev = out[out.length - 1];
    // Размеры сливаются в диапазон размеров, только если у обеих границ их одинаково много.
    const sameShape = prev && (prev.parts?.length ?? 1) === (c.parts?.length ?? 1);
    const pair = prev && sameShape && !prev.term && !c.term && ((prev.op === "min" && c.op === "max") || (prev.op === "max" && c.op === "min"));
    const gap = pair ? text.slice(prev.end, c.at) : "";
    const same = pair && (!prev.unit || !c.unit || unitKey(prev.unit) === unitKey(c.unit));
    if (pair && same && /^[.\s,;]*(?:и|или)?[\s,;]*$/i.test(gap)) {
      const [low, high] = prev.op === "min" ? [prev, c] : [c, prev];
      const ordered = low.parts && high.parts ? low.parts.every((x, i) => x <= high.parts![i]) : low.value <= high.value;
      if (ordered) {
        out[out.length - 1] = {
          ...prev,
          op: "range",
          value: low.value,
          value2: high.value,
          ...(low.parts && high.parts && { parts: low.parts, parts2: high.parts }),
          unit: prev.unit || c.unit,
          raw: text.slice(prev.at, c.end),
          end: c.end,
          b: c.b,
        };
        continue;
      }
    }
    out.push(c);
  }
  return out;
}

// Все числа текста, как они стоят: «6 850,00» — 6850, «30.09.2026» — 30, 9 и 2026, «двадцать пять» — 25. Нужны, чтобы сверить числа
// пересказа с цитатой: цифрами, словами и в таблице один и тот же набор.
const ALL_NUMBERS = new RegExp(
  String.raw`(?<![а-яa-z0-9])(?:(?:${TENS})\s(?:${ONES})|${WORDS})(?![а-я])|(?:\d{1,3}(?:\s\d{3})+|\d+)(?:,\d+)?`,
  "g"
);
export function allNumbers(text: string): number[] {
  const n = normalize(text, false).text;
  const out: number[] = [];
  for (const m of n.matchAll(ALL_NUMBERS)) {
    const v = tokenValue(m[0].startsWith("-") ? m[0].slice(1) : m[0])[0];
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

// Все «число + единица» из текста: сколько и чего. Даты, время, номера пунктов, годы не в счёт. Слова-числа («три») — тоже:
// в предложении участника важны цифры.
export function mentionsOf(text: string): Mention[] {
  const norm = normalize(prepare(text));
  const n = norm.text;
  const at = norm.at!;
  const out: Mention[] = [];
  for (const m of n.matchAll(TOKEN_ANY)) {
    const start = m.index + (m[0].length - m[1].length);
    const end = start + m[1].length;
    if (!tokenOk(n, start, end)) continue;
    const parts = tokenValue(m[1]);
    if (parts.some((p) => !Number.isFinite(p))) continue;
    const u = unitAfter(n, end);
    if (notAUnit(u.unit)) continue;
    if (parts.length === 1 && parts[0] >= 1900 && parts[0] <= 2100 && (!u.unit || /^г(?:од|\.?$)/.test(u.unit))) continue;
    out.push({
      value: parts[0],
      ...(parts.length > 1 && { parts }),
      unit: u.unit,
      at: at[start],
      numberEnd: at[end - 1] + 1,
      end: at[(u.unit ? u.end : end) - 1] + 1,
    });
  }
  return out;
}

// «150|мест», «3x2|м»: число и единица одной строкой — по ней сравнивают, одно и то же ли названо.
export const mentionKey = (m: Pick<Mention, "value" | "parts" | "unit">) => `${m.parts ? m.parts.join("x") : m.value}|${unitKey(m.unit)}`;

// Подходит ли названное участником значение под условие заказчика. got — число или размеры.
export function satisfies(c: Pick<Condition, "op" | "value" | "value2" | "parts" | "parts2">, got: number[]): boolean {
  if (got.length === 0) return false;
  const eps = 1e-9;
  if (c.parts && c.parts.length > 1) {
    if (got.length !== c.parts.length) return false;
    // Размер 3×2 и 2×3 — один: стороны сравниваются от большей к меньшей.
    const need = [...c.parts].sort((a, b) => b - a);
    const have = [...got].sort((a, b) => b - a);
    if (c.op === "range") {
      const top = [...(c.parts2 ?? c.parts)].sort((a, b) => b - a);
      return need.every((x, i) => have[i] >= x - eps && have[i] <= top[i] + eps);
    }
    return need.every((x, i) => (c.op === "max" || c.op === "lt" ? have[i] <= x + eps : have[i] >= x - eps));
  }
  const x = got[0];
  switch (c.op) {
    case "min":
      return x >= c.value - eps;
    case "max":
      return x <= c.value + eps;
    case "gt":
      return x > c.value + eps;
    case "lt":
      return x < c.value - eps;
    case "exact":
      return Math.abs(x - c.value) < eps;
    case "range":
      return x >= c.value - eps && x <= (c.value2 ?? c.value) + eps;
  }
}

// Условие словами заказчика: «не менее 150 мест», «от 3 до 5 лет», «в течение 5 рабочих дней».
export function describeCondition(c: Condition): string {
  // «руб», «шт» — сокращения: на экране с точкой, как пишут в документах.
  const unit = c.unit ? ` ${/^(?:руб|шт|чел|тыс|млн|млрд)$/.test(c.unit) ? `${c.unit}.` : c.unit}` : "";
  const v = fmtParts(c);
  if (c.term) return `срок ${c.op === "min" ? "не менее" : "не более"} ${v}${unit}`;
  switch (c.op) {
    case "min":
      return `не менее ${v}${unit}`;
    case "max":
      return `не более ${v}${unit}`;
    case "gt":
      return `более ${v}${unit}`;
    case "lt":
      return `менее ${v}${unit}`;
    case "exact":
      return `${v}${unit}`;
    case "range":
      return `от ${v} до ${upper(c)}${unit}`;
  }
}

// Подсказка на месте, где участник назовёт своё значение: «[число, не меньше 150]». Граница — заказчика, значение — участника.
// Единицу измерения оставляют за скобкой, как в тексте заказчика: «вместимость — [число, не меньше 150] мест».
export type Hint = { op: Exclude<Op, "exact">; value: number; value2?: number; parts?: number[]; parts2?: number[] };

const HINT_WORDS: Record<Exclude<Op, "exact" | "range">, string> = { min: "не меньше", max: "не больше", gt: "больше", lt: "меньше" };

export function hintOf(c: Pick<Condition, "op" | "value" | "value2" | "parts" | "parts2">): string | null {
  if (c.op === "exact") return null;
  const head = c.parts && c.parts.length > 1 ? "размер" : "число";
  if (c.op === "range") return `[${head}, от ${fmtParts(c)} до ${upper(c)}]`;
  return `[${head}, ${HINT_WORDS[c.op]} ${fmtParts(c)}]`;
}

const HINT = new RegExp(
  String.raw`^\[?(?:число|размер),\s*(?:(не\s+меньше|не\s+больше|больше|меньше)\s+(${DIMS}|${NUM})|от\s+(${DIMS}|${NUM})\s+до\s+(${DIMS}|${NUM}))\]?$`
);

// Подсказка из жёлтого места ТП — «[число, не меньше 150]», «число, от 3 до 5»; не подсказка — null.
export function parseHint(text: string): Hint | null {
  const m = HINT.exec(text.trim().toLowerCase());
  if (!m) return null;
  if (m[1]) {
    const op = m[1].startsWith("не меньше") ? "min" : m[1].startsWith("не больше") ? "max" : m[1] === "больше" ? "gt" : "lt";
    const parts = tokenValue(m[2]);
    return { op, value: parts[0], ...(parts.length > 1 && { parts }) };
  }
  const from = tokenValue(m[3]);
  const to = tokenValue(m[4]);
  return { op: "range", value: from[0], value2: to[0], ...(from.length > 1 && { parts: from, parts2: to }) };
}

// Что вписал участник: первое число (или размеры «4×2,5») из его текста. Нет числа — null.
export function numbersIn(text: string): number[] | null {
  const m = new RegExp(`(${DIMS}|${NUM})`).exec(text.toLowerCase());
  if (!m) return null;
  const parts = tokenValue(m[1]);
  return parts.some((p) => !Number.isFinite(p)) ? null : parts;
}

// Не подходит ли вписанное значение под подсказку: «120 — по ТЗ не меньше 150». Подходит или не число — null.
export function hintProblem(hint: Hint, entered: string): string | null {
  const got = numbersIn(entered);
  if (!got || satisfies(hint, got)) return null;
  const need = hint.op === "range" ? `от ${fmtParts(hint)} до ${upper(hint)}` : `${HINT_WORDS[hint.op]} ${fmtParts(hint)}`;
  return `${got.map(fmt).join("×")} — по ТЗ ${need}`;
}

// Граница, которую участник может принять как своё значение одним нажатием: «не меньше 150» — 150. У «больше», «меньше»
// и диапазона границы-значения нет: строгая граница сама не подходит, а из диапазона выбирать — участнику.
export function acceptableValue(hint: Hint): string | null {
  return hint.op === "min" || hint.op === "max" ? fmtParts(hint) : null;
}
