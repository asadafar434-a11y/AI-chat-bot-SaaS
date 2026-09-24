import { plural } from "@/lib/plural";

const ONES = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const ONES_F = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const TEENS = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
const TENS = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
const HUNDREDS = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];

// Разряды от старшего к младшему; тысячи — женского рода: «одна тысяча», «две тысячи».
const SCALES: { value: number; forms: [string, string, string]; feminine: boolean }[] = [
  { value: 1e9, forms: ["миллиард", "миллиарда", "миллиардов"], feminine: false },
  { value: 1e6, forms: ["миллион", "миллиона", "миллионов"], feminine: false },
  { value: 1e3, forms: ["тысяча", "тысячи", "тысяч"], feminine: true },
];

function triad(n: number, feminine: boolean): string[] {
  const words = [HUNDREDS[Math.floor(n / 100)]];
  const rest = n % 100;
  if (rest >= 10 && rest < 20) words.push(TEENS[rest - 10]);
  else words.push(TENS[Math.floor(rest / 10)], (feminine ? ONES_F : ONES)[rest % 10]);
  return words.filter(Boolean);
}

// 4000000 → «Четыре миллиона рублей 00 копеек» — так цену пишут прописью в заявке.
export function rublesInWords(amount: number): string {
  const cents = Math.round(amount * 100);
  const kopecks = cents % 100;
  let rubles = Math.floor(cents / 100);
  const words: string[] = [];
  for (const scale of SCALES) {
    const count = Math.floor(rubles / scale.value);
    if (count > 0) words.push(...triad(count, scale.feminine), plural(count, ...scale.forms));
    rubles %= scale.value;
  }
  words.push(...triad(rubles, false));
  const whole = Math.floor(cents / 100);
  const text = [
    words.length ? words.join(" ") : "ноль",
    plural(whole, "рубль", "рубля", "рублей"),
    String(kopecks).padStart(2, "0"),
    plural(kopecks, "копейка", "копейки", "копеек"),
  ].join(" ");
  return text[0].toUpperCase() + text.slice(1);
}

// 4000000 → «4 000 000,00»
export const formatRubles = (amount: number) =>
  amount.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\u00a0/g, " ");

// «5 874 500,00 ₽ (с НДС)» → 5874500 — начальная цена из сведений о закупке.
export function parseRubles(text: string): number | null {
  const m = /(\d[\d\s\u00a0]*)(?:[,.](\d{1,2}))?/.exec(text);
  if (!m) return null;
  const value = Number(m[1].replace(/[\s\u00a0]/g, "")) + (m[2] ? Number(m[2].padEnd(2, "0")) / 100 : 0);
  return Number.isFinite(value) && value > 0 ? value : null;
}
