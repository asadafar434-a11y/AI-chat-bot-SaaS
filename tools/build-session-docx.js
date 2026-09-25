/* Памятка для занятия с мамой: настоящая закупка в «Тендерном юристе» — что подготовить,
   как вести, что замерять и что спросить. Оформление — как у дорожной карты (build-roadmap-docx.js).
   Всё содержание — в данных вверху файла. */
const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, CheckBox, Footer,
  WidthType, BorderStyle, ShadingType, AlignmentType, HeadingLevel, LevelFormat, PageNumber,
  PositionalTab, PositionalTabAlignment, PositionalTabRelativeTo, PositionalTabLeader, VerticalAlign,
} = require("docx");

const DATE = "25 сентября 2026";
const DATE_SHORT = "25.09.2026";

// ---------- содержание ----------

const GOAL =
  "Цель этапа 1 из дорожной карты — мама сама, без вашей помощи, готовит ТП по настоящей закупке и называет, " +
  "сколько времени сэкономила. Занятие покажет, где она запинается и можно ли доверять тому, что пишет ИИ. " +
  "Проведите его на 3–5 закупках — по одной за раз.";

const PREPARE = [
  ["Ссылка на приложение и пароль", "или ваш компьютер с запущенным приложением"],
  ["1–3 настоящие закупки, по которым мама сейчас готовит заявку", "извещение, ТЗ и проект контракта — в том виде, в каком она их получает, сканы тоже"],
  ["Её прошлые заявки, анкеты и карточка предприятия — если захочет", "загрузить в «Образцы и реквизиты»: по ним приложение пишет в её стиле и заполняет реквизиты"],
  ["Час на первую закупку", "дальше обычно быстрее"],
  ["Секундомер и эта памятка", "записывать по ходу, а не по памяти после"],
];

const BEFORE = [
  "Сколько времени у вас уходит на ТП по такой закупке, если делать как обычно?",
  "Что в подготовке ТП самое долгое и нудное?",
  "За что в последний раз отклонили заявку?",
];

const RULES = [
  "Не подсказывайте и не нажимайте за маму. Спросила «куда нажать?» — ответьте «а куда бы вы нажали?» и запишите вопрос.",
  "Попросите думать вслух: что видит, чего ждёт, что непонятно.",
  "Помогайте, только если она застряла дольше 2–3 минут, — и отметьте, где.",
  "Не объясняйте интерфейс и не спорьте — всё записывайте, разберём потом.",
  "Каждое сомнение мамы в тексте ИИ — находка: запишите, что именно не так.",
];

const TASKS = [
  "Создать закупку: загрузить документы",
  "Шаг 1 «Требования»: найти, кто может участвовать и что подать в заявке",
  "Проверить три пункта требований по цитатам: всё верно?",
  "Найти в документах через «Поиск», например, «обеспечение» или «неустойка»",
  "Шаг 2: составить ТП и вписать свои данные в жёлтые поля",
  "Скачать ТП в Word и открыть: можно подавать? Сколько правок нужно?",
  "Шаг 3: загрузить заявку или ТП на проверку и разобрать, что нашлось",
  "Задать вопрос по закупке в «Вопросах»",
];

const MEASURES = [
  ["ТП вручную, со слов мамы", "мин"],
  ["ТП в приложении: от загрузки документов до файла Word, который можно подавать", "мин"],
  ["Экономия времени", "мин"],
  ["Ошибок ИИ в трёх проверенных пунктах требований", "из 3"],
  ["Правок в Word после скачивания", ""],
  ["Ошибок и замечаний при проверке заявки — из них ложных", ""],
];

const AFTER = [
  "Подали бы заявку с этим ТП? Что пришлось бы переделать?",
  "Что было непонятно или лишним?",
  "В следующей закупке воспользуетесь сами — без меня?",
  "Чего не хватило, чтобы пользоваться каждый раз?",
  "Сколько времени в месяц это сэкономит при ваших 1–5 закупках?",
];

const CAREFUL = [
  ["Закупки хранятся только в этом браузере.", "Не чистите данные браузера и открывайте приложение там же, где создавали закупки."],
  ["Сканы.", "Цифры, даты и суммы из файлов со скана сверяйте с оригиналом — приложение помечает такие файлы."],
  ["ИИ — не юрист.", "Его ответы — подсказка, а не юридическая консультация; нормы проверяйте по первоисточнику."],
];

const DONE =
  "по заметкам правим то, где мама запнулась. Этап 1 закрыт, когда мама сама подготовила ТП по настоящей закупке " +
  "и назвала, сколько времени сэкономила.";

// ---------- оформление ----------

const FONT = "Calibri";
const SYMBOL_FONT = "Segoe UI Symbol";
const W = 9638; // ширина текста на A4 при полях 2 см

const INK = "14142B";
const INK_2 = "474763";
const INK_3 = "77778F";
const BRAND = "312E81";
const BRAND_DK = "26246A";
const BRAND_TINT = "E2E1F3";
const PAPER_2 = "F6F6FB";
const LINE = "DEDDEB";
const WARN_TEXT = "9A5A0C";

