import {
  AlignmentType,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

export type TpDocxItem = { clause: string; requirement: string; offer: string };

const FONT = "Times New Roman";
const run = (text: string, options: { bold?: boolean; highlight?: "yellow"; size?: number } = {}) =>
  new TextRun({ text, font: FONT, size: options.size ?? 24, bold: options.bold, highlight: options.highlight });

// Незаполненные поля «[…]» остаются жёлтыми и в Word — сразу видно, что осталось вписать.
const offerRuns = (offer: string) =>
  offer
    .split(/(\[[^\]]+\])/)
    .filter(Boolean)
    .map((part) => (/^\[[^\]]+\]$/.test(part) ? run(part, { highlight: "yellow" }) : run(part)));

const cell = (children: Paragraph[], width: number) =>
  new TableCell({
    width: { size: width, type: WidthType.PERCENTAGE },
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children,
  });

export async function buildTpDocx(subject: string, items: TpDocxItem[]): Promise<Buffer> {
  const header = new TableRow({
    tableHeader: true,
    children: [
      cell([new Paragraph({ children: [run("№", { bold: true })] })], 6),
      cell([new Paragraph({ children: [run("Требование заказчика", { bold: true })] })], 40),
      cell([new Paragraph({ children: [run("Предложение участника закупки", { bold: true })] })], 54),
    ],
  });

  const rows = items.map(
    (item, i) =>
      new TableRow({
        children: [
          cell([new Paragraph({ children: [run(String(i + 1))] })], 6),
          cell([new Paragraph({ children: [run(item.requirement + (item.clause ? ` (п. ${item.clause} ТЗ)` : ""))] })], 40),
          cell([new Paragraph({ children: offerRuns(item.offer) })], 54),
        ],
      })
  );

  const doc = new Document({
    sections: [
      {
        properties: { page: { margin: { top: 1134, bottom: 1134, left: 1701, right: 850 } } },
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [run("Техническое предложение", { bold: true, size: 28 })] }),
          ...(subject
            ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [run(`Предмет закупки: ${subject}`)] })]
            : []),
          new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...rows] }),
          new Paragraph({ spacing: { before: 480 }, children: [run("Участник закупки  ______________________ / ______________________ /")] }),
          new Paragraph({ indent: { left: 2268 }, children: [run("(подпись)  /  (расшифровка подписи)", { size: 18 })] }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
