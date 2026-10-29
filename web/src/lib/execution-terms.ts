// Что договор требует от поставщика сверх товара — для раздела «Сколько реально может стоить исполнение» (29.10.2026, образец владельца: «договор требует доставить мебель
// в Братск в течение 15 календарных дней, а также выполнить разгрузку, подъём на этаж, сборку и установку; все эти расходы должны входить в цену договора»).
// Читает код без ИИ: место поставки, срок, обязанности поставщика и пункт «Цена договора включает». Строки таблиц (описание товара) не смотрятся: «подъёмный механизм» кресла — не подъём на этаж.

import { placeOf } from "@/lib/hidden-costs";

type Doc = { name: string; text: string };

export type ExecutionTerms = {
  /** «г. Братск»; нет города — регион; null — места поставки в документах нет. */
  place: string | null;
  /** «15 календарных дней»; null — срок «в течение N дней» не найден. */
  term: string | null;
  /** Что поставщик делает сам: «разгрузка», «подъём на этаж», «сборка», «установка», «монтаж». */
  duties: string[];
  /** Номер пункта «Цена договора включает …», где названа доставка или погрузка; null — такого пункта нет. */
  priceClause: string | null;
};

const DUTIES: [string, RegExp][] = [
  ["разгрузка", /погрузо-?\s?разгрузочн|разгрузк/i],
  ["подъём на этаж", /подъ[её]м[а-я]*[^.\n]{0,40}на\s+этаж|поднима[а-я]*[^.\n]{0,40}на\s+этаж/i],
  ["сборка", /сборк[аиуе]|собира[её]т|собрать/i],
  ["установка", /установк[аиуе]|устанавлива[её]т|установить/i],
  ["монтаж", /(?:выполня|осуществля|производ)[а-я]*\s+монтаж|монтаж\s+(?:товара|оборудования|мебели)/i],
];
const TERM = /в\s+течени[еи]\s+(\d{1,3})\s*(?:\([^)]{1,40}\)\s*)?(календарн|рабоч)[а-я]*\s+дн/i;
const DELIVERY = /поставк|поставля|доставк/i;
// \b в JS не работает с кириллицей: граница слова — начало строки, пробел, запятая или скобка.
const CITY = /(?:^|[\s,(])(?:г\.|город)\s*([А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?)/;
const PRICE_CLAUSE = /^\s*(\d+(?:\.\d+){1,3})\.?\s+Цена\s+(?:Договора|Контракта)\s+включает[^\n]*(?:транспорт|доставк|погрузо|разгруз)/im;

export function executionTerms(documents: Doc[]): ExecutionTerms {
  const place = placeOf(documents);
  const city = place ? CITY.exec(place.text) : null;
  const lines = documents.flatMap((d) => d.text.split("\n")).filter((l) => !l.includes(" | ") && !l.includes("\t"));
  let term: string | null = null;
  for (const line of lines) {
    if (!DELIVERY.test(line)) continue;
    const m = TERM.exec(line);
    if (m) {
      // «в течение» — родительный падеж: «21 рабочего дня», «15 календарных дней».
      const one = Number(m[1]) % 10 === 1 && Number(m[1]) % 100 !== 11;
      const work = m[2].toLowerCase() === "рабоч";
      term = `${m[1]} ${one ? (work ? "рабочего" : "календарного") : work ? "рабочих" : "календарных"} ${one ? "дня" : "дней"}`;
      break;
    }
  }
  const duties = DUTIES.filter(([, re]) => lines.some((l) => re.test(l))).map(([name]) => name);
  let priceClause: string | null = null;
  for (const d of documents) {
    const m = PRICE_CLAUSE.exec(d.text);
    if (m) {
      priceClause = m[1];
      break;
    }
  }
  return { place: city ? `г. ${city[1]}` : (place?.region.name ?? null), term, duties, priceClause };
}

/** Одна строка для раздела 3: «Договор: поставка в течение 15 календарных дней, место — г. Братск; поставщик сам делает разгрузку, подъём на этаж, сборку и установку — это входит в цену договора (п. 2.5).» */
export function termsLine(t: ExecutionTerms): string | null {
  const parts: string[] = [];
  if (t.term) parts.push(`поставка в течение ${t.term}`);
  if (t.place) parts.push(`место — ${t.place}`);
  const head = parts.length > 0 ? `Договор: ${parts.join(", ")}` : null;
  const duties = t.duties.length > 0 ? `поставщик сам делает ${t.duties.map(accusative).join(", ").replace(/, ([^,]+)$/, " и $1")} — это входит в цену договора${t.priceClause ? ` (п. ${t.priceClause})` : ""}` : null;
  if (!head && !duties) return null;
  return `${[head, duties].filter(Boolean).join("; ")}.`.replace(/^поставщик/, "Поставщик");
}

const accusative = (d: string) => (d === "разгрузка" ? "разгрузку" : d === "сборка" ? "сборку" : d === "установка" ? "установку" : d);
