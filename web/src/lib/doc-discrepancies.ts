import { rubText, toKop } from "@/lib/price-split";

// Расхождения в цене внутри документов заказчика: расчёт НМЦД не сходится сам с собой или с извещением. Это повод для запроса разъяснений.
// Показываем только то, что касается цены: опечатки в номерах пунктов и названиях не выводим (правило владельца 18.10.2026: «без каши»).
// Читает код из расчёта, где есть «Итого без НДС», строка НДС и итоговая сумма; без ИИ.

type Doc = { name: string; text: string };

const EPS = 0.011; // копейка с запасом на плавающую точку
const MAX_NOTES = 4;

const cellsOf = (line: string) => (line.includes("\t") ? line.split("\t") : line.split(" | ")).map((c) => c.replace(/\s+/g, " ").trim());

function numberOf(cell: string): number | null {
  const t = cell.replace(/[\s ]/g, "").replace(",", ".");
  return /^-?\d+(?:\.\d+)?$/.test(t) ? Number(t) : null;
}

const lastNumber = (cells: string[]): number | null => {
  for (let i = cells.length - 1; i >= 1; i--) {
    const n = numberOf(cells[i]);
    if (n !== null) return n;
  }
  return null;
};

const rub = (value: number) => rubText(toKop(value));

type Calc = { net: number; rate: number; vat: number; total: number; rows: number[]; thousands: boolean };

function readCalc(text: string): Calc | null {
  let net: number | null = null;
  let vat: number | null = null;
  let rate: number | null = null;
  let total: number | null = null;
  const rows: number[] = [];
  for (const line of text.split(/\n/)) {
    const cells = cellsOf(line);
    const first = cells[0] ?? "";
    if (net === null && /^Итого\s+без\s+НДС/i.test(first)) net = lastNumber(cells);
    else if (vat === null && /^НДС\s*\(?\s*\d+\s*%/i.test(first)) {
      vat = lastNumber(cells);
      rate = Number(/(\d+)\s*%/.exec(first)![1]);
    } else if (total === null && /^(Стоимость\s+с\s+учет[а-яё]*\s+НДС|Итого\s+с\s+НДС|Всего\s+с\s+НДС)/i.test(first)) total = lastNumber(cells);
    else if (net === null && /^\d+$/.test(first) && cells.length >= 3 && !cells.every((c) => /^\d+$/.test(c))) {
      // Строка расчёта до «Итого»: № | основание | наименование | стоимость. Строка с номерами столбцов «1 | 2 | 3 | 4» сюда не попадает.
      const value = lastNumber(cells);
      if (value !== null) rows.push(value);
    }
  }
  if (net === null || vat === null || rate === null || total === null) return null;
  return { net, rate, vat, total, rows, thousands: /тыс\.?\s*руб/i.test(text) };
}

export function priceDiscrepancies(documents: Doc[], nmck: number | null): string[] {
  const out: string[] = [];
  for (const doc of documents) {
    if (!/Итого\s+без\s+НДС/i.test(doc.text)) continue;
    const c = readCalc(doc.text);
    if (!c) continue;
    const name = `«${doc.name}»`;
    if (nmck && Math.abs(c.total - nmck) > EPS) out.push(`${name}: итог расчёта ${rub(c.total)}, а начальная цена в извещении — ${rub(nmck)}`);
    if (c.rows.length > 0) {
      const sum = c.rows.reduce((a, b) => a + b, 0);
      if (Math.abs(sum - c.net) > EPS) out.push(`${name}: строки расчёта дают ${rub(sum)}, а «Итого без НДС» — ${rub(c.net)} (разница ${rub(Math.abs(c.net - sum))})`);
    }
    const expectedVat = (c.net * c.rate) / 100;
    if (Math.abs(expectedVat - c.vat) > EPS) out.push(`${name}: НДС ${c.rate} % от ${rub(c.net)} — ${rub(expectedVat)}, а в расчёте ${rub(c.vat)}`);
    if (Math.abs(c.net + c.vat - c.total) > EPS) out.push(`${name}: «Итого без НДС» и НДС дают ${rub(c.net + c.vat)}, а итоговая сумма — ${rub(c.total)}`);
    if (c.thousands && nmck && Math.abs(c.total - nmck) / nmck < 0.005) {
      out.push(`${name}: столбец назван «тыс. руб.», а числа в нём — в рублях (итог совпадает с начальной ценой в рублях)`);
    }
  }
  return out.slice(0, MAX_NOTES);
}
