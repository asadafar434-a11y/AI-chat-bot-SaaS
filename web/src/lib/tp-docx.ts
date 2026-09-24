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
import { ANKETA, fillFromProfile, type Profile } from "@/lib/profile";
import { formatRubles, rublesInWords } from "@/lib/rub-words";
import type { TpForm } from "@/lib/tp";

// Части заявки собираются отдельными файлами: техническое предложение подают в первую часть,
// и в нём не должно быть ничего, что раскрывает участника, — ни названия, ни ИНН, ни подписи.
export type TpPart = "tp" | "participant" | "declaration" | "price";

export const PART_TITLES: Record<TpPart, string> = {
  tp: "Техническое предложение",
  participant: "Анкета участника закупки",
  declaration: "Декларация о принадлежности к субъектам малого и среднего предпринимательства",
  price: "Предложение о цене договора",
};

export type TpDocx = {
  subject: string;
  form: TpForm;
  goods: { name: string; characteristics: string; quantity: string }[];
  items: { clause: string; requirement: string; offer: string }[];
  price: number | null;
  // Реквизиты участника; в техническое предложение не передаются.
  profile: Profile | null;
};

// Техническое предложение и анкета нужны всегда; декларация и цена — если их требует форма заказчика.
export const partsOf = (form: TpForm): TpPart[] => [
  "tp",
  "participant",
  ...(form.smeDeclaration ? (["declaration"] as const) : []),
  ...(form.hasPrice ? (["price"] as const) : []),
];

// Строки формы заказчика, которые уже есть в анкете под другим названием, не повторяем.
const COVERED = [/^наименование$/i, /^(фамилия|имя|отчество)/i, /место нахождения|место жительства/i, /банковские реквизиты/i, /^инн участника/i];

function anketaRows(form: TpForm, profile: Profile | null) {
  const extra = form.participantFields.filter(
    (field, i, all) => all.indexOf(field) === i && !COVERED.some((re) => re.test(field.trim()))
  );
  return [
    ...ANKETA.map(({ key, label }) => ({ label, value: profile?.[key].trim() ?? "" })),
    ...extra.map((label) => ({ label, value: "" })),
  ];
}

const FONT = "Times New Roman";
const run = (text: string, options: { bold?: boolean; highlight?: "yellow"; size?: number; italics?: boolean } = {}) =>
  new TextRun({ text, font: FONT, size: options.size ?? 24, bold: options.bold, italics: options.italics, highlight: options.highlight });

// Всё, что вписывает участник, — «[…]» — остаётся жёлтым и в Word: сразу видно, что осталось заполнить.
const withFields = (text: string) =>
  text
    .split(/(\[[^\]]+\])/)
    .filter(Boolean)
    .map((part) => (/^\[[^\]]+\]$/.test(part) ? run(part, { highlight: "yellow" }) : run(part)));

const paragraphs = (text: string, options: { indent?: boolean } = {}) =>
  text
    .split(/\n+/)
    .filter((line) => line.trim())
    .map(
      (line) =>
        new Paragraph({
          spacing: { after: 60 },
          alignment: options.indent ? AlignmentType.JUSTIFIED : undefined,
          indent: options.indent ? { firstLine: 709 } : undefined,
          children: withFields(line.trim()),
        })
    );

const cell = (children: Paragraph[], width: number) =>
  new TableCell({
    width: { size: width, type: WidthType.PERCENTAGE },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: children.length ? children : [new Paragraph("")],
  });

const textCell = (text: string, width: number) => cell([new Paragraph({ children: [run(text)] })], width);

const headerRow = (titles: [string, number][]) =>
  new TableRow({
    tableHeader: true,
    children: titles.map(([title, width]) => cell([new Paragraph({ children: [run(title, { bold: true })] })], width)),
  });

const table = (rows: TableRow[]) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });

const signature = (profile: Profile | null) => [
  new Paragraph({
    spacing: { before: 480 },
    children: [run(`Участник закупки  ______________________ / ${profile?.signer.trim() || "______________________"} /`)],
  }),
  new Paragraph({ indent: { left: 2268 }, children: [run("(подпись)  /  (расшифровка подписи)", { size: 18 })] }),
  new Paragraph({ spacing: { before: 120 }, children: [run("М.П. (при наличии)          «____» ________________ 20___ г.")] }),
];

function tpBody({ form, goods, items }: TpDocx): (Paragraph | Table)[] {
  const body: (Paragraph | Table)[] = [];
  if (goods.length) {
    body.push(...paragraphs(form.consent, { indent: true }));
    body.push(
      table([
        headerRow([["№ п/п", 7], ["Наименование товара", 25], ["Характеристики товара", 50], ["Количество", 18]]),
        ...goods.map(
          (g, i) =>
            new TableRow({
              children: [textCell(String(i + 1), 7), textCell(g.name, 25), cell(paragraphs(g.characteristics), 50), textCell(g.quantity, 18)],
            })
        ),
      ])
    );
  }
  if (items.length) {
    if (goods.length) body.push(new Paragraph({ spacing: { before: 240 }, children: [] }));
    body.push(
      table([
        headerRow([["№", 6], ["Требование заказчика", 40], ["Предложение участника закупки", 54]]),
        ...items.map(
          (item, i) =>
            new TableRow({
              children: [
                textCell(String(i + 1), 6),
                textCell(item.requirement + (item.clause ? ` (п. ${item.clause} ТЗ)` : ""), 40),
                cell(paragraphs(item.offer), 54),
              ],
            })
        ),
      ])
    );
  }
  return body;
}

const participantBody = ({ form, profile }: TpDocx) => [
  table([
    headerRow([["№", 6], ["Наименование сведений", 44], ["Сведения об участнике", 50]]),
    ...anketaRows(form, profile).map(
      (row, i) =>
        new TableRow({
          children: [
            textCell(String(i + 1), 6),
            textCell(row.label, 44),
            cell([new Paragraph({ children: row.value ? [run(row.value)] : withFields("[заполните]") })], 50),
          ],
        })
    ),
  ]),
  new Paragraph({ spacing: { before: 120 }, children: [run("Строки, которые к вам не относятся, удалите.", { size: 20, italics: true })] }),
  ...signature(profile),
];

const declarationBody = ({ form, profile }: TpDocx) => [
  ...paragraphs(fillFromProfile(form.smeDeclaration, profile), { indent: true }),
  ...signature(profile),
];

function priceBody({ form, price, profile }: TpDocx) {
  const amount = price
    ? `${formatRubles(price)} руб. (${rublesInWords(price)})`
    : "[цена договора цифрами] руб. ([цена прописью])";
  return [
    ...paragraphs(
      `Предлагаемая цена договора составляет ${amount}, ${profile?.vatNote.trim() || "[в том числе НДС по ставке __% — сумма НДС, либо «НДС не облагается» с указанием основания]"}.`,
      { indent: true }
    ),
    ...paragraphs(form.priceNote, { indent: true }),
    ...signature(profile),
  ];
}

const BODIES: Record<TpPart, (data: TpDocx) => (Paragraph | Table)[]> = {
  tp: tpBody,
  participant: participantBody,
  declaration: declarationBody,
  price: priceBody,
};

export async function buildTpDocx(part: TpPart, data: TpDocx): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        properties: { page: { margin: { top: 1134, bottom: 1134, left: 1701, right: 850 } } },
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [run(PART_TITLES[part], { bold: true, size: 28 })] }),
          ...(data.subject
            ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [run(`Предмет закупки: ${data.subject}`)] })]
            : []),
          ...BODIES[part](data),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
