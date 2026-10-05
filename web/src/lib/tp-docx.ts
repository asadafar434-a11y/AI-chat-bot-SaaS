import "server-only";
import { AlignmentType, Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import type { PartDoc } from "@/lib/part-doc";
import { modelOfPartDoc, modelOfTp, type Block, type Cell, type DocModel, type Para, type Row, type Run, type Table as TableBlock, type TpDocx } from "@/lib/tp-doc-model";
import type { TpPart } from "@/lib/tp-parts";

// Файл Word — из описания документа (tp-doc-model.ts): что в нём написано, решает оно, здесь только оформление.
export type { CastLine, TpDocx } from "@/lib/tp-doc-model";

const FONT = "Times New Roman";
// Отступы в описании — в пунктах, Word считает их двадцатыми долями пункта.
const twips = (pt: number) => Math.round(pt * 20);

const textRun = (r: Run) =>
  new TextRun({ text: r.text, font: FONT, size: Math.round((r.size ?? 12) * 2), bold: r.bold, italics: r.italics, highlight: r.highlight ? "yellow" : undefined });

const paragraph = (p: Para) =>
  new Paragraph({
    spacing:
      p.before !== undefined || p.after !== undefined
        ? { ...(p.before !== undefined && { before: twips(p.before) }), ...(p.after !== undefined && { after: twips(p.after) }) }
        : undefined,
    alignment: p.align === "center" ? AlignmentType.CENTER : p.align === "justify" ? AlignmentType.JUSTIFIED : p.align === "right" ? AlignmentType.RIGHT : undefined,
    indent:
      p.firstLine !== undefined || p.left !== undefined
        ? { ...(p.firstLine !== undefined && { firstLine: twips(p.firstLine) }), ...(p.left !== undefined && { left: twips(p.left) }) }
        : undefined,
    children: p.runs.map(textRun),
  });

const tableCell = (c: Cell) =>
  new TableCell({
    width: { size: c.width, type: WidthType.PERCENTAGE },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: c.paras.length ? c.paras.map(paragraph) : [new Paragraph("")],
  });

const tableRow = (row: Row) => new TableRow({ tableHeader: row.header ? true : undefined, children: row.cells.map(tableCell) });

const table = (t: TableBlock) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: t.rows.map(tableRow) });

const block = (b: Block) => (b.type === "table" ? table(b) : paragraph(b));

const render = (model: DocModel) =>
  Packer.toBuffer(
    new Document({
      sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1701, right: 850 } } }, children: model.blocks.map(block) }],
    })
  );

export const buildTpDocx = (part: TpPart, data: TpDocx): Promise<Buffer> => render(modelOfTp(part, data));

// Анкета, декларация или цена, которые ИИ написал по форме заказчика и образцам участника.
export const buildPartDocx = (doc: PartDoc): Promise<Buffer> => render(modelOfPartDoc(doc));
