// Закупка длиннее предела запроса к ИИ (chat-types.ts): вместо отказа «документы слишком большие» самые большие таблицы-справочники
// (ассортиментный перечень на сотни строк, меню на десять дней) заменяются короткой пометкой. Остальной текст идёт как есть.
// Сработает только когда общий объём больше предела: обычные закупки не меняются ни на знак.
// Зачем так: требования закупки лежат в обычном тексте, а перечень из 308 продуктов их не содержит — и занимает 235 тысяч знаков из 278.
import { MAX_CONTEXT_CHARS } from "@/lib/chat-types";

// Таблица считается справочником, если она длинная и по строкам, и по знакам: короткая таблица цен или критериев остаётся.
export const MIN_BLOCK_CHARS = 20_000;
export const MIN_BLOCK_ROWS = 40;

type Doc = { name: string; text: string };
export type TrimNote = { name: string; rows: number; chars: number };
type Block = { doc: number; from: number; to: number; rows: number; stub: string };

const cut = (line: string, max = 200) => (line.length > max ? `${line.slice(0, max)}…` : line);

function stubOf(rows: number, chars: number, head: string[]): string {
  const k = Math.round(chars / 1000).toLocaleString("ru-RU");
  return `[Таблица на ${rows} строк (${k} тыс. знаков) в запрос не включена: документы закупки длиннее предела. Начало таблицы: ${head.map((l) => `«${cut(l)}»`).join(" / ")}. Что в остальных строках, неизвестно — выводов о них не делать.]`;
}

// Таблицы читалок Word, Excel и PDF — строки «а | б | в». Пустые строки таблицу не прерывают, любой другой текст — прерывает.
function blocksOf(text: string, doc: number): Block[] {
  const blocks: Block[] = [];
  let start = -1;
  let end = -1;
  let rows = 0;
  let head: string[] = [];
  const close = () => {
    if (start >= 0 && rows >= MIN_BLOCK_ROWS && end - start >= MIN_BLOCK_CHARS) {
      blocks.push({ doc, from: start, to: end, rows, stub: stubOf(rows, end - start, head) });
    }
    start = -1;
    rows = 0;
    head = [];
  };
  let at = 0;
  for (const line of text.split("\n")) {
    const lineStart = at;
    at += line.length + 1;
    if (line.includes(" | ")) {
      if (start < 0) start = lineStart;
      end = lineStart + line.length;
      rows++;
      if (head.length < 3) head.push(line);
    } else if (line.trim() !== "") {
      close();
    }
  }
  close();
  return blocks;
}

// Документы, которые помещаются в предел: если закупка уже помещается, возвращаются те же самые объекты.
export function fitDocuments<T extends Doc>(documents: T[], limit = MAX_CONTEXT_CHARS): { documents: T[]; notes: TrimNote[] } {
  let total = documents.reduce((sum, d) => sum + d.text.length, 0);
  if (total <= limit) return { documents, notes: [] };

  // Сначала самые большие: убрать как можно меньше.
  const all = documents.flatMap((d, i) => blocksOf(d.text, i)).sort((a, b) => b.to - b.from - (a.to - a.from));
  const chosen: Block[] = [];
  for (const block of all) {
    if (total <= limit) break;
    chosen.push(block);
    total -= block.to - block.from - block.stub.length;
  }
  if (chosen.length === 0) return { documents, notes: [] };

  const fitted = documents.map((d, i) => {
    const mine = chosen.filter((b) => b.doc === i).sort((a, b) => b.from - a.from);
    if (mine.length === 0) return d;
    let text = d.text;
    for (const b of mine) text = text.slice(0, b.from) + b.stub + text.slice(b.to);
    return { ...d, text };
  });
  const notes = chosen
    .sort((a, b) => a.doc - b.doc || a.from - b.from)
    .map((b) => ({ name: documents[b.doc].name, rows: b.rows, chars: b.to - b.from }));
  return { documents: fitted, notes };
}

// Что сказать человеку: часть текста закупки ИИ не увидел.
export function trimWarning(documents: Doc[], limit = MAX_CONTEXT_CHARS): string | null {
  const { notes } = fitDocuments(documents, limit);
  if (notes.length === 0) return null;
  const parts = notes.map((n) => `«${n.name}» — таблица на ${n.rows} строк (${Math.round(n.chars / 1000).toLocaleString("ru-RU")} тыс. знаков)`);
  return `Закупка длиннее предела запроса к ИИ, поэтому ИИ не увидел: ${parts.join("; ")}. Что требует заказчик, он прочитал, а по этим строкам выводов нет — сверьте их сами.`;
}
