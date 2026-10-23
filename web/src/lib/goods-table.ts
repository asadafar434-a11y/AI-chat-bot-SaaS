// Таблица товаров из технических требований и технического задания заказчика: любая таблица, у которой в шапке есть название товара и количество (и единица измерения).
// Читает код по тексту документов, без ИИ; ищет только то, что в таблице есть, — названия и количества не придумываются. Бланк «Спецификация» читает spec-table.ts, сюда попадает то, что на него не похоже.

import { cellsOf, NMCK_CALC, numberOf, type SpecRow } from "@/lib/spec-table";

type Doc = { name: string; text: string };

export type GoodsTable = { doc: string; rows: SpecRow[] };

const NAME = /наименован/i;
// Это не таблица товаров: перечни документов, пункты, показатели, критерии.
const NOT_GOODS = /документ|пункт|показател|критери|услови|экземпляр|лист/i;
const GOODS_WORD = /товар|продукци|номенклатур|оборудован|материал|издели/i;
const QTY = /^(?:кол-?\s?во|количеств)/i;
const UNIT = /ед\.?\s*изм|единиц[а-яё]*\s+измерен|^ед\.?$/i;
const MAX_ROWS = 300;

type Header = { cells: number; name: number; qty: number; unit: number };

function headerOf(line: string): Header | null {
  const cells = cellsOf(line);
  if (cells.length < 3) return null;
  const name = cells.findIndex((c) => NAME.test(c) && !NOT_GOODS.test(c));
  const qty = cells.findIndex((c) => QTY.test(c));
  if (name < 0 || qty < 0 || name === qty) return null;
  const unit = cells.findIndex((c) => UNIT.test(c));
  if (unit < 0 && !GOODS_WORD.test(cells[name])) return null;
  return { cells: cells.length, name, qty, unit };
}

// «3», «3,5» или «3 шт.» — число и, если есть, единица рядом.
function qtyOf(cell: string): { qty: number; unit: string } | null {
  const whole = numberOf(cell);
  if (whole !== null) return whole > 0 ? { qty: whole, unit: "" } : null;
  const m = /^(\d+(?:[.,]\d+)?)\s*([а-яёa-z][а-яёa-z.²³/]{0,12})$/i.exec(cell);
  return m && Number(m[1].replace(",", ".")) > 0 ? { qty: Number(m[1].replace(",", ".")), unit: m[2] } : null;
}

export function findGoodsTable(documents: Doc[]): GoodsTable | null {
  for (const doc of documents) {
    if (NMCK_CALC.test(doc.text)) continue;
    const lines = doc.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const header = headerOf(lines[i]);
      if (!header) continue;
      const rows: SpecRow[] = [];
      for (let j = i + 1; j < lines.length && rows.length < MAX_ROWS; j++) {
        const line = lines[j];
        if (!line.trim()) continue;
        if (!line.includes(" | ") && !line.includes("\t")) break;
        const cells = cellsOf(line);
        if (cells.length !== header.cells) continue;
        const name = cells[header.name];
        const q = qtyOf(cells[header.qty]);
        if (!q || !/\p{L}{2}/u.test(name) || /^(итого|всего)(?![а-яё])/i.test(name)) continue;
        const unitCell = header.unit >= 0 ? cells[header.unit] : "";
        const unit = /\p{L}/u.test(unitCell) && unitCell.length <= 40 ? unitCell : q.unit;
        rows.push({ name, unit, qty: q.qty });
      }
      if (rows.length > 0) return { doc: doc.name, rows };
    }
  }
  return null;
}