const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
const LINES = {
  ...NO_BORDERS,
  top: { style: BorderStyle.SINGLE, size: 4, color: LINE },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: LINE },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: LINE },
};
const cellMargins = { top: 90, bottom: 90, left: 120, right: 120 };

const H1 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 480, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BRAND, space: 8 } },
    children: [new TextRun(text)],
  });

const P = (children, opts = {}) =>
  new Paragraph({
    spacing: { after: opts.after ?? 140, line: 288 },
    keepNext: opts.keepNext,
    children: typeof children === "string" ? [new TextRun({ text: children, color: opts.color, size: opts.size })] : children,
  });

const numbered = (reference, items) =>
  items.map(
    (t, i) =>
      new Paragraph({
        numbering: { reference, level: 0 },
        spacing: { after: 80, line: 276 },
        keepNext: i < items.length - 1,
        children: [new TextRun(t)],
      })
  );

const box = () =>
  new Paragraph({
    style: "Box",
    children: [
      new CheckBox({
        checked: false,
        checkedState: { value: "2611", font: SYMBOL_FONT },
        uncheckedState: { value: "2610", font: SYMBOL_FONT },
      }),
    ],
  });

const text = (value, opts = {}) =>
  new Paragraph({
    alignment: opts.align,
    spacing: { after: 0, line: 264 },
    children: [new TextRun({ text: value, size: opts.size ?? 20, bold: opts.bold, color: opts.color ?? INK })],
  });

const cell = (width, children, opts = {}) =>
  new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: cellMargins,
    verticalAlign: opts.center ? VerticalAlign.CENTER : undefined,
    shading: opts.fill ? { type: ShadingType.CLEAR, color: "auto", fill: opts.fill } : undefined,
    children,
  });

// Заголовок таблицы — тинтом бренда, как в таблице рисков дорожной карты.
const headRow = (cols, titles) =>
  new TableRow({
    tableHeader: true,
    children: titles.map((t, i) => cell(cols[i], [text(t, { bold: true, size: 19, color: BRAND_DK })], { fill: BRAND_TINT })),
  });

function prepareTable() {
  const cols = [640, W - 640];
  return new Table({
    columnWidths: cols,
    width: { size: W, type: WidthType.DXA },
    borders: { ...LINES, insideVertical: NONE },
    rows: PREPARE.map(
      ([what, note]) =>
        new TableRow({
          cantSplit: true,
          children: [
            cell(cols[0], [box()], { center: true }),
            cell(cols[1], [
              new Paragraph({ spacing: { after: 30, line: 264 }, children: [new TextRun({ text: what, size: 21 })] }),
              new Paragraph({ spacing: { after: 0, line: 252 }, children: [new TextRun({ text: note, size: 18, color: INK_3 })] }),
            ]),
          ],
        })
    ),
  });
}

// Вопрос и место под ответ.
function answersTable(questions) {
  const cols = [4800, W - 4800];
  return new Table({
    columnWidths: cols,
    width: { size: W, type: WidthType.DXA },
    borders: LINES,
    rows: questions.map(
      (q, k) =>
        new TableRow({
          cantSplit: true,
          height: { value: 620, rule: "atLeast" },
          children: [cell(cols[0], [text(q)], { fill: k % 2 ? PAPER_2 : undefined }), cell(cols[1], [text("")])],
        })
    ),
  });
}

function tasksTable() {
  const cols = [3900, 1000, 1500, W - 6400];
  return new Table({
    columnWidths: cols,
    width: { size: W, type: WidthType.DXA },
    borders: LINES,
    rows: [
      headRow(cols, ["Задание", "Мин", "Сама / с подсказкой", "Где запнулась, что сказала"]),
      ...TASKS.map(
        (t, k) =>
          new TableRow({
            cantSplit: true,
            height: { value: 700, rule: "atLeast" },
            children: [
              cell(cols[0], [text(`${k + 1}. ${t}`)], { fill: k % 2 ? PAPER_2 : undefined }),
              cell(cols[1], [text("")]),
              cell(cols[2], [text("")]),
              cell(cols[3], [text("")]),
            ],
          })
      ),
    ],
  });
}

function measuresTable() {
  const cols = [6200, W - 6200];
  return new Table({
    columnWidths: cols,
    width: { size: W, type: WidthType.DXA },
    borders: LINES,
    rows: MEASURES.map(
      ([what, unit], k) =>
        new TableRow({
          cantSplit: true,
          height: { value: 520, rule: "atLeast" },
          children: [
            cell(cols[0], [text(what)], { center: true, fill: k % 2 ? PAPER_2 : undefined }),
            cell(cols[1], [text(unit, { align: AlignmentType.RIGHT, color: INK_3, size: 18 })], { center: true }),
          ],
        })
    ),
  });
}

