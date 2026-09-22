/* Отклик — E2E-разбор, части 6–15 + приложения. Сборка .docx */
const {
  Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, LevelFormat,
} = require("docx");
const fs = require("fs");
const L = require("./doc2-lib.js");
const { P, FONT, INK, BRAND, BRAND_DK, SUB } = L;

const body = [];

/* ---------------- титул ---------------- */
body.push(
  new Paragraph({ spacing: { before: 2600, after: 0 }, children: [] }),
  new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text: "ОТКЛИК", bold: true, size: 64, color: BRAND_DK, font: FONT, characterSpacing: 60 })],
  }),
  new Paragraph({
    spacing: { after: 420 },
    children: [new TextRun({ text: "Support-chat SaaS с ИИ-агентом · Россия", size: 26, color: SUB, font: FONT })],
  }),
  new Paragraph({
    spacing: { after: 120 },
    border: { top: { style: BorderStyle.SINGLE, size: 12, color: BRAND, space: 12 } },
    children: [new TextRun({ text: "E2E-разбор проекта", bold: true, size: 40, color: INK, font: FONT })],
  }),
  new Paragraph({
    spacing: { after: 600 },
    children: [new TextRun({ text: "Части 6–15: продукт · этапы · стек · инфраструктура · комплаенс · команда · GTM · финансы · риски · красная команда", size: 22, color: SUB, font: FONT })],
  }),
  P("Подготовлено: 22 сентября 2026", { color: SUB, size: 19 }),
  P("Продолжение документа «Части 0–5». Числа и допущения наследуются оттуда.", { color: SUB, size: 19 }),
  P("В расчётах нет личных расходов основателя — это не расход проекта.", { color: SUB, size: 19, italics: true })
);

/* ---------------- содержимое ---------------- */
body.push(...require("./doc2-p67.js"));
body.push(...require("./doc2-p89.js"));
body.push(...require("./doc2-p1012.js"));
body.push(...require("./doc2-p1315.js"));
body.push(...require("./doc2-app.js"));

/* ---------------- сборка ---------------- */
const doc = new Document({
  creator: "Отклик",
  title: "Отклик — E2E-разбор, части 6–15",
  description: "Продукт, этапы, стек, комплаенс, GTM, финансы, риски и красная команда",
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 340, hanging: 240 } } },
        }],
      },
      {
        reference: "numbers",
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 340, hanging: 240 } } },
        }],
      },
    ],
  },
  styles: { default: { document: { run: { font: FONT, size: 20, color: INK } } } },
  sections: [{
    properties: { page: { margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } },
    children: body,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  const out = process.argv[2] || "razbor-6-15.docx";
  fs.writeFileSync(out, buf);
  console.log("OK:", out, (buf.length / 1024).toFixed(0) + " KB");
  const { BM, low, opZero, fmt, BUDGET, marginAt, perClient } = L;
  const t = low(BM);
  console.log("Просадка:", fmt(BUDGET - t.cash), "₽ | операционный ноль: месяц", opZero(BM).m);
  console.log("Маржа по уровням:", marginAt.join("% / ") + "%");
  console.log("Стоимость на клиента:", perClient.map(fmt).join(" / "), "₽");
});
