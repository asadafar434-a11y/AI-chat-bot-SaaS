// Таблицы старого Word (.doc) с объединёнными ячейками читаются плоско: ячейки стоят через табуляцию, но заголовки, растянутые на несколько столбцов,
// и числа под ними попадают в строки с разным числом ячеек, и столбцы приходится сопоставлять по порядку. Находим такие таблицы по числу ячеек в строках
// и предупреждаем — на «Проверке», рядом с предупреждением о сканах и об урезанных таблицах. Текст при этом не меняем: его читают и разбор бланков, и ИИ.

type Doc = { name: string; text: string };

const MIN_ROWS = 3; // строк с ячейками в блоке
const MIN_DISTINCT = 3; // разных чисел ячеек
const MIN_SPREAD = 4; // разница между самой узкой и самой широкой строкой
const MAX_NAMES = 3;

// Блок таблицы: строки с табуляциями; между ними бывают до двух строк-продолжений ячейки без табуляции.
function tableBlocks(text: string): string[][] {
  const lines = text.split("\n");
  const blocks: string[][] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].includes("\t")) {
      i++;
      continue;
    }
    let last = i;
    for (let j = i; j < lines.length; j++) {
      if (lines[j].includes("\t")) last = j;
      else if (j - last > 2) break;
    }
    blocks.push(lines.slice(i, last + 1).filter((l) => l.includes("\t")));
    i = last + 1;
  }
  return blocks;
}

export function flatTableCount(text: string): number {
  return tableBlocks(text).filter((rows) => {
    if (rows.length < MIN_ROWS) return false;
    const counts = [...new Set(rows.map((r) => r.split("\t").length))].sort((a, b) => a - b);
    return counts.length >= MIN_DISTINCT && counts[counts.length - 1] - counts[0] >= MIN_SPREAD;
  }).length;
}

export function flatTableWarning(documents: Doc[]): string | null {
  const names = documents.filter((d) => /\.doc$/i.test(d.name) && flatTableCount(d.text) > 0).map((d) => d.name);
  if (names.length === 0) return null;
  const shown = names.slice(0, MAX_NAMES).map((n) => `«${n}»`).join(", ");
  const more = names.length > MAX_NAMES ? ` и ещё ${names.length - MAX_NAMES}` : "";
  return `В ${shown}${more} есть таблица с объединёнными ячейками в старом формате .doc: она прочитана плоско, и значения могут оказаться не под своими заголовками. Сверьте её с оригиналом (или пересохраните файл как .docx — тогда таблица читается по ячейкам).`;
}
