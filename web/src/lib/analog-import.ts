// Загрузка цен-аналогов для РИЦ из таблицы: вставили из ЕИС, Excel или сайта поставщика (или выбрали файл CSV/TXT) — программа находит столбцы, показывает предпросмотр, и после вашей проверки цены
// становятся аналогами позиции с источником и датой (lib/indicative-price.ts). Всё в браузере, на сервер ничего не уходит. Автоматически в ЕИС программа не ходит: туда нужен токен и российский адрес
// сервера (server/eis/README.md); пока цены берёте вы — из реестра контрактов в своём браузере — и вставляете сюда.
// Правила, чтобы не выдумывать: цена без числа пропускается с причиной; дату и источник программа не придумывает — нет даты, цена попадёт в расчёт только после того, как вы её впишете; источник — из таблицы
// (номер контракта, поставщик), а если его там нет — «таблица, строка N».

import type { Analog, Vat } from "@/lib/indicative-price";

export type ColumnRole = "ignore" | "name" | "price" | "total" | "qty" | "date" | "source" | "vat";

export const ROLE_LABELS: Record<ColumnRole, string> = {
  ignore: "Не нужен",
  name: "Наименование",
  price: "Цена за единицу",
  total: "Сумма (разделить на количество)",
  qty: "Количество",
  date: "Дата",
  source: "Источник (номер контракта, поставщик)",
  vat: "НДС",
};

export const MAX_ROWS = 500;
export const MAX_IMPORT = 60;

/** Текст из файла: UTF-8, а если он не читается — windows-1251 (так Excel сохраняет «CSV» на русском). */
export function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start));
  } catch {
    return new TextDecoder("windows-1251").decode(bytes.subarray(start));
  }
}

const HEADER_WORDS = /наименован|товар|предмет|позици|цена|стоимост|сумма|колич|дата|номер|реестров|контракт|договор|поставщик|ндс|источник|price|name|date/i;

