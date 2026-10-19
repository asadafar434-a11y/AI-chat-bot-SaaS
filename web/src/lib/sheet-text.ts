// Таблицы Excel в текст: общая часть для .xlsx (xlsx-text.ts) и старого .xls (xls-reader.ts). Лист — строки, строка — одна строка текста, ячейки через « | ».
// Так ИИ видит, какое значение в какой колонке, а цитата из таблицы находится в тексте. Пустые строки и колонки пропускаем. Для каждой ячейки запоминается
// лист и адрес («C17»): по нему видно, откуда значение. Модуль без зависимостей от браузера и сервера.
import { TextBuilder, type DocMap } from "@/lib/doc-source";

export type SheetCell = { text: string; address: string; col: number };
// hiddenCols — номера скрытых в файле столбцов (с 1); visible — лист не скрыт; hiddenRows — сколько строк с содержимым скрыто.
export type SheetData = { name: string; visible: boolean; rows: SheetCell[][]; hiddenRows: number; hiddenCols: number[] };

export const cleanText = (text: string) => text.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
// Число как в таблице: запятая, без хвоста округления.
export const numberText = (value: number) => String(Math.round(value * 1e9) / 1e9).replace(".", ",");

// Меню и графики: дни идут по столбцам («1 день», «2 день»…). Построчно блюда разных дней слиплись бы в одну строку, поэтому под такой
// шапкой каждый день выписывается отдельным блоком: «### 1 день», дальше его строки. Шапка — три дня и больше в одной строке.
const DAY = /^(?:\d{1,2}\s*день|день\s*\d{1,2})$/i;
const dayHeader = (row: SheetCell[]) => {
  const days = row.filter((c) => DAY.test(c.text)).map((c) => ({ col: c.col, label: c.text }));
  return days.length >= 3 ? days : null;
};

// hidden — что в файле скрыто: лист, строки, столбцы с содержимым. Лист скрыт — в текст он не попадает; заказчики нередко запрещают скрытое.
export function sheetsText(sheets: SheetData[]): { text: string; map?: DocMap; hidden: string[] } {
  const b = new TextBuilder();
  const hidden: string[] = [];
  let first = true;
  for (const sheet of sheets) {
    if (!sheet.visible) {
      hidden.push(`лист «${sheet.name}» скрыт`);
      continue;
    }
    const rows = sheet.rows;
    if (rows.length === 0) continue;
    if (sheet.hiddenRows > 0) hidden.push(`на листе «${sheet.name}» скрыты строки: ${sheet.hiddenRows}`);
    const hiddenCols = sheet.hiddenCols.filter((col) => rows.some((r) => r[col - 1]?.text)).length;
    if (hiddenCols > 0) hidden.push(`на листе «${sheet.name}» скрыты столбцы: ${hiddenCols}`);

    // Колонки, пустые во всех строках, выбрасываем, чтобы не плодить « |  |  | ».
    const width = Math.max(...rows.map((r) => r.length));
    const used = Array.from({ length: width }, (_, col) => rows.some((r) => r[col]?.text));

    if (!first) b.raw("\n\n");
    first = false;
    b.add(`## Лист «${sheet.name}»`, { sheet: sheet.name });
    // Строки под шапкой «1 день | 2 день | …» копятся и выписываются по дням, когда шапка сменится или лист кончится.
    let days: { col: number; label: string }[] | null = null;
    let section: SheetCell[][] = [];
    const flush = () => {
      if (!days) return;
      days.forEach((day, k) => {
        const to = days![k + 1]?.col ?? Infinity;
        const mine = section.map((row) => row.filter((c) => c.text && c.col >= day.col && c.col < to)).filter((cells) => cells.length > 0);
        if (mine.length === 0) return;
        b.raw("\n### ");
        b.add(day.label, { sheet: sheet.name });
        for (const cells of mine) {
          b.raw("\n");
          cells.forEach((cell, i) => {
            if (i > 0) b.raw(" | ");
            b.add(cell.text, { sheet: sheet.name, cell: cell.address });
          });
        }
      });
      section = [];
    };
    for (const row of rows) {
      const header = dayHeader(row);
      if (header) {
        flush();
        days = header;
        continue;
      }
      if (days) {
        section.push(row);
        continue;
      }
      b.raw("\n");
      const kept = row.filter((_, col) => used[col]);
      let last = kept.length - 1;
      while (last >= 0 && !kept[last].text) last--;
      kept.slice(0, last + 1).forEach((cell, k) => {
        if (k > 0) b.raw(" | ");
        b.add(cell.text, { sheet: sheet.name, cell: cell.address });
      });
    }
    flush();
  }
  return { ...b.build(), hidden };
}
