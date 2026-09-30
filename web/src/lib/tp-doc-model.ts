import type { PartBlock, PartDoc } from "@/lib/part-doc";
import { ANKETA, anketaExtraRows, fillFromProfile, type Profile } from "@/lib/profile";
import { formatRubles, rublesInWords } from "@/lib/rub-words";
import type { TpForm } from "@/lib/tp";
import { PART_TITLES, type TpPart } from "@/lib/tp-parts";

// Что попадает в каждый файл заявки — и в Word, и в PDF. Сначала документ описывается здесь, одним для обоих форматов:
// заголовок, абзацы, таблицы, жёлтые места «[…]». Потом tp-docx.ts рисует это в Word, tp-pdf.ts — в PDF. Так файлы разных
// форматов не расходятся: новая часть или строка появляется сразу в обоих.

// Строка состава исполнителей для таблицы в файле ТП: кто по ТЗ, ФИО и звание; titled — звание требует ТЗ, пустое — жёлтым.
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
  // Строки формы анкеты заказчика сверх реквизитов, которые участник вписал под эту закупку.
  anketaExtra?: Record<string, string>;
};

// Кусок текста. size — кегль в пунктах (по умолчанию 12); highlight — жёлтая подсветка: место, которое вписывает участник.
export type Run = { text: string; bold?: boolean; italics?: boolean; highlight?: boolean; size?: number };
// Абзац. Отступы — в пунктах: before и after — до и после абзаца, firstLine — красная строка, left — отступ слева.
export type Para = { type: "p"; runs: Run[]; align?: "center" | "justify"; firstLine?: number; left?: number; before?: number; after?: number };
// Ячейка: width — доля ширины таблицы, в процентах.
export type Cell = { width: number; paras: Para[] };
// Строка таблицы; header — заголовок, на новой странице повторяется.
export type Row = { header?: boolean; cells: Cell[] };
export type Table = { type: "table"; rows: Row[] };
export type Block = Para | Table;
// title — название документа: в заголовке файла PDF и в строке окна просмотра.
export type DocModel = { title: string; blocks: Block[] };

// extra — что участник вписал в строки формы заказчика сверх реквизитов (карта полей, fields.ts).
function anketaRows(form: TpForm, profile: Profile | null, extra: Record<string, string> = {}) {
  return [
    ...ANKETA.map(({ key, label }) => ({ label, value: profile?.[key].trim() ?? "" })),
    ...anketaExtraRows(form.participantFields).map((label) => ({ label, value: (extra[label] ?? "").trim() })),
  ];
}

const run = (text: string, options: Omit<Run, "text"> = {}): Run => ({ text, ...options });
const para = (runs: Run[], options: Omit<Para, "type" | "runs"> = {}): Para => ({ type: "p", runs, ...options });

// Всё, что вписывает участник, — «[…]» — остаётся жёлтым и в файле: сразу видно, что осталось заполнить.
const withFields = (text: string): Run[] =>
  text
    .split(/(\[[^\]]+\])/)
    .filter(Boolean)
    .map((part) => (/^\[[^\]]+\]$/.test(part) ? run(part, { highlight: true }) : run(part)));

const paragraphs = (text: string, options: { indent?: boolean } = {}): Para[] =>
  text
    .split(/\n+/)
    .filter((line) => line.trim())
    .map((line) => para(withFields(line.trim()), { after: 3, ...(options.indent && { align: "justify" as const, firstLine: 35.45 }) }));

const cell = (paras: Para[], width: number): Cell => ({ width, paras });
const textCell = (text: string, width: number): Cell => cell([para([run(text)])], width);
const headerRow = (titles: [string, number][]): Row => ({
  header: true,
  cells: titles.map(([title, width]) => cell([para([run(title, { bold: true })])], width)),
});
const table = (rows: Row[]): Table => ({ type: "table", rows });

const signature = (profile: Profile | null): Para[] => [
  para([run(`Участник закупки  ______________________ / ${profile?.signer.trim() || "______________________"} /`)], { before: 24 }),
  para([run("(подпись)  /  (расшифровка подписи)", { size: 9 })], { left: 113.4 }),
  para([run("М.П. (при наличии)          «____» ________________ 20___ г.")], { before: 6 }),
];

