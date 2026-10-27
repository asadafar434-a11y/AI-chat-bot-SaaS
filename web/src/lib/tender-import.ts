// Выгрузка закупок из таблицы: вставка из Excel или сайта, файл CSV/TSV/TXT. Столбцы находятся по заголовкам («Реестровый номер», «Наименование», «Заказчик», «НМЦК», «Дата размещения»,
// «Окончание подачи заявок», «Закон», «Регион», «Способ», «Ссылка»). Без заголовков не берём: угадывать столбцы по содержимому — значит выдумывать. Закупок не придумываем: чего нет в строке, то null.

import { parseDateCell, parseMoney, parseTable } from "@/lib/analog-import";
import type { TenderLaw, TenderListing } from "@/lib/tender-search";

export const MAX_LISTINGS = 2000;

type Field = "id" | "title" | "customer" | "price" | "published" | "deadline" | "law" | "region" | "method" | "url";

// Порядок важен: «Наименование заказчика» — заказчик, а не название закупки; «Дата окончания подачи заявок» — срок, а не дата размещения.
const HEADERS: [Field, RegExp][] = [
  ["customer", /заказчик|организатор|заказч/i],
  [
    "deadline",
    /оконча[а-яё]*\s+(?:подач|приема|приёма)|(?:подач|прием|приём)[а-яё]*\s+заявок\s*(?:до|оконч)|заявок\s+до|срок[а-яё]*\s+подач|дата\s+и\s+время\s+оконч|окончание\s+срока/i,
  ],
  [
    "published",
    /размещен|публикац|опубликов|дата\s+размещ/i,
  ],
  ["id", /реестров|номер\s+(?:закупки|извещени)|№\s*(?:закупки|извещени)|рег\.?\s*номер|^номер$|^№$/i],
  ["price", /нмцк?|начальн|максимальн|цена|стоимост|сумма/i],
  ["law", /^закон$|^фз$|федеральн|44|223/i],
  ["region", /регион|субъект|место\s+поставки|место\s+выполнения/i],
  ["method", /способ|тип\s+(?:закупки|процедуры)|форма\s+закупки|вид\s+закупки/i],
  ["url", /ссылка|url|адрес\s+страницы/i],
  ["title", /наименование|предмет|объект\s+закупки|название|описание/i],
];

/** Какому полю соответствует заголовок; «Наименование заказчика» → заказчик (customer идёт первым). */
export function fieldOf(header: string): Field | null {
  const h = header.replace(/\s+/g, " ").trim();
  for (const [field, re] of HEADERS) if (re.test(h)) return field;
  return null;
}

export type ImportResult = { listings: TenderListing[]; skipped: { line: number; reason: string }[]; truncated: number; error?: string };

const lawOf = (cell: string, id: string): TenderLaw | null => {
  if (/(?<!\d)223/.test(cell)) return "223-ФЗ";
  if (/(?<!\d)44/.test(cell)) return "44-ФЗ";
  // Без столбца закона: у извещений 44-ФЗ реестровый номер из 19 цифр, у 223-ФЗ — из 11.
  if (/^\d{19}$/.test(id)) return "44-ФЗ";
  if (/^\d{11}$/.test(id)) return "223-ФЗ";
  return null;
};

const clean = (s: string | undefined): string | null => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
};

/** CSV с запятыми и кавычками («"Закупка, срочная",100»): parseTable запятую берёт только у знакомых заголовков, а у наших заголовков её нет. */
function parseCommaCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length && rows.length <= MAX_LISTINGS; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell.trim());
      cell = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

/** Закупки из текста таблицы. Первая строка — заголовки; нужен хотя бы номер или наименование. */
export function importTenders(text: string): ImportResult {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  // Таблица из ЕИС и Excel — через табуляцию: кавычки в названиях («ПАО "Россети"») там обычные знаки, а не оболочка поля.
  let rows = lines[0]?.includes("\t") ? lines.slice(0, MAX_LISTINGS + 1).map((l) => l.split("\t").map((c) => c.trim())) : parseTable(text);
  if (rows[0]?.length === 1 && rows[0][0].includes(",")) rows = parseCommaCsv(text);
  if (rows.length < 2) return { listings: [], skipped: [], truncated: 0, error: "В таблице должна быть строка заголовков и хотя бы одна закупка." };
  const header = rows[0];
  const cols: Partial<Record<Field, number>> = {};
  header.forEach((h, i) => {
    const f = fieldOf(h);
    if (f && cols[f] === undefined) cols[f] = i;
  });
  if (cols.id === undefined && cols.title === undefined) {
    return { listings: [], skipped: [], truncated: 0, error: "Не нашёл столбцы «Реестровый номер» или «Наименование»: проверьте, что первая строка — заголовки." };
  }
  const listings: TenderListing[] = [];
  const skipped: { line: number; reason: string }[] = [];
  const seen = new Set<string>();
  let truncated = 0;
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const cell = (f: Field) => clean(cols[f] === undefined ? undefined : r[cols[f]!]);
    const title = cell("title");
    const idRaw = cell("id");
    const id = (idRaw ?? "").replace(/\s+/g, "");
    if (!id && !title) {
      skipped.push({ line, reason: "нет ни номера, ни наименования" });
      return;
    }
    // Нет номера — берём наименование за ключ, чтобы строку не потерять; повтор того же ключа пропускаем.
    const key = id || (title as string).toLowerCase();
    if (seen.has(key)) {
      skipped.push({ line, reason: "повтор" });
      return;
    }
    if (listings.length >= MAX_LISTINGS) {
      truncated++;
      return;
    }
    seen.add(key);
    const priceCell = cell("price");
    const url = cell("url");
    listings.push({
      id: key,
      law: lawOf(cell("law") ?? "", id),
      title: title ?? key,
      customer: cell("customer"),
      price: priceCell ? parseMoney(priceCell) : null,
      publishedAt: parseDateCell(cell("published") ?? ""),
      deadline: parseDateCell(cell("deadline") ?? ""),
      region: cell("region"),
      method: cell("method"),
      url: url && /^https?:\/\//i.test(url) ? url : null,
    });
  });
  return { listings, skipped, truncated };
}
