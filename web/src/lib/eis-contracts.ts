// Реестр контрактов ЕИС (zakupki.gov.ru) → цены-аналоги для РИЦ. Разбор того, что участник копирует со страниц ЕИС в своём браузере; сам сайт программа не открывает (нужны токен и российский адрес сервера, server/eis/README.md).
// Формат проверен на настоящих страницах (22.10.2026): список результатов («Реестр контрактов, заключённых заказчиками») даёт только ОБЩУЮ цену контракта, а цена за единицу, количество и НДС — в карточке контракта,
// вкладка «Платежи и объекты закупки». Поэтому карточка превращается в цены-аналоги, а список — в перечень контрактов со ссылками на карточки.
// Правила, чтобы не выдумывать: цена за единицу берётся как написана в карточке; НДС — из строки «Ставка НДС» («Без НДС» или процент: цена тогда с НДС); дата — «Заключение контракта»; источник — реестровый номер контракта.

import { MAX_IMPORT, MONEY_OUT, parseDateCell, parseMoney, type Built, type ImportRow } from "@/lib/analog-import";
import type { Vat } from "@/lib/indicative-price";

export type EisItem = {
  /** Название объекта закупки без «Товарный знак: …». */
  name: string;
  /** Характеристики (марка, класс) или название позиции КТРУ — что отличает цену от соседней. */
  detail: string;
  qty: string;
  unit: string;
  unitPrice: number;
  total: number | null;
  vat: Vat | null;
};

export type EisContract = { regNumber: string; contractNo: string; customer: string; signedAt: string; items: EisItem[] };
export type EisListItem = { regNumber: string; contractNo: string; customer: string; objects: string; total: number | null; signedAt: string };

export type EisKind = "cards" | "list" | "table";

