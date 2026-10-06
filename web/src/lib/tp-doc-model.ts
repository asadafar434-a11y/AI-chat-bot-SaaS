import type { PartBlock, PartDoc } from "@/lib/part-doc";
import { ANKETA, anketaExtraRows, fillFromProfile, type Profile } from "@/lib/profile";
import { formatRubles, rublesInWords } from "@/lib/rub-words";
import type { DetectedForm, TpForm } from "@/lib/tp";
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
  // Дополнительные бланки, найденные ИИ в документах закупки (кроме главной формы).
  detectedForms?: DetectedForm[];
  // Скачивание одного доп. бланка: файл только из него, без заявки.
  blankOnly?: boolean;
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
export type Para = { type: "p"; runs: Run[]; align?: "center" | "justify" | "right"; firstLine?: number; left?: number; before?: number; after?: number };
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

// Таблица товаров: если заказчик дал свои заголовки столбцов — используем их; иначе — стандартные 4 столбца.
// Правило: заголовки столбцов из form.goodsTableHeaders воспроизводятся дословно и в том же порядке.
// goods.characteristics — только предложение участника; колонки заказчика (характеристика по ТЗ) участник заполняет сам из документации.
function goodsTableOf(goods: TpDocx["goods"], headers: string[]): Table {
  if (!headers.length) {
    return table([
      headerRow([["№ п/п", 7], ["Наименование товара", 25], ["Характеристики товара", 50], ["Количество", 18]]),
      ...goods.map((g, i): Row => ({
        cells: [textCell(String(i + 1), 7), textCell(g.name, 25), cell(paragraphs(g.characteristics), 50), textCell(g.quantity, 18)],
      })),
    ]);
  }
  const numWidth = 7;
  const hasNum = /^№/.test(headers[0]);
  const dataHeaders = hasNum ? headers.slice(1) : headers;
  const colW = Math.max(8, Math.floor((100 - (hasNum ? numWidth : 0)) / dataHeaders.length));
  const widths: [string, number][] = headers.map((h) => [h, /^№/.test(h) ? numWidth : colW]);
  const fillCol = (h: string, g: { name: string; characteristics: string; quantity: string }): Cell => {
    if (/наименован/i.test(h)) return textCell(g.name, colW);
    if (/предложен|предлагаем|участник.*хар|хар.*участ|значен.*участ/i.test(h)) return cell(paragraphs(g.characteristics), colW);
    if (/количеств|кол[-.\s]?во/i.test(h)) return textCell(g.quantity, colW);
    if (/единиц|ед[-.\s]?изм/i.test(h)) return textCell(g.quantity.replace(/^\s*[\d,.]+\s*/, "").trim() || g.quantity, colW);
    if (/характеристик|требован|параметр|спецификац/i.test(h)) return cell([para(withFields("[характеристика из ТЗ]"))], colW);
    return cell([para(withFields("[заполните]"))], colW);
  };
  return table([
    headerRow(widths),
    ...goods.map((g, i): Row => ({
      cells: headers.map((h) => (/^№/.test(h) ? textCell(String(i + 1), numWidth) : fillCol(h, g))),
    })),
  ]);
}