function summaryTable() {
  const cols = [500, 2700, 1400, 1500, 1200, W - 7300];
  return new Table({
    columnWidths: cols,
    width: { size: W, type: WidthType.DXA },
    borders: LINES,
    rows: [
      headRow(cols, ["№", "Закупка", "ТП вручную, мин", "ТП в приложении, мин", "Экономия", "Главная запинка"]),
      ...[1, 2, 3, 4, 5].map(
        (n) =>
          new TableRow({
            cantSplit: true,
            height: { value: 620, rule: "atLeast" },
            children: cols.map((w, i) => cell(w, [text(i === 0 ? String(n) : "", { color: INK_3 })], { center: true })),
          })
      ),
    ],
  });
}

// Врезки с цветной чертой слева — как «Готово, когда» в дорожной карте.
const Callouts = (rows) =>
  new Table({
    columnWidths: [W],
    width: { size: W, type: WidthType.DXA },
    borders: { ...NO_BORDERS, insideHorizontal: { style: BorderStyle.SINGLE, size: 16, color: "FFFFFF" } },
    rows: rows.map(
      ([label, body, color]) =>
        new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              width: { size: W, type: WidthType.DXA },
              margins: { top: 110, bottom: 110, left: 220, right: 220 },
              shading: { type: ShadingType.CLEAR, color: "auto", fill: PAPER_2 },
              borders: { top: NONE, bottom: NONE, right: NONE, left: { style: BorderStyle.SINGLE, size: 24, color } },
              children: [
                new Paragraph({
                  spacing: { after: 0, line: 276 },
                  children: [new TextRun({ text: `${label} `, bold: true, color }), new TextRun({ text: body, color: INK_2 })],
                }),
              ],
            }),
          ],
        })
    ),
  });

// ---------- документ ----------

function build() {
  const children = [
    new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: `ПАМЯТКА · ЭТАП 1 ДОРОЖНОЙ КАРТЫ · ${DATE.toUpperCase()}`, bold: true, size: 18, color: BRAND, characterSpacing: 30 })],
    }),
    new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: "Тендерный юрист", bold: true, size: 56, color: BRAND_DK })],
    }),
    new Paragraph({
      spacing: { after: 240 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BRAND, space: 12 } },
      children: [new TextRun({ text: "Занятие с мамой: настоящая закупка от документов до готового ТП", size: 26, color: INK_2 })],
    }),
    P(GOAL, { after: 200 }),

    H1("1. Подготовить заранее"),
    prepareTable(),

    H1("2. Перед началом — спросить"),
    P("Ответы — отправная точка: с ними сравним время в приложении.", { color: INK_2, keepNext: true }),
    answersTable(BEFORE),

    H1("3. Как вести занятие"),
    ...numbered("rules", RULES),

    H1("4. Задания"),
    P("Время — по секундомеру на каждое задание. «Сама» — без единой подсказки.", { color: INK_2, keepNext: true }),
    tasksTable(),

    H1("5. Замеры"),
    measuresTable(),

    H1("6. После занятия — спросить"),
    answersTable(AFTER),

    H1("7. Сводка по 3–5 закупкам"),
    P("Одна строка — одна закупка. По этой таблице видно, растёт ли экономия от раза к разу.", { color: INK_2, keepNext: true }),
    summaryTable(),

    new Paragraph({ spacing: { before: 360, after: 120 }, keepNext: true, children: [new TextRun({ text: "Важно", bold: true, size: 26, color: BRAND })] }),
    Callouts(CAREFUL.map(([label, body]) => [label, body, WARN_TEXT])),
    new Paragraph({ spacing: { after: 160 }, children: [] }),
    Callouts([["Что дальше:", DONE, BRAND]]),
  ];

  return new Document({
    creator: "Тендерный юрист",
    title: "Тендерный юрист — памятка для занятия с мамой",
    description: `Памятка на ${DATE}`,
    styles: {
      default: { document: { run: { font: FONT, size: 22, color: INK } } },
      paragraphStyles: [
        {
          id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { font: FONT, size: 30, bold: true, color: BRAND_DK },
          paragraph: { outlineLevel: 0, keepNext: true },
        },
        {
          id: "Box", name: "Checkbox", basedOn: "Normal",
          run: { size: 30, color: INK_3 },
          paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 } },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: "rules",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 420, hanging: 320 } }, run: { bold: true, color: BRAND } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1020, bottom: 1020, left: 1134, right: 1134, footer: 500 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: `Тендерный юрист · памятка для занятия с мамой · ${DATE_SHORT}`, size: 16, color: INK_3 }),
                  new TextRun({
                    children: [
                      new PositionalTab({
                        alignment: PositionalTabAlignment.RIGHT,
                        relativeTo: PositionalTabRelativeTo.MARGIN,
                        leader: PositionalTabLeader.NONE,
                      }),
                      "стр. ",
                      PageNumber.CURRENT,
                    ],
                    size: 16,
                    color: INK_3,
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
}

const out = process.argv[2] || "Тендерный юрист — памятка для занятия с мамой.docx";
Packer.toBuffer(build()).then((buf) => {
  fs.writeFileSync(out, buf);
  console.log(`Готово: ${out}`);
});
