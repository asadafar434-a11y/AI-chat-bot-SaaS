import "server-only";
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
import type { PartBlock, PartDoc } from "@/lib/part-doc";
import { ANKETA, fillFromProfile, type Profile } from "@/lib/profile";
import { formatRubles, rublesInWords } from "@/lib/rub-words";
import type { TpForm } from "@/lib/tp";
import { PART_TITLES, type TpPart } from "@/lib/tp-parts";

// Строка состава исполнителей: кто по ТЗ, ФИО и звание; titled — звание требует ТЗ, пустое — жёлтым.
export type CastLine = { who: string; name: string; title: string; titled: boolean };

export type TpDocx = {
  subject: string;
  form: TpForm;
  goods: { name: string; characteristics: string; quantity: string }[];
  items: { clause: string; requirement: string; offer: string }[];
  cast: { clause: string; rows: CastLine[] } | null;
  price: number | null;
  // Реквизиты участника; в техническое предложение не передаются.
  profile: Profile | null;
};

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

function tpBody({ form, goods, items, cast }: TpDocx): (Paragraph | Table)[] {
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
  // Состав исполнителей — отдельной таблицей: на неё ссылается пункт ТЗ о концерте или выступлении.
  if (cast && cast.rows.length) {
    body.push(
      new Paragraph({
        spacing: { before: 240, after: 120 },
        children: [run(`Состав исполнителей${cast.clause ? ` (п. ${cast.clause} ТЗ)` : ""}`, { bold: true })],
      }),
      table([
        headerRow([["№", 6], ["Исполнитель", 26], ["Фамилия, имя, отчество", 38], ["Почётное звание", 30]]),
        ...cast.rows.map(
          (row, i) =>
            new TableRow({
              children: [
                textCell(String(i + 1), 6),
                textCell(row.who, 26),
                cell([new Paragraph({ children: row.name ? [run(row.name)] : withFields("[фамилия, имя, отчество]") })], 38),
                cell([new Paragraph({ children: row.title ? [run(row.title)] : row.titled ? withFields("[почётное звание]") : [run("—")] })], 30),
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

// Сведения об опыте и о специалистах без ИИ — в примере и когда ИИ не подключён: таблица с полями для заполнения.
// С ИИ они составляются по форме заказчика из договоров и документов сотрудников (part-doc.ts).
const blankTable = (columns: [string, number][], rows: number) =>
  table([
    headerRow(columns),
    ...Array.from({ length: rows }, (_, i) =>
      new TableRow({
        children: columns.map(([title, width], c) =>
          c === 0 ? textCell(String(i + 1), width) : cell([new Paragraph({ children: withFields(`[${title.toLowerCase()}]`) })], width)
        ),
      })
    ),
  ]);

const participantLine = (profile: Profile | null) =>
  new Paragraph({
    spacing: { after: 120 },
    children: [run("Участник закупки: "), ...(profile?.fullName.trim() ? [run(profile.fullName.trim())] : withFields("[наименование участника]"))],
  });

const experienceBody = ({ profile }: TpDocx) => [
  participantLine(profile),
  blankTable(
    [["№", 6], ["Заказчик", 20], ["Предмет договора", 26], ["Номер и дата договора", 16], ["Цена договора, руб.", 14], ["Дата акта о приёмке", 18]],
    3
  ),
  ...paragraphs("Общая цена исполненных договоров: [сумма] руб.\nПриложения: копии исполненных договоров и актов о приёмке — [количество] шт."),
  ...signature(profile),
];

const staffBody = ({ profile }: TpDocx) => [
  participantLine(profile),
  blankTable(
    [["№", 6], ["Фамилия, имя, отчество", 20], ["Должность, роль", 16], ["Образование, квалификация", 20], ["Документ о квалификации, срок действия", 22], ["Основание работы", 16]],
    3
  ),
  ...paragraphs("Приложения: копии документов о квалификации и договоров с работниками — [количество] шт."),
  ...signature(profile),
];

const BODIES: Record<TpPart, (data: TpDocx) => (Paragraph | Table)[]> = {
  tp: tpBody,
  participant: participantBody,
  declaration: declarationBody,
  price: priceBody,
  experience: experienceBody,
  staff: staffBody,
};

const docTitle = (text: string) =>
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [run(text, { bold: true, size: 28 })] });

const page = (children: (Paragraph | Table)[]) =>
  Packer.toBuffer(
    new Document({
      sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1701, right: 850 } } }, children }],
    })
  );

export async function buildTpDocx(part: TpPart, data: TpDocx): Promise<Buffer> {
  return page([
    docTitle(PART_TITLES[part]),
    ...(data.subject
      ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [run(`Предмет закупки: ${data.subject}`)] })]
      : []),
    ...BODIES[part](data),
  ]);
}

// Ширина столбца — по средней длине текста в нём: узкий «№» и широкое «Сведения об участнике».
function blockTable(rows: string[][]) {
  const columns = Math.max(...rows.map((r) => r.length));
  const weights = Array.from({ length: columns }, (_, c) =>
    Math.max(3, rows.reduce((sum, r) => sum + (r[c] ?? "").length, 0) / rows.length)
  );
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => Math.max(7, Math.round((w / total) * 100)));
  return table(rows.map((r) => new TableRow({ children: widths.map((width, c) => cell(paragraphs(r[c] ?? ""), width)) })));
}

function partBlock(block: PartBlock): (Paragraph | Table)[] {
  switch (block.type) {
    case "heading":
      return [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240, after: 120 }, children: [run(block.text, { bold: true })] })];
    case "paragraph":
      return paragraphs(block.text, { indent: true });
    case "line":
      return block.text
        .split(/\n+/)
        .filter((line) => line.trim())
        .map((line) => new Paragraph({ spacing: { before: 60, after: 60 }, children: withFields(line.trim()) }));
    case "table":
      return block.rows.length ? [blockTable(block.rows), new Paragraph({ spacing: { after: 120 }, children: [] })] : [];
  }
}

// Анкета, декларация или цена, которые ИИ написал по форме заказчика и образцам участника.
export const buildPartDocx = (doc: PartDoc): Promise<Buffer> => page([docTitle(doc.title), ...doc.blocks.flatMap(partBlock)]);