function tpBody({ form, goods, items, cast }: TpDocx): Block[] {
  const body: Block[] = [];
  if (goods.length) {
    body.push(...paragraphs(form.consent, { indent: true }));
    body.push(
      table([
        headerRow([["№ п/п", 7], ["Наименование товара", 25], ["Характеристики товара", 50], ["Количество", 18]]),
        ...goods.map(
          (g, i): Row => ({ cells: [textCell(String(i + 1), 7), textCell(g.name, 25), cell(paragraphs(g.characteristics), 50), textCell(g.quantity, 18)] })
        ),
      ])
    );
  }
  if (items.length) {
    if (goods.length) body.push(para([], { before: 12 }));
    body.push(
      table([
        headerRow([["№", 6], ["Требование заказчика", 40], ["Предложение участника закупки", 54]]),
        ...items.map(
          (item, i): Row => ({
            cells: [
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
      para([run(`Состав исполнителей${cast.clause ? ` (п. ${cast.clause} ТЗ)` : ""}`, { bold: true })], { before: 12, after: 6 }),
      table([
        headerRow([["№", 6], ["Исполнитель", 26], ["Фамилия, имя, отчество", 38], ["Почётное звание", 30]]),
        ...cast.rows.map(
          (row, i): Row => ({
            cells: [
              textCell(String(i + 1), 6),
              textCell(row.who, 26),
              cell([para(row.name ? [run(row.name)] : withFields("[фамилия, имя, отчество]"))], 38),
              cell([para(row.title ? [run(row.title)] : row.titled ? withFields("[почётное звание]") : [run("—")])], 30),
            ],
          })
        ),
      ])
    );
  }
  return body;
}

const participantBody = ({ form, profile, anketaExtra }: TpDocx): Block[] => [
  table([
    headerRow([["№", 6], ["Наименование сведений", 44], ["Сведения об участнике", 50]]),
    ...anketaRows(form, profile, anketaExtra).map(
      (row, i): Row => ({
        cells: [textCell(String(i + 1), 6), textCell(row.label, 44), cell([para(row.value ? [run(row.value)] : withFields("[заполните]"))], 50)],
      })
    ),
  ]),
  para([run("Строки, которые к вам не относятся, удалите.", { size: 10, italics: true })], { before: 6 }),
  ...signature(profile),
];

const declarationBody = ({ form, profile }: TpDocx): Block[] => [
  ...paragraphs(fillFromProfile(form.smeDeclaration, profile), { indent: true }),
  ...signature(profile),
];

function priceBody({ form, price, profile }: TpDocx): Block[] {
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
const blankTable = (columns: [string, number][], rows: number): Table =>
  table([
    headerRow(columns),
    ...Array.from(
      { length: rows },
      (_, i): Row => ({
        cells: columns.map(([title, width], c) =>
          c === 0 ? textCell(String(i + 1), width) : cell([para(withFields(`[${title.toLowerCase()}]`))], width)
        ),
      })
    ),
  ]);

const participantLine = (profile: Profile | null): Para =>
  para([run("Участник закупки: "), ...(profile?.fullName.trim() ? [run(profile.fullName.trim())] : withFields("[наименование участника]"))], { after: 6 });

const experienceBody = ({ profile }: TpDocx): Block[] => [
  participantLine(profile),
  blankTable(
    [["№", 6], ["Заказчик", 20], ["Предмет договора", 26], ["Номер и дата договора", 16], ["Цена договора, руб.", 14], ["Дата акта о приёмке", 18]],
    3
  ),
  ...paragraphs("Общая цена исполненных договоров: [сумма] руб.\nПриложения: копии исполненных договоров и актов о приёмке — [количество] шт."),
  ...signature(profile),
];

const staffBody = ({ profile }: TpDocx): Block[] => [
  participantLine(profile),
  blankTable(
    [["№", 6], ["Фамилия, имя, отчество", 20], ["Должность, роль", 16], ["Образование, квалификация", 20], ["Документ о квалификации, срок действия", 22], ["Основание работы", 16]],
    3
  ),
  ...paragraphs("Приложения: копии документов о квалификации и договоров с работниками — [количество] шт."),
  ...signature(profile),
];

const BODIES: Record<TpPart, (data: TpDocx) => Block[]> = {
  tp: tpBody,
  participant: participantBody,
  declaration: declarationBody,
  price: priceBody,
  experience: experienceBody,
  staff: staffBody,
};

const docTitle = (text: string): Para => para([run(text, { bold: true, size: 14 })], { align: "center", after: 6 });

// Часть заявки из данных закупки и реквизитов: техническое предложение, анкета, декларация, цена, опыт, специалисты.
export function modelOfTp(part: TpPart, data: TpDocx): DocModel {
  return {
    title: PART_TITLES[part],
    blocks: [
      docTitle(PART_TITLES[part]),
      ...(data.subject ? [para([run(`Предмет закупки: ${data.subject}`)], { align: "center", after: 12 })] : []),
      ...BODIES[part](data),
    ],
  };
}

// Ширина столбца — по средней длине текста в нём: узкий «№» и широкое «Сведения об участнике».
function blockTable(rows: string[][]): Table {
  const columns = Math.max(...rows.map((r) => r.length));
  const weights = Array.from({ length: columns }, (_, c) => Math.max(3, rows.reduce((sum, r) => sum + (r[c] ?? "").length, 0) / rows.length));
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => Math.max(7, Math.round((w / total) * 100)));
  return table(rows.map((r): Row => ({ cells: widths.map((width, c) => cell(paragraphs(r[c] ?? ""), width)) })));
}

function partBlock(block: PartBlock): Block[] {
  switch (block.type) {
    case "heading":
      return [para([run(block.text, { bold: true })], { align: "center", before: 12, after: 6 })];
    case "paragraph":
      return paragraphs(block.text, { indent: true });
    case "line":
      return block.text
        .split(/\n+/)
        .filter((line) => line.trim())
        .map((line) => para(withFields(line.trim()), { before: 3, after: 3 }));
    case "table":
      return block.rows.length ? [blockTable(block.rows), para([], { after: 6 })] : [];
  }
}

// Анкета, декларация или цена, которые ИИ написал по форме заказчика и образцам участника.
export const modelOfPartDoc = (doc: PartDoc): DocModel => ({ title: doc.title, blocks: [docTitle(doc.title), ...doc.blocks.flatMap(partBlock)] });