const CARD_MARK = /№\s*(\d{19})\s*\(Версия/;
// Запись в списке: реестровый номер, а следом статус. Номер самого контракта (у 44-ФЗ он тоже из 19 цифр) стоит после слова «Контракт» — его за начало записи не считаем.
const RECORD = /^№\s*(\d{19})\s*\n\s*(?:Исполнение|Аннулирован)/m;
const SPACE = "[ \\u00a0]";
const THOUSANDS = `\\d{1,3}(?:${SPACE}\\d{3})*`;

/** Что вставили: карточки контрактов, список результатов поиска или обычная таблица. */
export function eisKind(text: string): EisKind {
  if (CARD_MARK.test(text) && /ЦЕНА\s+ЗА\s+ЕДИНИЦУ/i.test(text)) return "cards";
  if (RECORD.test(text) && /Цена контракта/.test(text)) return "list";
  return "table";
}

export const eisCardUrl = (regNumber: string) => `https://zakupki.gov.ru/epz/contract/contractCard/payment-info-and-target-of-order.html?reestrNumber=${encodeURIComponent(regNumber)}`;

const field = (chunk: string, label: string) => new RegExp(`${label}\\s*\\n\\s*([^\\n]+)`).exec(chunk)?.[1]?.trim() ?? "";
const isoOfRu = (s: string) => parseDateCell(s) ?? "";

// Два числа в одной строке: цена за единицу и сумма. Между ними табуляция (копирование) или пробел (текст страницы).
function twoMoney(line: string): [number, number] | null {
  const tabs = line.split("\t").map((s) => s.trim()).filter(Boolean);
  if (tabs.length === 2) {
    const a = parseMoney(tabs[0]);
    const b = parseMoney(tabs[1]);
    return a !== null && b !== null ? [a, b] : null;
  }
  const m = new RegExp(`^\\s*(${THOUSANDS}(?:,\\d+)?|\\d+(?:,\\d+)?)${SPACE}+(${THOUSANDS},\\d{2})\\s*$`).exec(line);
  if (!m) return null;
  const a = parseMoney(m[1]);
  const b = parseMoney(m[2]);
  return a !== null && b !== null ? [a, b] : null;
}

const QTY = new RegExp(`^\\s*(${THOUSANDS}(?:,\\d+)?|\\d+(?:,\\d+)?)${SPACE}+([A-Za-zА-Яа-яЁё][^\\s]*)\\s*$`);
const NOISE = /^Страна происхождения|Все характеристики|^\(?\s*\d{2}\.\d{2}[.\d-]*\s*\)?\s*$|^\(\s*\d{2}\.\d{2}|^Товар$|^Работа$|^Услуга$|^\s*$/;

function itemsOf(body: string): EisItem[] {
  const lines = body.split("\n").map((l) => l.replace(/ /g, " ").replace(/\s+$/, ""));
  const starts = lines.flatMap((l, i) => (/^\s*\d+\.\s+\S/.test(l) ? [i] : []));
  return starts.flatMap((from, k): EisItem[] => {
    const block = lines.slice(from, starts[k + 1] ?? lines.length);
    const head = block[0].replace(/^\s*\d+\.\s+/, "").trim();
    const name = head.replace(/\.\s*Товарный знак:.*$/i, "").trim();
    let qty = "";
    let unit = "";
    let money: [number, number] | null = null;
    let qtyAt = -1;
    block.forEach((l, i) => {
      if (qtyAt < 0) {
        const q = QTY.exec(l);
        if (q && !twoMoney(l)) {
          qty = q[1].trim();
          unit = q[2].trim();
          qtyAt = i;
        }
      }
    });
    for (let i = Math.max(qtyAt, 1); i < block.length && money === null; i++) money = twoMoney(block[i]);
    if (!money) return [];
    const vatLine = block.map((l) => /Ставка\s+НДС:\s*(.+)$/i.exec(l)?.[1]?.trim()).find(Boolean) ?? "";
    const vat: Vat | null = /без\s+ндс/i.test(vatLine) ? "without" : /\d+\s*%/.test(vatLine) ? "with" : null;
    const detail = block.slice(1, qtyAt < 0 ? undefined : qtyAt).map((l) => l.trim()).find((l) => !NOISE.test(l)) ?? "";
    return [{ name, detail: detail.replace(/\s*\.\.\.$/, ""), qty, unit, unitPrice: money[0], total: money[1], vat }];
  });
}

/** Карточки контрактов («Платежи и объекты закупки»): каждая позиция — цена за единицу, количество, НДС. Можно вставить несколько карточек подряд. */
export function parseEisCards(text: string): EisContract[] {
  return text
    .split(/(?=№\s*\d{19}\s*\(Версия)/)
    .filter((c) => CARD_MARK.test(c))
    .flatMap((chunk): EisContract[] => {
      const regNumber = CARD_MARK.exec(chunk)![1];
      const header = chunk.search(/ЦЕНА\s+ЗА\s+ЕДИНИЦУ\s+ИЗМЕРЕНИЯ[^\n]*\n/i);
      if (header < 0) return [];
      const body = chunk.slice(chunk.indexOf("\n", header) + 1).split(/Платежные реквизиты|Итого\s*\(/)[0];
      const items = itemsOf(body);
      if (items.length === 0) return [];
      const contractNo = /Контракт\s*\n\s*№\s*([^\n]+)/.exec(chunk)?.[1]?.trim() ?? "";
      return [{ regNumber, contractNo, customer: field(chunk, "Заказчик"), signedAt: isoOfRu(field(chunk, "Заключение контракта")), items }];
    });
}

/** Список результатов поиска: общая цена контракта, без цены за единицу. */
export function parseEisList(text: string): EisListItem[] {
  return text
    .split(/(?=^№\s*\d{19}\s*\n\s*(?:Исполнение|Аннулирован))/m)
    .filter((c) => RECORD.test(c) && /Цена контракта/.test(c))
    .map((chunk) => ({
      regNumber: RECORD.exec(chunk)![1],
      contractNo: /Контракт\s*\n\s*№\s*([^\n]+)/.exec(chunk)?.[1]?.trim() ?? "",
      customer: field(chunk, "Заказчик"),
      objects: field(chunk, "Объекты закупки").replace(/\s*Посмотреть все.*$/i, ""),
      total: parseMoney(field(chunk, "Цена контракта")),
      signedAt: isoOfRu(field(chunk, "Заключение контракта")),
    }));
}

/** Позиции карточек → цены-аналоги кандидатами: цена за единицу как в карточке, дата заключения, источник — реестровый номер контракта. */
export function eisRows(contracts: EisContract[]): Built {
  const rows: ImportRow[] = [];
  const skipped: { line: number; reason: string }[] = [];
  const seen = new Set<string>();
  let truncated = 0;
  let line = 0;
  for (const c of contracts) {
    for (const it of c.items) {
      line++;
      const key = `${c.regNumber}|${it.unitPrice}|${it.detail}|${it.qty}`;
      if (seen.has(key)) {
        skipped.push({ line, reason: "повтор: такая позиция этого контракта уже есть выше" });
        continue;
      }
      seen.add(key);
      if (rows.length >= MAX_IMPORT) {
        truncated++;
        continue;
      }
      const problems: string[] = [];
      if (!c.signedAt) problems.push("нет даты заключения — впишите её после добавления");
      if (it.vat === null) problems.push("НДС в карточке не назван — проверьте, с НДС цена или без");
      rows.push({
        line,
        name: [it.name, it.detail].filter(Boolean).join(" · ").slice(0, 200),
        price: MONEY_OUT(it.unitPrice),
        date: c.signedAt,
        source: `ЕИС, контракт № ${c.regNumber}`,
        vat: it.vat,
        problems,
        detail: [it.qty && `${it.qty} ${it.unit}`.trim(), c.customer, c.contractNo && `контракт № ${c.contractNo}`].filter(Boolean).join(" · ").slice(0, 240),
      });
    }
  }
  return { rows, skipped, truncated };
}
