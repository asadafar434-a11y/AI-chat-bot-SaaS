/* Общие помощники и расчёты для второго документа (части 6–15) */
const {
  Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType,
} = require("docx");

const W = 9638;
const INK = "1A1A2E";
const BRAND = "312E81";
const BRAND_DK = "26246A";
const SUB = "3A3A5C";
const HEADFILL = "E7E6F3";
const ALTFILL = "F5F5FA";
const FONT = "Calibri";

function runs(text, o = {}) {
  return String(text)
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((p) =>
      p.startsWith("**") && p.endsWith("**")
        ? new TextRun({ text: p.slice(2, -2), bold: true, font: FONT, ...o })
        : new TextRun({ text: p, font: FONT, ...o })
    );
}

const H1 = (t) =>
  new Paragraph({
    pageBreakBefore: true,
    spacing: { before: 120, after: 260 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BRAND, space: 8 } },
    children: [new TextRun({ text: t, bold: true, size: 32, color: BRAND_DK, font: FONT })],
  });

const H2 = (t) =>
  new Paragraph({
    spacing: { before: 320, after: 140 },
    children: [new TextRun({ text: t, bold: true, size: 25, color: BRAND, font: FONT })],
  });

const H3 = (t) =>
  new Paragraph({
    spacing: { before: 220, after: 100 },
    children: [new TextRun({ text: t, bold: true, size: 21, color: SUB, font: FONT })],
  });

const P = (t, o = {}) =>
  new Paragraph({
    spacing: { after: 120, line: 276 },
    children: runs(t, { size: o.size || 20, color: o.color || INK, italics: o.italics }),
  });

const NOTE = (t) =>
  new Paragraph({
    spacing: { before: 100, after: 180, line: 264 },
    indent: { left: 240 },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: BRAND, space: 10 } },
    children: runs(t, { size: 19, color: SUB, italics: true }),
  });

const BUL = (t) =>
  new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { after: 70, line: 268 },
    children: runs(t, { size: 20, color: INK }),
  });

const NUM = (t) =>
  new Paragraph({
    numbering: { reference: "numbers", level: 0 },
    spacing: { after: 70, line: 268 },
    children: runs(t, { size: 20, color: INK }),
  });

const GAP = (n) => new Paragraph({ spacing: { after: n || 120 }, children: [] });

const TCAP = (t) =>
  new Paragraph({
    spacing: { before: 60, after: 200 },
    children: runs(t, { size: 17, color: SUB, italics: true }),
  });

function cell(content, width, head, fill, fs) {
  const list = Array.isArray(content) ? content : [content];
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: head
      ? { type: ShadingType.CLEAR, color: "auto", fill: HEADFILL }
      : fill
      ? { type: ShadingType.CLEAR, color: "auto", fill }
      : undefined,
    margins: { top: 70, bottom: 70, left: 100, right: 100 },
    children: list.map(
      (line, i) =>
        new Paragraph({
          spacing: { after: i === list.length - 1 ? 0 : 60, line: 250 },
          children: runs(line, {
            size: fs || 18,
            bold: head || undefined,
            color: head ? BRAND_DK : INK,
          }),
        })
    ),
  });
}

function TBL(head, rows, weights, fs) {
  const total = weights.reduce((a, b) => a + b, 0);
  const cols = weights.map((w) => Math.round((w / total) * W));
  return new Table({
    columnWidths: cols,
    width: { size: W, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: "C9C8DE" },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: "C9C8DE" },
      left: { style: BorderStyle.SINGLE, size: 4, color: "C9C8DE" },
      right: { style: BorderStyle.SINGLE, size: 4, color: "C9C8DE" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "DEDDEB" },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "DEDDEB" },
    },
    rows: [
      new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, cols[i], true, null, fs)) }),
      ...rows.map((r, ri) =>
        new TableRow({ children: r.map((c, i) => cell(c, cols[i], false, ri % 2 ? ALTFILL : null, fs)) })
      ),
    ],
  });
}

/* ============================================================
   РАСЧЁТЫ — те же константы, что в части 0–5, плюс маркетинг
   ============================================================ */
const RATE = 83;
const BUDGET = 10000 * RATE;
const ARPA = 2100;
const GM = 0.78;
const FIXED = 18000;
const LIVING = 90000;
const CHURN = 0.05;
const DLG = 300;
const TOK = 8;
const P_LITE = 0.065, P_PRO = 0.5, P_YA = 0.8;
const cLite = TOK * P_LITE;          // 0,52 ₽
const cPro = TOK * P_PRO;            // 4,00 ₽
const cYa = TOK * P_YA;              // 6,40 ₽
const cMix = 0.85 * cLite + 0.15 * cPro;  // 1,042 ₽
const gpM = Math.round(ARPA * GM);   // 1 638 ₽
const life = Math.round(1 / CHURN);  // 20
const LTV = gpM * life;              // 32 760 ₽
const CAC_CASH = 6500;
const CAC_FULL = 18500;