function tpBody({ form, goods, items, cast }: TpDocx): Block[] {
  const body: Block[] = [];
  // Согласие из формы показывается всегда: для заявки-анкеты (Запрос котировок) оно — весь документ.
  if (form.consent) body.push(...paragraphs(form.consent, { indent: true }));
  if (goods.length) {
    body.push(goodsTableOf(goods, form.goodsTableHeaders ?? []));
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

// Форма заказчика — единый бланк, который заменяет или дополняет ТП.
// Два пути: ЕАИСТ-форма для запроса котировок (структура фиксирована) и произвольная форма по данным ИИ.
// Пропуски «____» из бланка остаются жёлтыми; что известно из профиля и цены — вписывается автоматически.
const withBlanks = (text: string): Run[] =>
  text
    .split(/(_{3,})/)
    .filter(Boolean)
    .map((part) => (/^_{3,}$/.test(part) ? run(part, { highlight: true }) : run(part)));

const appPara = (text: string): Para => para(withBlanks(text), { align: "justify", after: 6 });
const appHeading = (text: string): Para => para([run(text, { bold: true })], { align: "center", before: 12, after: 6 });

const APP_COLS: [number, number, number] = [10, 45, 45];
const appRow = (num: string, label: string, value: string, mark = true): Row => ({
  cells: [
    textCell(num, APP_COLS[0]),
    textCell(label, APP_COLS[1]),
    cell([para(value ? [run(value)] : mark ? withFields("[заполните]") : [])], APP_COLS[2]),
  ],
});
const appNote = (text: string): Row => ({ cells: [textCell("", APP_COLS[0]), cell([para([run(text)], { align: "center" })], APP_COLS[1]), textCell("", APP_COLS[2])] });

// Произвольная форма заказчика: структура из данных, которые ИИ вытащил при анализе документов.
// Подходит для любого бланка, где заказчик прописал разделы о сведениях участника, согласии, цене и декларации МСП.
// Строки одного доп. бланка: откуда он, название и таблица «Наименование сведений | Значение».
function detectedFormBlocks(df: DetectedForm): Block[] {
  return [
    para([run([df.source || df.title, df.pages ? `стр. ${df.pages}` : ""].filter(Boolean).join(" · "), { size: 10 })], { align: "right", after: 6 }),
    para([run(df.title, { bold: true })], { align: "center", before: 18, after: 8 }),
    table([
      headerRow([["Наименование сведений", 60], ["Значение", 40]]),
      ...df.fields.map((f): Row => ({
        cells: [
          textCell(f.label, 60),
          cell([para(f.value ? [run(f.value)] : withFields("[заполните]"))], 40),
        ],
      })),
    ]),
  ];
}

function genericApplicationBody({ form, goods, items, detectedForms, price, profile }: TpDocx): Block[] {
  const body: Block[] = [];
  const name = profile?.fullName.trim() ?? "";

  // Шапка: ссылка на приложение (откуда форма) и название документа
  if (form.source.trim()) {
    body.push(para([run(form.source.trim())], { align: "right", after: 12 }));
  }
  body.push(para([run(form.title || "ЗАЯВКА НА УЧАСТИЕ В ЗАКУПКЕ", { bold: true })], { align: "center", after: 12 }));

  // Раздел: сведения об участнике — поля, которые ИИ нашёл в форме заказчика.
  if (form.participantFields.length > 0) {
    body.push(appHeading("1. Сведения об участнике закупки"));
    // Автозаполнение: если метка поля совпадает с известным реквизитом — вставляем значение из профиля.
    const bank = profile
      ? [profile.account, profile.bankName, profile.bik ? `БИК ${profile.bik}` : "", profile.corrAccount ? `к/с ${profile.corrAccount}` : ""].filter(Boolean).join(", ")
      : "";
    const KNOWN: [RegExp, () => string][] = [
      [/наименован/i, () => name],
      [/фирменн/i, () => name],
      [/место нахожден/i, () => profile?.legalAddress.trim() ?? ""],
      [/юридическ.*адрес|адрес.*нахожден/i, () => profile?.legalAddress.trim() ?? ""],
      [/\bинн\b/i, () => profile?.inn.trim() ?? ""],
      [/\bкпп\b/i, () => profile?.kpp.trim() ?? ""],
      [/\bогрн\b/i, () => profile?.ogrn.trim() ?? ""],
      [/банковск/i, () => bank],
      [/расчётн.*счёт|р\/с/i, () => profile?.account.trim() ?? ""],
      [/контактн.*телефон|телефон/i, () => profile?.phone.trim() ?? ""],
      [/электронн.*почт|e-?mail/i, () => profile?.email.trim() ?? ""],
      [/руководитель|директор|единолично/i, () => profile?.head.trim() ?? ""],
    ];
    body.push(
      table([
        headerRow([["Наименование сведений", 50], ["Сведения об участнике", 50]]),
        ...form.participantFields.map((field): Row => {
          const value = KNOWN.find(([re]) => re.test(field))?.[1]() ?? "";
          return {
            cells: [textCell(field, 50), cell([para(value ? [run(value)] : withFields("[заполните]"))], 50)],
          };
        }),
      ])
    );
  }

  // Раздел: согласие и предмет (товар/услуга) — из формы заказчика.
  const sectionNum = form.participantFields.length > 0 ? 2 : 1;
  if (form.consent) {
    body.push(appHeading(`${sectionNum}. Согласие участника`));
    body.push(...paragraphs(fillFromProfile(form.consent, profile), { indent: true }));
  }
  if (goods.length) {
    // Таблица товаров: воспроизводим структуру формы заказчика когда она есть.
    body.push(goodsTableOf(goods, form.goodsTableHeaders ?? []));
  }
  if (items.length) {
    if (goods.length) body.push(para([], { before: 8 }));
    body.push(
      table([
        headerRow([["№ п/п", 7], ["Требование заказчика", 43], ["Предложение участника закупки", 50]]),
        ...items.map((it, i): Row => ({
          cells: [textCell(`${i + 1}.`, 7), textCell(it.requirement, 43), cell(paragraphs(it.offer), 50)],
        })),
      ])
    );
  }

  // Раздел: предложение о цене.
  if (form.hasPrice) {
    const nextNum = sectionNum + (form.consent || goods.length || items.length ? 1 : 0);
    const amount = price
      ? `${formatRubles(Math.floor(price)).replace(/,00$/, "")} руб. (${rublesInWords(Math.floor(price)).replace(/ 00 копеек$/, "")})`
      : "[цена договора цифрами] руб. ([цена прописью])";
    body.push(
      appHeading(`${nextNum}. Предложение о цене`),
      ...paragraphs(
        `Предлагаемая цена договора: ${amount}.${form.priceNote.trim() ? " " + form.priceNote.trim() : ""}`,
        { indent: true }
      )
    );
  }

  // Раздел: декларация МСП.
  if (form.smeDeclaration) {
    body.push(
      appHeading("Декларация о принадлежности к субъектам малого и среднего предпринимательства"),
      ...paragraphs(fillFromProfile(form.smeDeclaration, profile), { indent: true })
    );
  }

  // Дополнительные бланки из документов закупки — после основного содержания, каждый со своим заголовком.
  // Правило: строки бланка воспроизводятся дословно и в том же порядке; пустое поле — жёлтым «[заполните]».
  for (const df of detectedForms ?? []) body.push(...detectedFormBlocks(df));

  body.push(...signature(profile));
  return body;
}

// ЕАИСТ Москвы: стандартная форма Приложения № 1 для запроса котировок только для МСП.
// Структура фиксирована и воспроизводится слово в слово по типовому бланку.
function eaistApplicationBody({ form, goods, price, profile }: TpDocx): Block[] {
  const bank = profile
    ? [profile.account, profile.bankName, profile.bik ? `БИК ${profile.bik}` : "", profile.corrAccount ? `к/с ${profile.corrAccount}` : ""].filter(Boolean).join(", ")
    : "";
  const name = profile?.fullName.trim() ?? "";
  const body: Block[] = [];

  // Шапка приложения — в правой половине листа, как в форме заказчика.
  const msp = Boolean(form.smeDeclaration?.trim());
  body.push(
    para(
      [
        run(
          `Приложение № 1 к информационной карте запроса котировок в электронной форме${msp ? ", участниками которой могут быть только субъекты малого и среднего предпринимательства" : ""}`
        ),
      ],
      { left: 240, after: 18 }
    ),
    para([run("ЗАЯВКА", { bold: true })], { align: "center", after: 2 }),
    para([run("на участие в запросе котировок в электронной форме")], { align: "center", after: 12 }),
    para([run("Если участник закупки является юридическим лицом")], { align: "center", after: 6 })
  );

  // Пункт 1: сведения об участнике — одна таблица, внутри неё же вторая часть «для физического лица».
  body.push(
    table([
      headerRow([["№ п/п", APP_COLS[0]], ["Название пункта", APP_COLS[1]], ["Информация", APP_COLS[2]]]),
      appRow("1.", "Данные об участнике закупки, подавшем настоящую заявку в случае если участник закупки является юридическим лицом", "", false),
      appRow("1.1", "Наименование", name),
      appRow("1.2", "Место нахождения", profile?.legalAddress.trim() ?? ""),
      appRow("1.3", "Банковские реквизиты", bank),
      appRow("1.4.", "ИНН (при наличии) учредителей участника закупки", "", false),
      appRow("1.5", "ИНН (при наличии) членов коллегиального исполнительного органа участника закупки", "", false),
      appRow("1.6", "ИНН (при наличии) единоличного исполнительного органа участника закупки", "", false),
      appRow("1.7", "ИНН участника закупки (при наличии)", profile?.inn.trim() ?? ""),
      appNote("Если участник закупки является физическим лицом, в том числе индивидуальным предпринимателем"),
      appRow("1.8", "Фамилия", "", false),
      appRow("1.9", "Имя", "", false),
      appRow("1.10", "Отчество (при наличии)", "", false),
      appRow("1.11", "Место жительства", "", false),
      appRow("1.12", "Банковские реквизиты", "", false),
    ])
  );

  // Пункт 2: согласие и сведения о товаре.
  body.push(
    appHeading("2. Согласие участника закупки исполнить условия договора, сведения о товаре"),
    appPara(
      "Изучив извещение о проведении запроса котировок в электронной форме № __________ (номер извещения о проведении запроса котировок в электронной форме, который указан на официальном сайте единой информационной системы), выражаю согласие исполнить все условия договора, которые приведены в указанном извещении."
    ),
    appPara("Предлагаю поставить следующий товар (в случае поставки товара или выполнения работ, оказания услуг и использованием товара):"),
    table([
      headerRow([["№ п/п", 10], ["Наименование товара", 30], ["Характеристики товара", 60]]),
      ...(goods.length
        ? goods.map((g, i): Row => ({ cells: [textCell(`${i + 1}.`, 10), textCell(g.name, 30), cell(paragraphs(g.characteristics), 60)] }))
        : [
            {
              cells: [
                textCell("1.", 10),
                cell([para(withFields("[наименование товара]"))], 30),
                cell([para([run("Приводятся сведения по всем характеристикам товара, указанным в извещении о проведении запроса котировок в электронной форме")])], 60),
              ],
            } as Row,
          ]),
    ])
  );

  // Пункт 3: цена. Известна цена с шага «Цена» — вписана; нет — пропуски формы остаются.
  const rub = price ? Math.floor(price) : 0;
  const kop = price ? String(Math.round((price - rub) * 100)).padStart(2, "0") : "";
  const priceText = price
    ? `Предлагаемая цена договора составляет ${formatRubles(rub).replace(/,00$/, "")} руб. (${rublesInWords(rub).replace(/ 00 копеек$/, "")}) ${kop} коп., в том числе НДС (указывается, если участник является плательщиком НДС) по ставке ___% - _________ руб. (указывается цифрами и прописью) ___ коп. (указывается цифрами).`
    : "Предлагаемая цена договора составляет ___________ руб. (указывается цифрами и прописью) ____ коп. (указывается цифрами), в том числе НДС (указывается, если участник является плательщиком НДС) по ставке ___% - _________ руб. (указывается цифрами и прописью) ___ коп. (указывается цифрами).";
  body.push(
    appHeading("3. Предложение о цене договора"),
    appPara(priceText),
    appPara(
      "В указанную цену входят все расходы, необходимые для исполнения обязательств по договору в полном объеме и с надлежащим качеством. В нее включены все подлежащие к уплате налоги, сборы и другие обязательные платежи, а также иные расходы, связанные с поставкой товаров по договору."
    )
  );

  // Пункт 4: декларация МСП — только если запрос котировок проводится для субъектов МСП.
  if (msp) {
    const category = profile?.smeCategory.trim();
    body.push(
      appHeading(
        "4. Декларация о принадлежности к субъектам малого предпринимательства или социально ориентированным некоммерческим организациям (информация отражается в случае, если настоящий запрос котировок проводится только для указанных субъектов и организаций)"
      ),
      appPara(
        `Настоящим подтверждаю принадлежность к субъектам малого предпринимательства (социально ориентированным некоммерческим организациям) ${category ? `— ${category}.` : "(указать соответствующую категорию лиц)."}`
      ),
      appPara(
        name
          ? `Участник запроса котировок в электронной форме ${name}.`
          : "Участник запроса котировок в электронной форме _______________ (указывается наименование юридического лица либо фамилия, имя, отчество (при наличии) физического лица)."
      ),
      appPara(`Подпись, расшифровка подписи _________________________${profile?.signer.trim() ? ` / ${profile.signer.trim()} /` : ""}`)
    );
  } else {
    body.push(appPara(`Подпись, расшифровка подписи _________________________${profile?.signer.trim() ? ` / ${profile.signer.trim()} /` : ""}`));
  }
  return body;
}

// Диспетчер: ЕАИСТ-форма — для запроса котировок и по умолчанию (до ИИ source пуст);
// произвольная форма — когда ИИ нашёл форму с другим источником.
function applicationBody(data: TpDocx): Block[] {
  const { form } = data;
  // Generic — только если ИИ явно указал источник, не связанный с запросом котировок.
  if (form.source.trim() && !/запрос котировок/i.test(form.title) && !/информационной карте/i.test(form.source)) {
    return genericApplicationBody(data);
  }
  return eaistApplicationBody(data);
}

const BODIES: Record<TpPart, (data: TpDocx) => Block[]> = {
  tp: tpBody,
  participant: participantBody,
  declaration: declarationBody,
  price: priceBody,
  experience: experienceBody,
  staff: staffBody,
  application: applicationBody,
};

const docTitle = (text: string): Para => para([run(text, { bold: true, size: 14 })], { align: "center", after: 6 });

// Часть заявки из данных закупки и реквизитов: техническое предложение, анкета, декларация, цена, опыт, специалисты.
export function modelOfTp(part: TpPart, data: TpDocx): DocModel {
  // Бланк заказчика начинается со своей шапки — общий заголовок и «Предмет закупки» к нему не добавляем.
  // Для произвольной (не ЕАИСТ) формы — заголовок из form.title; для ЕАИСТ и дефолта — стандартный.
  if (part === "application" && data.blankOnly && data.detectedForms?.[0]) {
    const blank = data.detectedForms[0];
    return { title: blank.title, blocks: detectedFormBlocks(blank) };
  }
  if (part === "application") {
    const isGeneric =
      data.form.source.trim() &&
      !/запрос котировок/i.test(data.form.title) &&
      !/информационной карте/i.test(data.form.source);
    const title = isGeneric ? data.form.title || PART_TITLES[part] : PART_TITLES[part];
    return { title, blocks: applicationBody(data) };
  }
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
