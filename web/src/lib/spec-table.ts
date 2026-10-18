// Бланк заказчика «Спецификация» или «Расчёт цены»: позиции с количеством, которые победитель дополняет ценами за единицу, и начальные цены
// за единицу из расчёта НМЦК. Читает код по тексту документов, без ИИ; модуль без зависимостей от браузера и сервера.
// Бланк берём как есть: названия столбцов, ставку НДС из шапки и позиции — заказчик их уже заполнил, участнику остаются цены.

export type SpecRow = { name: string; unit: string; qty: number };
export type Specification = {
  // В каком файле найден бланк и как он назван в документе («СПЕЦИФИКАЦИЯ»).
  doc: string;
  title: string;
  // Названия столбцов, как в бланке; пусто, если шапку не удалось прочитать.
  columns: string[];
  rows: SpecRow[];
  // Ставка НДС, которая стоит в шапке («НДС, 5%» → 5); null — в шапке ставки нет.
  vatRate: number | null;
  // Есть ли в бланке столбцы цены: тогда победитель их заполняет.
  hasPrice: boolean;
};

type Doc = { name: string; text: string };

const HEADING = /^\s*(СПЕЦИФИКАЦИЯ|РАСЧ[ЕЁ]Т\s+ЦЕНЫ[^\n]{0,60})\s*$/i;
const STOP = /^\s*(итого|всего)(?![а-яё])/i;

// Ячейки строки: таблица Word после .doc — через табуляцию, после .docx и Excel — « | ».
const cellsOf = (line: string) => (line.includes("\t") ? line.split("\t") : line.split(" | ")).map((c) => c.replace(/\s+/g, " ").trim());

const NUMBER = /^\d+(?:[.,]\d+)?$/;
const numberOf = (text: string) => (NUMBER.test(text) ? Number(text.replace(",", ".")) : null);

// Строка позиции: название, единица и количество в конце; номер строки впереди — необязателен.
function rowOf(line: string): SpecRow | null {
  if (STOP.test(line)) return null;
  const cells = cellsOf(line);
  while (cells.length && !cells[cells.length - 1]) cells.pop();
  if (cells.length < 2) return null;
  const qty = numberOf(cells[cells.length - 1]);
  if (qty === null || qty <= 0) return null;
  const rest = cells.slice(0, -1);
  const body = rest.length > 1 && numberOf(rest[0]) !== null ? rest.slice(1) : rest;
  const name = body[0] ?? "";
  if (!/\p{L}{2}/u.test(name)) return null;
  const unit = body.length > 1 ? body[body.length - 1] : "";
  return { name, unit: /\p{L}/u.test(unit) && unit.length <= 40 ? unit : "", qty };
}

// Шапка, склеенная из строк: ячейки в .doc перенесены по словам («Кол-» / «во»), поэтому режем по табуляции, а не по строкам.
function columnsOf(header: string[]): string[] {
  const joined = header.join("\n");
  // Без табуляции (Word .docx, Excel) шапка — одна строка « | »: берём самую широкую, а не пояснения над таблицей.
  const widest = [...header].sort((a, b) => b.split(" | ").length - a.split(" | ").length)[0] ?? "";
  const cells = joined.includes("\t") ? joined.split("\t") : widest.split(" | ");
  return cells.map((c) => c.replace(/\s*\n\s*/g, " ").replace(/(\p{L})-\s+(\p{L})/gu, "$1-$2").replace(/\s+/g, " ").trim()).filter(Boolean);
}

export function findSpecification(documents: Doc[]): Specification | null {
  for (const doc of documents) {
    const lines = doc.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!HEADING.test(lines[i])) continue;
      const header: string[] = [];
      const rows: SpecRow[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j];
        if (!line.trim()) continue;
        const row = /кол|количеств/i.test(header.join(" ")) ? rowOf(line) : null;
        if (row) {
          rows.push(row);
        } else if (rows.length === 0 && header.length < 16) {
          header.push(line);
        } else {
          break;
        }
      }
      if (rows.length === 0) continue;
      const head = header.join("\n");
      const vat = /НДС[^\d]{0,5}(\d{1,2})\s*%/i.exec(head);
      return {
        doc: doc.name,
        title: lines[i].trim(),
        columns: columnsOf(header),
        rows,
        vatRate: vat ? Number(vat[1]) : null,
        hasPrice: /цен/i.test(head),
      };
    }
  }
  return null;
}

// ——— Начальные цены за единицу из расчёта НМЦК ———

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

// Строка расчёта: название позиции, количество и пары «цена за единицу — сумма». Начальная цена — последняя пара, в которой цена × количество = сумма:
// так её узнаёшь без шапки. Цены поставщиков стоят в таблице раньше и в расчёт НМЦК не входят.
export function baseUnitPrices(rows: SpecRow[], documents: Doc[]): number[] | null {
  const found = rows.map((row) => {
    const name = norm(row.name);
    for (const doc of documents) {
      for (const line of doc.text.split("\n")) {
        if (!line.includes(" | ")) continue;
        const cells = cellsOf(line);
        const at = cells.slice(0, 3).findIndex((c) => norm(c) === name);
        if (at < 0) continue;
        const numbers = cells.slice(at + 1).map(numberOf);
        let price: number | null = null;
        for (let k = 0; k + 1 < numbers.length; k++) {
          const unit = numbers[k];
          const sum = numbers[k + 1];
          if (unit !== null && sum !== null && unit > 0 && Math.abs(unit * row.qty - sum) <= 0.01 + sum * 1e-9) price = unit;
        }
        if (price !== null) return price;
      }
    }
    return null;
  });
  return found.every((p) => p !== null) ? (found as number[]) : null;
}
