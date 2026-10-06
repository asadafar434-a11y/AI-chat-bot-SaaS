// Разбиение текста документа на логические фрагменты. Граница — абзац, а не произвольные N знаков:
// фрагмент не режет предложение, статья не сливается с соседней. Заголовок (статья, глава, пункт) сохраняется
// и идёт в индекс вместе с текстом, чтобы поиск находил «ст. 12» по номеру и названию статьи.

export const CHUNK_MAX = 1200;

export type RawChunk = { heading: string | null; text: string };

// Строка-заголовок: короткая, и начинается со слова «Статья», «Глава», «Раздел» или с номера пункта («2.4.1», «3.»).
const HEADING = /^(статья|глава|раздел|приложение|часть|пункт)\s+\S|^\d+(\.\d+)*\.?\s+\S/i;
const HEADING_MAX = 160;

const isHeading = (block: string) => block.length <= HEADING_MAX && !block.includes("\n") && HEADING.test(block);

// Абзац длиннее лимита — по предложениям; предложение длиннее лимита — по знакам, но не по середине слова.
function splitLong(paragraph: string, max: number): string[] {
  if (paragraph.length <= max) return [paragraph];
  const sentences = paragraph.split(/(?<=[.;!?])\s+/);
  const out: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (sentence.length > max) {
      if (current) {
        out.push(current);
        current = "";
      }
      for (let from = 0; from < sentence.length; ) {
        let to = Math.min(sentence.length, from + max);
        if (to < sentence.length) {
          const space = sentence.lastIndexOf(" ", to);
          if (space > from) to = space;
        }
        out.push(sentence.slice(from, to).trim());
        from = to;
      }
      continue;
    }
    const joined = current ? `${current} ${sentence}` : sentence;
    if (joined.length > max) {
      out.push(current);
      current = sentence;
    } else current = joined;
  }
  if (current) out.push(current);
  return out.filter(Boolean);
}

/** Текст → фрагменты. Пустой текст — пустой список. Порядок фрагментов совпадает с порядком в документе. */
export function chunkText(text: string, max = CHUNK_MAX): RawChunk[] {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/[ \t ]+\n/g, "\n");
  const blocks = normalized.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const chunks: RawChunk[] = [];
  let heading: string | null = null;
  let current = "";

  const flush = () => {
    if (current) chunks.push({ heading, text: current });
    current = "";
  };

  for (const block of blocks) {
    if (isHeading(block)) {
      flush();
      heading = block;
      continue;
    }
    for (const piece of splitLong(block, max)) {
      const joined = current ? `${current}\n\n${piece}` : piece;
      if (joined.length > max) {
        flush();
        current = piece;
      } else current = joined;
    }
  }
  flush();
  return chunks;
}