function splitLine(line: string, delimiter: string): string[] {
  if (!line.includes('"')) return line.split(delimiter).map((c) => c.trim());
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      cells.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

/** Таблица из вставленного текста. Разделитель: табуляция (копирование из Excel и с сайтов), «;» (CSV из Excel), «|» (таблица из текста документа), запятая — только если в первой строке заголовки. */
export function parseTable(text: string): string[][] {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .slice(0, MAX_ROWS + 1);
  if (lines.length === 0) return [];
  const count = (d: string) => lines.reduce((n, l) => n + (l.split(d).length - 1), 0);
  let delimiter = count("\t") > 0 ? "\t" : count(";") > 0 ? ";" : count("|") > 0 ? "|" : "";
  if (!delimiter && lines[0].includes(",") && lines[0].split(",").filter((c) => HEADER_WORDS.test(c)).length >= 2) delimiter = ",";
  const rows = lines.map((l) => (delimiter ? splitLine(l, delimiter) : [l.trim()]));
  // «|» в таблицах из текста документа стоит и по краям строки: пустые крайние ячейки убираем.
  return rows.map((r) => (delimiter === "|" ? r.filter((c, i) => !(c === "" && (i === 0 || i === r.length - 1))) : r));
}

/** Сумма из ячейки: «1 250,50», «1250.5», «1 250,50 ₽», «1250 руб.». Нуль, минус и не число — null. */
export function parseMoney(text: string): number | null {
  const t = String(text ?? "")
    .replace(/[\s  ]/g, "")
    .replace(/(?:₽|руб(?:лей|\.|)|р\.|rub)$/i, "")
    .replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Цена за единицу в ЕИС бывает с четырьмя знаками после запятой («4 474,3354»): округляем до десятитысячных, а не до копеек.
export const MONEY_OUT = (n: number) => String(Math.round(n * 10000) / 10000).replace(".", ",");

const isoOf = (y: number, m: number, d: number) => {
  const t = Date.UTC(y, m - 1, d);
  const date = new Date(t);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date.toISOString().slice(0, 10) : null;
};

/** Дата из ячейки: «21.10.2026», «21.10.26», «21/10/2026», «2026-10-21», «2026-10-21T10:00:00». Не дата или несуществующая — null. */
export function parseDateCell(text: string): string | null {
  const t = String(text ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(t);
  if (m) return isoOf(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})(?:\s.*)?$/.exec(t);
  if (m) return isoOf(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

// Порядок важен: у «Номер контракта» не должно получиться ни имени, ни даты; «цена за единицу» важнее «цены контракта».
const HEADER_RULES: [ColumnRole, RegExp][] = [
  ["vat", /ндс/i],
  ["qty", /колич|кол-во|кол\.|объ[её]м|qty/i],
  ["date", /дата\s+(?:заключ|подпис|контракт|договор|размещ|начал|поставк)|^дата(?![а-яё])|^date(?![a-z])|заключен/i],
  ["price", /цена\s+за\s+(?:един|1(?!\d)|шт)|цена\s+един|стоимость\s+един|единичн|^цена\s*(?:,|\(|$)|^цена$|^price/i],
  ["total", /цена\s+контракт|цена\s+договор|сумма|итого|стоимость(?!\s+един)|^цена(?![а-яё])/i],
  ["name", /наименован|товар|предмет|позици|название|описани|name/i],
  ["source", /реестров|номер\s+(?:контракт|договор|реестр|записи)|№\s*(?:контракт|договор)|поставщик|продавец|исполнитель|источник|ссылка|url|контракт|договор/i],
];

export type Guess = { hasHeader: boolean; roles: ColumnRole[] };

/** Что в каком столбце: по заголовкам, а без них — по содержимому (цены, даты, текст). Заголовок — первая строка, если в ней слова-заголовки или нет ни одной цены, а ниже есть. */
export function guessRoles(rows: string[][]): Guess {
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  if (rows.length === 0 || width === 0) return { hasHeader: false, roles: [] };
  const first = rows[0];
  const words = first.filter((c) => HEADER_WORDS.test(c)).length;
  const hasMoney = (r: string[]) => r.some((c) => parseMoney(c) !== null);
  const hasHeader = words >= 2 || (words >= 1 && !hasMoney(first)) || (rows.length > 1 && !hasMoney(first) && hasMoney(rows[1]));
  const roles: ColumnRole[] = Array.from({ length: width }, () => "ignore");
  const taken = new Set<ColumnRole>();
  if (hasHeader) {
    for (const [role, re] of HEADER_RULES) {
      const col = first.findIndex((c, i) => roles[i] === "ignore" && re.test(c));
      if (col >= 0 && !taken.has(role)) {
        roles[col] = role;
        taken.add(role);
      }
    }
    return { hasHeader, roles };
  }
  // Без заголовков: столбец, где почти везде даты — дата; где числа — цена (первый); самый «текстовый» — наименование.
  const body = rows.slice(0, 30);
  const share = (col: number, test: (c: string) => boolean) => body.filter((r) => test(r[col] ?? "")).length / body.length;
  for (let col = 0; col < width; col++) {
    if (!taken.has("date") && share(col, (c) => parseDateCell(c) !== null) >= 0.7) {
      roles[col] = "date";
      taken.add("date");
    } else if (!taken.has("price") && share(col, (c) => parseMoney(c) !== null) >= 0.7) {
      roles[col] = "price";
      taken.add("price");
    }
  }
  const textCol = Array.from({ length: width }, (_, col) => col).filter((c) => roles[c] === "ignore").sort((a, b) => body.reduce((s, r) => s + (r[b] ?? "").length, 0) - body.reduce((s, r) => s + (r[a] ?? "").length, 0))[0];
  if (textCol !== undefined && share(textCol, (c) => c.length > 2 && parseMoney(c) === null) >= 0.7) roles[textCol] = "name";
  return { hasHeader, roles };
}

export type ImportRow = {
  /** Номер строки в таблице (с единицы, как видит человек). */
  line: number;
  name: string;
  /** Цена за единицу в виде, как её вводят в расчёт: «1250,5». */
  price: string;
  /** Дата ГГГГ-ММ-ДД или пусто. */
  date: string;
  source: string;
  /** НДС из ячейки, если он там назван; иначе — тот, что выбрал участник. */
  vat: Vat | null;
  /** Что не так: цена попадёт в расчёт только после того, как вы это исправите. */
  problems: string[];
  /** Пояснение к строке: количество, заказчик, номер контракта (карточки ЕИС). */
  detail?: string;
};

export type Built = { rows: ImportRow[]; skipped: { line: number; reason: string }[]; truncated: number };

const REG_NUMBER = /^\d{19}$/;

/** Строки таблицы → цены-аналоги кандидатами. Цена за единицу — из столбца цены или из суммы, делённой на количество; строки без цены пропускаются с причиной. */
export function buildRows(rows: string[][], roles: ColumnRole[], hasHeader: boolean, fileLabel: string): Built {
  const col = (role: ColumnRole) => roles.indexOf(role);
  const at = (r: string[], role: ColumnRole) => (col(role) >= 0 ? (r[col(role)] ?? "").trim() : "");
  const out: ImportRow[] = [];
  const skipped: { line: number; reason: string }[] = [];
  const data = hasHeader ? rows.slice(1) : rows;
  const offset = hasHeader ? 2 : 1;
  const seen = new Set<string>();
  let truncated = 0;
  data.forEach((r, i) => {
    const line = i + offset;
    let price = parseMoney(at(r, "price"));
    if (price === null && col("total") >= 0) {
      const total = parseMoney(at(r, "total"));
      const qty = parseMoney(at(r, "qty"));
      if (total !== null && qty !== null) price = total / qty;
      else if (total !== null) {
        skipped.push({ line, reason: "есть сумма, но нет количества — цену за единицу не вывести" });
        return;
      }
    }
    if (price === null) {
      skipped.push({ line, reason: col("price") < 0 && col("total") < 0 ? "не выбран столбец с ценой" : "цена не число" });
      return;
    }
    const rawDate = at(r, "date");
    const date = parseDateCell(rawDate) ?? "";
    const rawSource = at(r, "source");
    const source = REG_NUMBER.test(rawSource) ? `ЕИС, контракт № ${rawSource}` : rawSource ? rawSource.slice(0, 120) : `${fileLabel}, строка ${line}`;
    const vatCell = at(r, "vat");
    const vat: Vat | null = vatCell === "" ? null : /без/i.test(vatCell) ? "without" : /с\s*ндс|(?<![а-яё])да(?![а-яё])|20|22|есть|включ/i.test(vatCell) ? "with" : null;
    const problems: string[] = [];
    if (!date) problems.push(rawDate ? "дата не распознана — впишите её после добавления" : "нет даты — впишите её после добавления");
    const key = `${MONEY_OUT(price)}|${source}|${date}`;
    if (seen.has(key)) {
      skipped.push({ line, reason: "повтор: такая же цена, источник и дата уже есть выше" });
      return;
    }
    seen.add(key);
    if (out.length >= MAX_IMPORT) {
      truncated++;
      return;
    }
    out.push({ line, name: at(r, "name").slice(0, 200), price: MONEY_OUT(price), date, source, vat, problems });
  });
  return { rows: out, skipped, truncated };
}

/** Выбранные строки — цены-аналоги позиции. НДС: из ячейки, если он назван, иначе выбранный участником. */
export function toAnalogs(rows: ImportRow[], defaultVat: Vat, newId: () => string): Analog[] {
  return rows.map((r) => ({ id: newId(), price: r.price, vat: r.vat ?? defaultVat, source: r.source, date: r.date }));
}

/** Поиск в реестре контрактов (44-ФЗ) или договоров (223-ФЗ) на zakupki.gov.ru: ссылка открывается в браузере участника, с нашего сервера в ЕИС ничего не уходит. Только ключевые слова. */
export function eisSearchUrl(query: string, law: "44" | "223"): string {
  const q = encodeURIComponent(query.replace(/\s+/g, " ").trim().slice(0, 120));
  return law === "44"
    ? `https://zakupki.gov.ru/epz/contract/search/results.html?searchString=${q}&morphology=on&fz44=on&sortBy=UPDATE_DATE&sortDirection=false&recordsPerPage=_50`
    : `https://zakupki.gov.ru/epz/contractfz223/search/results.html?searchString=${q}&morphology=on&sortBy=UPDATE_DATE&sortDirection=false&recordsPerPage=_50`;
}
