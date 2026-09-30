import "server-only";
import pdfmake from "pdfmake";
import roboto from "pdfmake/fonts/Roboto.js";
import type { PartDoc } from "@/lib/part-doc";
import { modelOfPartDoc, modelOfTp, type Block, type Cell, type DocModel, type Para, type Run, type Table, type TpDocx } from "@/lib/tp-doc-model";
import type { TpPart } from "@/lib/tp-parts";

// Файл PDF — из того же описания документа (tp-doc-model.ts), что и Word: тот же текст, те же таблицы, те же жёлтые места.
// Шрифт Roboto поставляется вместе с pdfmake, в нём есть русские буквы. Всё, что не шрифт, библиотеке закрыто: она не
// ходит по адресам и не читает чужие файлы, даже если их названия окажутся в тексте документа.
pdfmake.setFonts(roboto);
const FONT_FILES = new Set(Object.values(roboto.Roboto));
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((file) => FONT_FILES.has(file));

const YELLOW = "#ffff00";

// Ширина страницы за вычетом полей (A4, поля 3 и 1,5 см), отступы внутри ячейки и кегль по умолчанию — в пунктах.
const CONTENT_WIDTH = 595.28 - 85.05 - 42.5;
const CELL_PADDING = 5;
const BASE_SIZE = 12;

// Ширина слова на глаз — по средней ширине знаков Roboto. Нужна, чтобы узкий столбец не ломал слова посередине: Word сам
// раздвигает такой столбец, а pdfmake держит заданную ширину.
function wordWidth(word: string, size: number, bold: boolean): number {
  let em = 0;
  for (const ch of word) {
    em += /[А-ЯЁA-Z]/.test(ch) ? 0.68 : /[а-яёa-z]/.test(ch) ? 0.56 : /\d/.test(ch) ? 0.57 : ch === "№" ? 0.95 : /[.,;:!]/.test(ch) ? 0.27 : /[()[\]«»"/-]/.test(ch) ? 0.36 : 0.6;
  }
  return em * size * (bold ? 1.06 : 1) * 1.04;
}

// Сколько места нужно ячейке, чтобы самое длинное слово в ней поместилось целиком.
function cellNeed(c: Cell): number {
  let need = 0;
  for (const p of c.paras) {
    for (const r of p.runs) {
      for (const word of r.text.split(/\s+/)) need = Math.max(need, wordWidth(word, r.size ?? BASE_SIZE, r.bold === true));
    }
  }
  return need + 2 * CELL_PADDING + 1;
}

// Столбцы — в заданных долях, но тесным добавляем за счёт тех, у кого есть запас; слова целиком, как в Word.
function columnWidths(t: Table): number[] {
  const preferred = t.rows[0].cells.map((c) => (c.width / 100) * CONTENT_WIDTH);
  const need = preferred.map((_, i) => Math.max(...t.rows.map((r) => (r.cells[i] ? cellNeed(r.cells[i]) : 0))));
  const widths = preferred.map((w, i) => Math.max(w, need[i]));
  let extra = widths.reduce((a, b) => a + b, 0) - CONTENT_WIDTH;
  for (let pass = 0; pass < 4 && extra > 0.01; pass++) {
    const slack = widths.map((w, i) => Math.max(0, w - need[i]));
    const total = slack.reduce((a, b) => a + b, 0);
    if (total <= 0) break;
    const cut = Math.min(extra, total);
    slack.forEach((s, i) => (widths[i] -= (s / total) * cut));
    extra -= cut;
  }
  // Всё равно не помещается — сжимаем все столбцы поровну, слова придётся переносить.
  const sum = widths.reduce((a, b) => a + b, 0);
  return sum > CONTENT_WIDTH ? widths.map((w) => (w * CONTENT_WIDTH) / sum) : widths;
}

const runNode = (r: Run) => ({
  text: r.text,
  ...(r.bold && { bold: true }),
  ...(r.italics && { italics: true }),
  ...(r.size && { fontSize: r.size }),
  ...(r.highlight && { background: YELLOW }),
});

// margin: слева, сверху, справа, снизу — как отступы абзаца в описании документа.
const paraNode = (p: Para) => ({
  text: p.runs.length ? p.runs.map(runNode) : "",
  ...(p.align && { alignment: p.align }),
  ...(p.firstLine && { leadingIndent: p.firstLine }),
  margin: [p.left ?? 0, p.before ?? 0, 0, p.after ?? 0],
});

const cellNode = (c: Cell) => (c.paras.length > 1 ? { stack: c.paras.map(paraNode) } : c.paras.length === 1 ? paraNode(c.paras[0]) : { text: "" });

const tableNode = (t: Table) => ({
  table: {
    // Заголовок таблицы повторяется на каждой странице, как в Word.
    headerRows: t.rows[0]?.header ? 1 : 0,
    widths: columnWidths(t),
    body: t.rows.map((row) => row.cells.map(cellNode)),
  },
  layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, paddingLeft: () => CELL_PADDING, paddingRight: () => CELL_PADDING, paddingTop: () => 3, paddingBottom: () => 3 },
});

const block = (b: Block) => (b.type === "table" ? tableNode(b) : paraNode(b));

const render = (model: DocModel) =>
  pdfmake
    .createPdf({
      info: { title: model.title },
      pageSize: "A4",
      // Поля — как в Word: сверху и снизу 2 см, слева 3 см, справа 1,5 см.
      pageMargins: [85.05, 56.7, 42.5, 56.7],
      defaultStyle: { font: "Roboto", fontSize: 12, lineHeight: 1.15 },
      content: model.blocks.map(block),
    })
    .getBuffer();

export const buildTpPdf = (part: TpPart, data: TpDocx): Promise<Buffer> => render(modelOfTp(part, data));

// Анкета, декларация или цена, которые ИИ написал по форме заказчика и образцам участника.
export const buildPartPdf = (doc: PartDoc): Promise<Buffer> => render(modelOfPartDoc(doc));
