// Отчёт по разбору закупки в Word: собирается в браузере, на сервер не уходит. Состав — analytics-report.ts, здесь только оформление.
// Библиотека docx тяжёлая, поэтому подгружается при нажатии «Скачать Word», а не при открытии экрана.

import type { Report, ReportBlock } from "@/lib/analytics-report";

const FONT = "Arial";

export async function reportDocx(report: Report): Promise<Blob> {
  const { AlignmentType, BorderStyle, Document, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } = await import("docx");
  const run = (text: string, o: { bold?: boolean; size?: number; color?: string } = {}) => new TextRun({ text, font: FONT, size: o.size ?? 21, bold: o.bold, color: o.color });
  const para = (text: string, o: { bold?: boolean; size?: number; color?: string; before?: number; after?: number } = {}) =>
    new Paragraph({ spacing: { before: o.before ?? 60, after: o.after ?? 60 }, children: [run(text, o)] });
  const line = { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB" };
  const borders = { top: line, bottom: line, left: line, right: line };
  const cell = (text: string, head: boolean) =>
    new TableCell({
      borders,
      margins: { top: 50, bottom: 50, left: 80, right: 80 },
      shading: head ? { type: ShadingType.CLEAR, fill: "F0F0F0", color: "auto" } : undefined,
      children: [new Paragraph({ children: [run(text, { bold: head, size: 18 })] })],
    });
  const table = (head: string[], rows: string[][]) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ tableHeader: true, children: head.map((h) => cell(h, true)) }),
        ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c) => cell(c, false)) })),
      ],
    });
  const block = (b: ReportBlock) => {
    if (b.type === "p") return [para(b.text, { bold: b.bold, color: b.muted ? "555555" : undefined, before: b.bold ? 160 : 60 })];
    if (b.type === "bullets") return b.items.map((x) => new Paragraph({ spacing: { before: 30, after: 30 }, bullet: { level: 0 }, children: [run(x)] }));
    return [table(b.head, b.rows), para("", { before: 0, after: 0 })];
  };
  const doc = new Document({
    sections: [
      {
        properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } },
        children: [
          new Paragraph({ spacing: { after: 60 }, children: [run("Разбор закупки", { bold: true, size: 36 })] }),
          para(report.title, { color: "555555" }),
          ...(report.subtitle ? [para(report.subtitle, { color: "555555" })] : []),
          para(`Дата: ${report.date}`, { color: "555555" }),
          new Paragraph({
            spacing: { before: 200, after: 120 },
            alignment: AlignmentType.LEFT,
            border: { top: line, bottom: line, left: line, right: line },
            children: [run(report.verdict.label, { bold: true, size: 26 })],
          }),
          ...report.sections.flatMap((s) => [
            new Paragraph({ spacing: { before: 320, after: 100 }, border: { top: line }, children: [run(s.title, { bold: true, size: 28 })] }),
            ...s.blocks.flatMap(block),
          ]),
          para(report.footer, { color: "555555", size: 18, before: 360 }),
        ],
      },
    ],
  });
  return Packer.toBlob(doc);
}