/* пример магазина для разговора о цене — те же числа, что в главном риске части 0 */
const TARIF = 1490;
const EX_REQ = 340;                  // обращений в месяц
const EX_TYP = 200;                  // из них типовых
const EX_MIN = 3.5;                  // минут на типовое обращение [ДОПУЩЕНИЕ]
const exHours = Math.round((EX_TYP * EX_MIN) / 60);  // 12 ч
const hourPrice = Math.round(TARIF / exHours);       // 124 ₽
const STAFF_PAY = [30000, 50000];    // зарплата сотрудника поддержки, ₽/мес [ДОПУЩЕНИЕ]
const STAFF_LOAD = 1.3;              // со страховыми взносами
const STAFF_HOURS = 165;             // рабочих часов в месяц
const staffHour = STAFF_PAY.map((s) => Math.round((s * STAFF_LOAD) / STAFF_HOURS / 10) * 10);  // 240 / 390 ₽

/* маркетинговый бюджет по месяцам (часть 12) */
const MKT = (m) => (m <= 6 ? 5000 : m <= 12 ? 10000 : m <= 18 ? 20000 : 50000);

const PLAN_BASE = [0,0,1,2,4,5, 5,6,6,7,7,8, 8,9,9,10,10,11, 11,12,12,13,13,14];
const PLAN_PESS = [0,0,0,1,1,2, 2,2,2,3,3,3, 3,3,4,4,4,4, 4,4,5,5,5,5];
const PLAN_OPT  = [0,0,3,5,7,11, 11,12,13,14,15,16, 17,18,19,20,21,22, 23,24,25,26,27,28];

function model(plan, living, withMkt) {
  let clients = 0, cash = BUDGET;
  const out = [];
  for (let m = 1; m <= 24; m++) {
    const churn = Math.round(clients * CHURN);
    const nw = plan[m - 1];
    clients = clients - churn + nw;
    const mrr = clients * ARPA;
    const gp = Math.round(mrr * GM);
    const mkt = withMkt ? MKT(m) : 0;
    const cost = FIXED + living + mkt;
    cash += gp - cost;
    out.push({ m, nw, churn, clients, mrr, gp, mkt, cost, cash });
  }
  return out;
}

const A  = model(PLAN_BASE, LIVING, false);   // как в части 4
const AM = model(PLAN_BASE, LIVING, true);    // с маркетингом — исправленная
const BM = model(PLAN_BASE, 0, true);         // отдельный доход + маркетинг
const PM = model(PLAN_PESS, LIVING, true);
const OM = model(PLAN_OPT, LIVING, true);

const fmt = (n) =>
  (n < 0 ? "−" : "") +
  Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");

const dec = (n, d = 1) => Number(n).toFixed(d).replace(".", ",");

const low = (a) => a.reduce((x, r) => (r.cash < x.cash ? r : x), a[0]);
const firstNeg = (a) => a.find((r) => r.cash < 0);
const opZero = (a) => a.find((r) => r.gp >= r.cost);

/* кварталы */
function quarters(a) {
  const q = [];
  for (let i = 0; i < 8; i++) {
    const s = a.slice(i * 3, i * 3 + 3);
    q.push({
      q: i + 1,
      clients: s[2].clients,
      rev: s.reduce((x, r) => x + r.mrr, 0),
      gp: s.reduce((x, r) => x + r.gp, 0),
      cost: s.reduce((x, r) => x + r.cost, 0),
      op: s.reduce((x, r) => x + r.gp - r.cost, 0),
      cash: s[2].cash,
    });
  }
  return q;
}

/* инфраструктура по уровням (часть 9) */
const LEVELS = [10, 50, 200, 1000, 5000];
const INFRA = {
  compute: [3000, 5000, 12000, 45000, 180000],
  db:      [0, 0, 8000, 30000, 120000],
  vector:  [0, 0, 2000, 10000, 45000],
  rt:      [0, 0, 3000, 12000, 50000],
  email:   [1000, 1500, 3000, 9000, 35000],
  logs:    [1200, 2000, 5000, 15000, 50000],
  backup:  [500, 1000, 3000, 12000, 50000],
};
const aiCost = LEVELS.map((n) => Math.round(n * DLG * cMix));
const infraSum = LEVELS.map((_, i) =>
  Object.values(INFRA).reduce((s, arr) => s + arr[i], 0)
);
const totalCost = LEVELS.map((_, i) => infraSum[i] + aiCost[i]);
const perClient = LEVELS.map((n, i) => Math.round(totalCost[i] / n));
const aiShare = LEVELS.map((_, i) => Math.round((aiCost[i] / totalCost[i]) * 100));
const marginAt = LEVELS.map((n, i) =>
  Math.round(((n * ARPA - totalCost[i]) / (n * ARPA)) * 100)
);

module.exports = {
  W, INK, BRAND, BRAND_DK, SUB, FONT,
  runs, H1, H2, H3, P, NOTE, BUL, NUM, GAP, TCAP, TBL, cell,
  RATE, BUDGET, ARPA, GM, FIXED, LIVING, CHURN, DLG, TOK,
  cLite, cPro, cYa, cMix, gpM, life, LTV, CAC_CASH, CAC_FULL, MKT,
  TARIF, EX_REQ, EX_TYP, EX_MIN, exHours, hourPrice, STAFF_PAY, STAFF_LOAD, STAFF_HOURS, staffHour,
  A, AM, BM, PM, OM, model, PLAN_BASE, PLAN_PESS, PLAN_OPT,
  fmt, dec, low, firstNeg, opZero, quarters,
  LEVELS, INFRA, aiCost, infraSum, totalCost, perClient, aiShare, marginAt,
};
