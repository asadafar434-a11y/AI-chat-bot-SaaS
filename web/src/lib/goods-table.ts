// Таблица товаров из технических требований и технического задания заказчика: любая таблица, у которой в шапке есть название товара (или МНН, объект закупки) и количество (и единица измерения).
// Читает код по тексту документов, без ИИ; ищет только то, что в таблице есть, — названия и количества не придумываются. Бланк «Спецификация» читает spec-table.ts, сюда попадает то, что на него не похоже.
// Старый .doc: ячейки через табуляцию, шапка может быть разорвана на две строки («Ед.» / «изм.»), в строке данных бывает меньше ячеек, чем в шапке — последний столбец ушёл на следующую строку.

import { cellsOf, NMCK_CALC, numberOf, type SpecRow } from "@/lib/spec-table";

type Doc = { name: string; text: string };

export type GoodsTable = { doc: string; rows: SpecRow[] };

const NAME = /наименован|(?:^|[^а-яё])мнн(?![а-яё])|объект\s+закупки|товар/i;
// Это не таблица товаров: перечни документов, пункты, показатели, критерии.
const NOT_GOODS = /документ|пункт|показател|критери|услови|экземпляр|лист/i;
const GOODS_WORD = /товар|продукци|номенклатур|оборудован|материал|издели|мнн|объект\s+закупки/i;
const QTY = /^(?:кол-?\s?во|количеств)/i;
const UNIT = /ед\.?\s*изм|единиц[а-яё]*\s+измерен|^ед\.?$/i;
// Столбец, который уточняет название товара: дозировка и форма препарата, марка, модель.
const DETAIL = /дозировк|лекарственн[а-яё]+\s+форм|характеристик|марка|модель|типоразмер/i;
const MAX_ROWS = 300;
// Заголовок документа — первые строки: «Обоснование начальной (максимальной) цены…» там — это отдельный файл расчёта, а не раздел общей документации.
const NMCK_HEAD_LINES = 3;

type Header = { cells: number; name: number; qty: number; unit: number; detail: number };

function headerOf(cells: string[]): Header | null {
  if (cells.length < 3) return null;
  const name = cells.findIndex((c) => NAME.test(c) && !NOT_GOODS.test(c));
  const qty = cells.findIndex((c) => QTY.test(c));
  if (name < 0 || qty < 0 || name === qty) return null;
  const unit = cells.findIndex((c) => UNIT.test(c));
  if (unit < 0 && !GOODS_WORD.test(cells[name])) return null;
  const detail = cells.findIndex((c, i) => i === name + 1 && DETAIL.test(c));
  return { cells: cells.length, name, qty, unit, detail };
}

// Шапка из двух строк: ячейка, оборванная на конце первой строки, продолжается в начале второй («Ед.» + «изм.»).
function joinedCells(first: string, second: string): string[] | null {
  if (!first.includes("\t") || !second.includes("\t")) return null;
  const a = cellsOf(first);
  const b = cellsOf(second);
  if (a.length === 0 || b.length === 0) return null;
  return [...a.slice(0, -1), `${a[a.length - 1]} ${b[0]}`.trim(), ...b.slice(1)];
}

// «3», «3,5» или «3 шт.» — число и, если есть, единица рядом.
function qtyOf(cell: string): { qty: number; unit: string } | null {
  const whole = numberOf(cell);
  if (whole !== null) return whole > 0 ? { qty: whole, unit: "" } : null;
  const m = /^(\d+(?:[.,]\d+)?)\s*([а-яёa-z][а-яёa-z.²³/]{0,12})$/i.exec(cell);
  return m && Number(m[1].replace(",", ".")) > 0 ? { qty: Number(m[1].replace(",", ".")), unit: m[2] } : null;
}

// Документ — это расчёт обоснования НМЦ заказчика (отдельный файл): цены его поставщиков позициями участника не считаем.
// Если раздел «Обоснование НМЦ» — только часть общей документации, документ целиком не отбрасывается.
const isNmckDoc = (doc: Doc) => {
  if (/нмц|обоснован/i.test(doc.name)) return true;
  // «Раздел 4. Обоснование начальной цены…» — заголовок раздела общей документации, а не названия файла расчёта.
  const head = doc.text.split("\n").filter((l) => l.trim() && !/^\s*(раздел|глава|часть)\s/i.test(l)).slice(0, NMCK_HEAD_LINES).join(" ");
  return NMCK_CALC.test(head) || /обоснование\s+нмц/i.test(head);
};

export function findGoodsTable(documents: Doc[]): GoodsTable | null {
  for (const doc of documents) {
    if (isNmckDoc(doc)) continue;
    const lines = doc.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      let header = headerOf(cellsOf(lines[i]));
      let start = i + 1;
      if (!header && i + 1 < lines.length) {
        const joined = joinedCells(lines[i], lines[i + 1]);
        header = joined ? headerOf(joined) : null;
        start = i + 2;
      }
      if (!header) continue;
      const rows: SpecRow[] = [];
      let gap = 0;
      for (let j = start; j < lines.length && rows.length < MAX_ROWS; j++) {
        const line = lines[j];
        if (!line.trim()) continue;
        if (!line.includes(" | ") && !line.includes("\t")) {
          // Объединённая ячейка (например, «Не менее 12 месяцев») легла отдельной строкой: одну такую строку пропускаем, две подряд — таблица кончилась.
          if (rows.length === 0 || ++gap > 1) break;
          continue;
        }
        gap = 0;
        const cells = cellsOf(line);
        // В строке может быть меньше ячеек, чем в шапке (последний столбец на следующей строке), но не больше и не меньше, чем нужно до количества.
        if (cells.length > header.cells || cells.length <= header.qty) continue;
        const base = cells[header.name];
        const detail = header.detail >= 0 ? cells[header.detail] : "";
        const name = (detail && /\p{L}|\d/u.test(detail) ? `${base} ${detail}` : base).replace(/\s+/g, " ").trim();
        const q = qtyOf(cells[header.qty]);
        if (!q || !/\p{L}{2}/u.test(base) || /^(итого|всего)(?![а-яё])/i.test(base)) continue;
        const unitCell = header.unit >= 0 ? cells[header.unit] : "";
        const unit = /\p{L}/u.test(unitCell) && unitCell.length <= 40 ? unitCell : q.unit;
        rows.push({ name, unit, qty: q.qty });
      }
      if (rows.length > 0) return { doc: doc.name, rows };
    }
  }
  return null;
}
