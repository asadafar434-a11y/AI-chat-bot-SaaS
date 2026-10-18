// Совместная закупка: у каждого заказчика свой договор и своё максимальное значение цены (детские сады Семикаракорска: девять договоров,
// в сумме 17 млн ₽). Читает код по таблице документов «Максимальное значение цены контракта каждого заказчика», без ИИ;
// модуль без зависимостей от браузера и сервера. Нет такой таблицы — один заказчик, ничего не придумываем.
import { rubText, toKop } from "@/lib/price-split";
import { cellsOf, numberOf } from "@/lib/spec-table";

type Doc = { name: string; text: string };
export type CustomerRow = { name: string; short: string; max: number };
export type Customers = { doc: string; rows: CustomerRow[]; total: number };

const HEADER = /максимальн[а-яё]*\s+значени[а-яё]*\s+цен[а-яё]*[^|]{0,60}заказчик/i;

// Название для строки: что в кавычках («Родничок»), иначе название целиком.
const shortOf = (name: string) => /«([^»]+)»/.exec(name)?.[1].trim() ?? name;

export function findCustomers(documents: Doc[]): Customers | null {
  for (const doc of documents) {
    const lines = doc.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!HEADER.test(lines[i])) continue;
      const rows: CustomerRow[] = [];
      for (let j = i + 1; j < Math.min(lines.length, i + 80); j++) {
        if (!lines[j].includes(" | ")) {
          if (rows.length > 0) break;
          continue;
        }
        const cells = cellsOf(lines[j]);
        const name = cells.find((c) => (c.match(/\p{L}/gu) ?? []).length >= 10);
        const max = cells.map(numberOf).filter((n): n is number => n !== null && n >= 1000).at(-1);
        if (name && max !== undefined) rows.push({ name, short: shortOf(name), max });
        else if (rows.length > 0) break;
      }
      if (rows.length >= 2) return { doc: doc.name, rows, total: rows.reduce((sum, r) => sum + toKop(r.max), 0) / 100 };
    }
  }
  return null;
}

// «2,2 млн», «950 тыс.»: для строки пометки, где перечень должен быть коротким.
const short = (value: number) => (value >= 1_000_000 ? `${(value / 1_000_000).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} млн` : `${(value / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} тыс.`);

// Пометки для шага «Цена»: кто заказчики, максимум цены по договору, обеспечение по каждому договору и сверка суммы с начальной ценой закупки.
export function customersNotes(documents: Doc[], opts: { nmck: number | null; securityPct: number | null }): string[] {
  const found = findCustomers(documents);
  if (!found) return [];
  const { rows, total } = found;
  const notes = [
    `Заказчиков ${rows.length}, у каждого свой договор. Максимум цены: ${rows.map((r) => `«${r.short}» ${short(r.max)}`).join("; ")} — всего ${rubText(toKop(total))}`,
  ];
  if (opts.nmck && Math.abs(opts.nmck - total) > 0.01) {
    notes.push(`Сумма максимумов ${rubText(toKop(total))} не равна начальной цене закупки ${rubText(toKop(opts.nmck))} — сверьте с документами`);
  }
  if (opts.securityPct && opts.securityPct > 0) {
    const maxes = rows.map((r) => (r.max * opts.securityPct!) / 100);
    notes.push(`Обеспечение исполнения ${opts.securityPct} % считается по каждому договору: от ${rubText(toKop(Math.min(...maxes)))} до ${rubText(toKop(Math.max(...maxes)))}`);
  }
  return notes;
}
