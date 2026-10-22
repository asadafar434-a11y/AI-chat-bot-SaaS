// Загрузка закупки прямо в «Аналитику» — без ИИ и без платы: файлы читает сервер (текст, как обычно), а название, начальную цену, закон и способ находит код по тексту документов.
// Найденное участник видит и может поправить до сохранения. Требований и ТП здесь нет: разбор требований — платный ИИ на обычной загрузке, «Аналитике» он не нужен.
// Найти не вышло — поле пустое, ничего не выдумывается (аналитика тогда скажет «начальной цены нет»).

import { NO_CRITERIA } from "@/lib/criteria";
import type { Purchase } from "@/lib/purchase";
import type { FailedFile } from "@/lib/read-documents";
import type { PurchaseSummary } from "@/lib/requirements";

type Doc = { name: string; text: string };

export type Law = "44" | "223" | "";

export type Intro = { title: string; subject: string; customer: string; price: string; law: Law; method: string };

const clean = (s: string) => s.replace(/[\s ]+/g, " ").trim();
const stripExt = (name: string) => name.replace(/\.[A-Za-z0-9]{2,5}$/, "");

// Значение после подписи: «Подпись: значение», «Подпись | значение» (ячейка таблицы) или значение на следующей строке.
function after(text: string, label: RegExp): string {
  const inline = new RegExp(`(?:${label.source})[^\\n:|\\t]{0,40}[:|\\t]\\s*([^\\n|]{4,220})`, "i").exec(text)?.[1];
  if (inline && /[A-Za-zА-Яа-яЁё0-9]/.test(inline)) return clean(inline).replace(/[.;,]+$/, "");
  const nextLine = new RegExp(`(?:${label.source})[^\\n]{0,40}\\n\\s*([^\\n|]{4,220})`, "i").exec(text)?.[1];
  return nextLine ? clean(nextLine).replace(/[.;,]+$/, "") : "";
}

const SUBJECT = /(?:предмет\s+(?:закупки|контракта|договора)|объект\s+закупки|наименование\s+(?:закупки|объекта\s+закупки))/i;
const CUSTOMER = /(?:наименование\s+заказчика|заказчик)(?![а-яё])/i;

function firstFound(docs: Doc[], label: RegExp, ok: (value: string) => boolean = () => true): string {
  for (const doc of docs) {
    const value = after(doc.text, label);
    if (value && ok(value)) return value;
  }
  return "";
}

// Число рублей: «25 930 002,00», «1 000 000», «685000.50». Меньше тысячи — не цена закупки (номера пунктов, проценты).
const MONEY = String.raw`(\d{1,3}(?:[\s ]\d{3})+(?:[.,]\d{1,2})?|\d{4,}(?:[.,]\d{1,2})?)`;
const PRICE_LABEL = String.raw`(?:начальн[а-яё]*\s*\(?\s*максимальн[а-яё]*\s*\)?\s*цен[а-яё]*(?:\s+(?:контракта|договора|лота))?|НМЦ[КДЦ]?|максимальн[а-яё]*\s+значени[а-яё]*\s+цен[а-яё]*\s+контракта)`;

function moneyOf(raw: string): number | null {
  const value = Number(raw.replace(/[\s ]/g, "").replace(",", "."));
  return Number.isFinite(value) && value >= 1000 ? value : null;
}

const rubles = (n: number) => {
  const [whole, frac] = n.toFixed(2).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}${frac === "00" ? "" : `,${frac}`} ₽`;
};

/** Начальная (максимальная) цена из текстов документов: берётся значение, которое названо чаще всего (извещение и проект договора обычно называют одно и то же). */
export function findPrice(docs: Doc[]): string {
  const counts = new Map<number, number>();
  for (const doc of docs) {
    const re = new RegExp(`${PRICE_LABEL}[^\\d\\n]{0,120}?${MONEY}`, "gi");
    for (const m of doc.text.matchAll(re)) {
      const value = moneyOf(m[1]);
      if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? rubles(best[0]) : "";
}

/** Закон: чаще названный из 44-ФЗ и 223-ФЗ; не назван ни один — пусто. */
export function findLaw(docs: Doc[]): Law {
  const all = docs.map((d) => d.text).join("\n");
  const n44 = (all.match(/(?<!\d)44[\s-]*ФЗ/gi) ?? []).length;
  const n223 = (all.match(/(?<!\d)223[\s-]*ФЗ/gi) ?? []).length;
  if (n44 === 0 && n223 === 0) return "";
  return n44 >= n223 ? "44" : "223";
}

const METHODS: [RegExp, string][] = [
  [/у\s+единственн[а-яё]+\s+поставщик|единственн[а-яё]+\s+поставщик[а-яё]*\s*\(подрядчик/i, "у единственного поставщика"],
  [/запрос\s+котировок/i, "запрос котировок"],
  [/запрос\s+предложений/i, "запрос предложений"],
  [/аукцион[а-яё]*\s+в\s+электронной\s+форме|электронн[а-яё]+\s+аукцион/i, "электронный аукцион"],
  [/конкурс[а-яё]*\s+в\s+электронной\s+форме|электронн[а-яё]+\s+конкурс|открыт[а-яё]+\s+конкурс/i, "электронный конкурс"],
  [/(?<![а-яё])аукцион/i, "аукцион"],
  [/(?<![а-яё])конкурс/i, "конкурс"],
];

/** Способ закупки по словам документов; первое найденное слово в порядке «от особенного к общему». */
export function findMethod(docs: Doc[]): string {
  const head = docs.map((d) => d.text.slice(0, 6000)).join("\n");
  for (const [re, name] of METHODS) if (re.test(head)) return name;
  return "";
}

const shorten = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

export function introOf(docs: Doc[]): Intro {
  const subject = firstFound(docs, SUBJECT, (v) => !/^(?:не\s+указан|нет)$/i.test(v));
  const customer = firstFound(docs, CUSTOMER, (v) => v.length >= 6 && !/^(?:не\s+указан|нет)$/i.test(v));
  const law = findLaw(docs);
  const method = findMethod(docs);
  const first = docs[0] ? stripExt(docs[0].name) : "";
  return { title: shorten(subject || first, 90), subject, customer: shorten(customer, 160), price: findPrice(docs), law, method };
}

/** Строка «закон · способ», как её пишет разбор закупки: «44-ФЗ · электронный аукцион». */
export function kindOf(law: Law, method: string): string {
  return [law ? `${law}-ФЗ` : "", method].filter(Boolean).join(" · ");
}

export type IntakeFields = { title: string; price: string; law: Law };

/** Закупка для «Аналитики»: документы и то, что нашёл код или поправил участник; требований нет, поэтому пакет заявки по ней не составляется — для этого есть обычная загрузка. */
export function purchaseForAnalytics(args: { id: string; createdAt: string; docs: Doc[]; failed: FailedFile[]; fields: IntakeFields; intro: Intro }): Purchase {
  const { id, createdAt, docs, failed, fields, intro } = args;
  const summary: PurchaseSummary = {
    short: fields.title.trim() || intro.title || "Закупка без названия",
    subject: intro.subject || fields.title.trim(),
    kind: kindOf(fields.law, intro.method),
    customer: intro.customer,
    price: fields.price.trim(),
    deadline: { date: "", time: "", zone: "" },
  };
  return {
    ...summary,
    id,
    createdAt,
    files: docs.map((d) => d.name),
    unreadable: failed,
    requirements: { who: [], submit: [], scope: [], terms: [] },
    criteria: NO_CRITERIA,
  };
}
