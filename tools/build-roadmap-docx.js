/* Чек-лист и дорожная карта «Тендерного юриста».
   Всё содержание — в данных вверху файла: поменяли статус пункта — пересобрали документ,
   и счётчики «готово N из M» пересчитаются сами. */
const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, CheckBox, Footer,
  WidthType, BorderStyle, ShadingType, AlignmentType, HeadingLevel, LevelFormat, PageNumber,
  PositionalTab, PositionalTabAlignment, PositionalTabRelativeTo, PositionalTabLeader,
  VerticalAlign, HeightRule,
} = require("docx");

const DATE = "25 сентября 2026";
const DATE_SHORT = "25.09.2026";

// ---------- содержание ----------

// done — готово, work — в работе, todo — впереди. Третий элемент — пояснение серым.
const CHECKLIST = [
  {
    title: "Приложение: что уже есть",
    items: [
      ["done", "Загружать документы закупки: PDF, Word (.docx), текст", "можно несколько файлов сразу"],
      ["done", "Выписывать требования: кто может участвовать, что подать, что требует ТЗ, сроки и деньги", "у каждого пункта — точная цитата из документа"],
      ["done", "Сверять цитаты с документами", "если цитата не нашлась дословно, просит сверить пункт вручную"],
      ["done", "Составлять черновик технического предложения по пунктам ТЗ", "свои данные — жёлтые поля, правятся прямо на экране"],
      ["done", "Скачивать техническое предложение в Word", "жёлтые поля остаются жёлтыми и в файле"],
      ["done", "Отвечать на вопросы по закупке", "со ссылкой на пункт документа и статью закона"],
      ["done", "Показывать пример на вымышленной закупке", "всё можно посмотреть без своих документов"],
      ["done", "Предупреждать, что ответы ИИ — не юридическая консультация", ""],
      ["done", "«Мои закупки»: список закупок, экран закупки, срок подачи с обратным отсчётом", ""],
      ["done", "Читать сканы и фото", "распознаёт ИИ, до 60 страниц за раз; такие файлы помечены — цифры, даты и суммы сверить с оригиналом"],
      ["done", "Читать старые файлы Word (.doc) и RTF", ""],
      ["done", "Отвечать по тексту 44-ФЗ и 223-ФЗ в действующей редакции", "тексты с официального портала pravo.gov.ru; другие нормы ИИ пока знает по памяти"],
      ["done", "«Мои данные»: реквизиты вписываются один раз или берутся из своих документов", "попадают в анкету, декларацию и цену; по своим образцам ИИ пишет эти части заявки"],
      ["done", "Боковое меню: закупки по срочности и разделы открытой закупки всегда под рукой", "на телефоне — выезжает по кнопке"],
    ],
  },
  {
    title: "Приложение: что впереди",
    items: [
      ["todo", "Проверка заявки перед подачей: сверить свою заявку с ТЗ и узнать, за что могут отклонить", "есть в прототипе; у мамы было отклонение заявки"],
      ["todo", "Поиск по документам по словам", "просьба мамы из интервью"],
      ["todo", "Кнопка «Спросить юриста»: вопрос уходит живому юристу по закупкам", "в прототипе — только заглушка"],
    ],
  },
  {
    title: "Дизайн",
    items: [
      ["done", "Фирменный стиль: индиго, мягкие скругления, шрифты с кириллицей", ""],
      ["done", "Кликабельный прототип всех экранов", "с боковым меню и всем, что уже умеет приложение; проверка заявки — «скоро»"],
      ["done", "Простая схема: список закупок → закупка → отдельный экран на каждую задачу", "после отзыва «слишком сложно и перегружено»"],
    ],
  },
  {
    title: "Проверка идеи и клиенты",
    items: [
      ["done", "Первое интервью — мама, 19 лет в тендерах", "главная боль — ТП: от 15 минут до 2 часов на каждое"],
      ["done", "Дозадать маме три вопроса", "документы приходят и сканами, и с текстом; 1–5 закупок в месяц; коллеги для разговора есть"],
      ["todo", "Мама сама, без подсказок, проходит 3–5 реальных закупок", "где запнулась и сколько времени ушло на ТП: было / стало"],
      ["todo", "5–10 интервью с поставщиками не из семьи", "одного интервью с родственницей мало"],
      ["todo", "Конкуренты: кто уже делает ИИ для тендеров и сколько берёт", ""],
      ["todo", "Цена: за что и сколько готовы платить", "мама сказала «не хочу платить» — нужны ответы других"],
      ["todo", "Название: подходит ли «Тендерный юрист», если главная польза — ТП, а не консультации", ""],
    ],
  },
  {
    title: "Деньги и юридическое",
    items: [
      ["todo", "Посчитать экономику: сколько стоит один черновик ТП на ИИ, цена для клиента, окупаемость", "старый разбор считал прошлую идею, «Отклик»"],
      ["todo", "Проверить, можно ли давать сервис на Claude пользователям из России", "официально Claude там недоступен; запасной вариант — российская модель"],
      ["todo", "Персональные данные по 152-ФЗ: политика, уведомление в Роскомнадзор, где хранятся данные", "до того, как собирать почту и документы клиентов"],
      ["todo", "ИП, договор-оферта, приём оплаты", "ИП выбрали ещё для прошлой идеи"],
    ],
  },
  {
    title: "Запуск",
    items: [
      ["done", "Приложение работает на вашем компьютере, ИИ подключён", ""],
      ["done", "Код хранится на GitHub", ""],
      ["done", "Сохранить на GitHub последнюю версию", "с «Моими закупками» и «Моими данными»"],
      ["todo", "Выложить в интернет по закрытой ссылке — сначала только для мамы", "чтобы открывала без вашего компьютера"],
      ["todo", "Вход по почте и хранение закупок на сервере", "сейчас закупки лежат в одном браузере и пропадут при его очистке"],
      ["todo", "Лимит расходов на ИИ для каждого пользователя", "чтобы один клиент не съел бюджет"],
      ["todo", "Обновить описание проекта для ИИ-помощника", "в нём ещё старая идея про чат поддержки"],
    ],
  },
];

// Экраны приложения: уровень вложенности, название, статус.
const SCREENS = [
  [0, "Мои закупки", "done"],
  [1, "Новая закупка", "done"],
  [1, "Закупка: срок подачи, заказчик, цена, документы", "done"],
  [2, "Требования", "done"],
  [2, "Техническое предложение", "done"],
  [2, "Проверка заявки", "todo"],
  [2, "Вопросы по закупке", "done"],
  [0, "Спросить про тендер: вопросы не об одной закупке", "done"],
  [0, "Мои данные: реквизиты и свои документы", "done"],
  [0, "Боковое меню со списком закупок", "done"],
];

const NEXT_STEPS = [
  "Сделать «Проверку заявки» по готовому прототипу.",
  "Выложить приложение в интернет по закрытой ссылке, чтобы мама открывала его сама.",
];

const ASK =
  "Договоритесь с коллегами мамы о получасовом разговоре — это первые из 5–10 интервью в октябре. " +
  "И попросите маму дать одну-две настоящие закупки, где есть сканы: на них проверим, насколько точно приложение распознаёт цифры.";

const MONTHS = ["Сен", "Окт", "Ноя", "Дек", "2027"];

// state: done — сделано, now — идёт сейчас, next — впереди. months — индексы в MONTHS.
const STAGES = [
  {
    name: "Фундамент", when: "22–24 сентября", state: "done", months: [0],
    goal: "Понять, что строим, и собрать основу приложения.",
    tasks: [
      "Новая идея: помощник по тендерам вместо чата поддержки",
      "Фирменный стиль и кликабельный прототип всех экранов",
      "Первое интервью: главная боль — техническое предложение",
      "Приложение: требования, черновик ТП с выгрузкой в Word, вопросы по документам",
    ],
  },
  {
    name: "Рабочая версия для мамы", when: "25 сентября – 9 октября", state: "now", months: [0, 1],
    goal: "Мама сама, без вашей помощи, готовит ТП по настоящей закупке.",
    tasks: [
      "Сохранить «Мои закупки» на GitHub — готово",
      "Реквизиты участника в анкете, декларации и цене — готово",
      "Боковое меню, как в прототипе — готово",
      "Проверка заявки перед подачей",
      "Поиск по документам по словам",
      "Выложить в интернет по закрытой ссылке",
      "Мама проходит 3–5 реальных закупок; замеряем время на ТП «было / стало»",
    ],
    done: "мама сама подготовила ТП по реальной закупке и назвала, сколько времени сэкономила.",
  },
  {
    name: "Проверка спроса", when: "октябрь, параллельно с этапом 1", state: "next", months: [1],
    goal: "Узнать у людей не из семьи, нужен ли продукт и за сколько.",
    tasks: [
      "Дозадать маме три вопроса: сканы, объём, коллеги — готово",
      "5–10 интервью с поставщиками: начать с коллег мамы, потом тендерные чаты и сообщества",
      "3–5 из них бесплатно пробуют приложение на своих закупках",
      "Конкуренты и их цены",
      "Экономика: сколько один ТП стоит нам и сколько готов платить клиент",
      "Решить вопрос с ИИ для пользователей из России",
      "Название: оставить или поменять",
    ],
    done: "минимум трое не из семьи пользуются регулярно, и один-два готовы платить.",
    gate: "Точка решения — конец октября. Если платить не готов никто, меняем направление, а не строим оплату.",
  },
  {
    name: "Первые платящие клиенты", when: "ноябрь", state: "next", months: [2],
    goal: "Сервисом можно пользоваться с любого компьютера и за него можно заплатить.",
    tasks: [
      "Вход по почте, закупки хранятся на сервере",
      "ИП, договор-оферта, приём оплаты",
      "Персональные данные по 152-ФЗ",
      "Лимит расходов на ИИ для каждого пользователя",
      "Страница с описанием продукта и ценой",
    ],
    done: "первый клиент заплатил сам, без уговоров.",
  },
  {
    name: "Доверие: закон и живой юрист", when: "декабрь, до 1 января", state: "next", months: [3],
    goal: "В ответе есть всё, что мама назвала условием доверия: статья закона, источник и второе мнение живого человека.",
    tasks: [
      "База 44-ФЗ и 223-ФЗ в действующей редакции: ответы ссылаются на текст статьи, а не на память ИИ — готово",
      "Обновлять базу, когда меняются законы, — обычно с 1 сентября и 1 января",
      "«Спросить юриста»: найти юриста по закупкам, договориться о цене и сроке ответа",
      "Набор из 10–20 реальных закупок, на котором проверяем каждую новую версию",
    ],
    done: "у каждого ответа есть действующая норма и источник, а вопрос юристу уходит одной кнопкой.",
  },
  {
    name: "Рост", when: "2027, если спрос подтвердится", state: "next", months: [4],
    goal: "Снять ручную работу со всей закупки, а не только с ТП.",
    tasks: [
      "Загрузка закупки по номеру с zakupki.gov.ru — без ручного скачивания файлов",
      "Напоминания о сроках: подача, итоги, исполнение контракта",
      "Подбор подходящих тендеров",
      "Помощь при исполнении контракта и спорах с заказчиком",
      "Несколько сотрудников в одной компании",
    ],
    decide: "по тому, что попросят первые платящие клиенты.",
  },
];

const RISKS = [
  ["Не захотят платить", "Мама сказала «не хочу платить», а юридические вопросы у неё — раз в год.", "Проверяем спрос на 5–10 поставщиках, прежде чем строить оплату. Продаём экономию времени на ТП, а не консультации."],
  ["Claude официально недоступен в России", "Правила Anthropic могут не разрешать сервис для пользователей из России.", "Проверить до открытия сервиса для всех. Запасной вариант — российская модель."],
  ["ИИ ошибается в законе", "44-ФЗ и 223-ФЗ он уже читает в действующей редакции, но постановления, ГК и КоАП знает по памяти, а законы меняются примерно дважды в год.", "Цитаты из документов и законов сверяются с текстом. Дальше — обновлять базу при изменениях законов и «Спросить юриста»."],
  ["Ошибки в сканах", "Документы приходят и сканами, и с текстом. ИИ распознаёт сканы, но может ошибиться в цифре, а она перейдёт в требования и ТП.", "Файлы со скана помечены, приложение просит сверить цифры с оригиналом. Проверить распознавание на реальных закупках мамы."],
  ["Закупки теряются", "Сейчас они хранятся в одном браузере и пропадут при его очистке.", "Хранение на сервере в ноябре. До тех пор приложение об этом предупреждает."],
  ["ИИ обходится дороже цены", "Каждый черновик ТП — запрос к самой мощной модели Claude; по большому ТЗ это заметные деньги. Каждая страница скана — ещё один запрос.", "Посчитать стоимость одного ТП в октябре, поставить лимиты, где можно — взять модель дешевле."],
  ["Выводы по одному интервью", "Одно интервью, и то с родственницей: рынок может думать иначе.", "5–10 интервью в октябре."],
];

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
const OK = "0D9F6E";
const OK_TEXT = "0B7A55";
const OK_TINT = "D8F5E9";
const WARN = "B4690E";
const WARN_TEXT = "9A5A0C";
const WARN_TINT = "FBEEDA";

const STATUS = {
  done: { label: "готово", color: OK_TEXT, fill: OK },
  work: { label: "в работе", color: WARN_TEXT, fill: WARN },
  todo: { label: "впереди", color: INK_3, fill: "D9D8E8" },
};

const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };

const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

const count = (items, status) => items.filter(([s]) => s === status).length;

const H1 = (text, newPage = true) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: newPage,
    spacing: newPage ? undefined : { before: 560, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BRAND, space: 8 } },
    children: [new TextRun(text)],
  });

const H2 = (text, aside) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [
      new TextRun(text),
      ...(aside ? [new TextRun({ text: `  ·  ${aside}`, bold: false, size: 20, color: INK_3 })] : []),
    ],
  });

const P = (children, opts = {}) =>
  new Paragraph({
    spacing: { after: opts.after ?? 140, line: 288 },
    keepNext: opts.keepNext,
    children: typeof children === "string" ? [new TextRun({ text: children, color: opts.color, size: opts.size })] : children,
  });

// Врезки с цветной чертой слева — «Готово, когда» и точка решения. Таблицей, а не абзацем
// с рамкой: у абзаца черта захватывает отступы и торчит ниже текста.
const Callouts = (rows) =>
  new Table({
    columnWidths: [W],
    width: { size: W, type: WidthType.DXA },
    borders: { ...NO_BORDERS, insideHorizontal: { style: BorderStyle.SINGLE, size: 16, color: "FFFFFF" } },
    rows: rows.map(
      ([label, text, color]) =>
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
                  children: [new TextRun({ text: `${label} `, bold: true, color }), new TextRun({ text, color: INK_2 })],
                }),
              ],
            }),
          ],
        })
    ),
  });

const cellMargins = { top: 90, bottom: 90, left: 120, right: 120 };

const box = (checked) =>
  new Paragraph({
    style: checked ? "BoxDone" : "BoxTodo",
    children: [
      new CheckBox({
        checked,
        checkedState: { value: "2611", font: SYMBOL_FONT },
        uncheckedState: { value: "2610", font: SYMBOL_FONT },
      }),
    ],
  });

function checklistTable(items) {
  const cols = [640, 6598, 2400];
  return new Table({
    columnWidths: cols,
    width: { size: W, type: WidthType.DXA },
    borders: {
      ...NO_BORDERS,
      top: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: LINE },
    },
    rows: items.map(([status, text, note]) => {
      const fill = status === "work" ? { type: ShadingType.CLEAR, color: "auto", fill: WARN_TINT } : undefined;
      return new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: cols[0], type: WidthType.DXA },
            margins: cellMargins,
            verticalAlign: VerticalAlign.CENTER,
            shading: fill,
            children: [box(status === "done")],
          }),
          new TableCell({
            width: { size: cols[1], type: WidthType.DXA },
            margins: cellMargins,
            verticalAlign: VerticalAlign.CENTER,
            shading: fill,
            children: [
              new Paragraph({ spacing: { after: note ? 30 : 0, line: 264 }, children: [new TextRun({ text, size: 21 })] }),
              ...(note ? [new Paragraph({ spacing: { after: 0, line: 252 }, children: [new TextRun({ text: note, size: 18, color: INK_3 })] })] : []),
            ],
          }),
          new TableCell({
            width: { size: cols[2], type: WidthType.DXA },
            margins: cellMargins,
            verticalAlign: VerticalAlign.CENTER,
            shading: fill,
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ text: STATUS[status].label, bold: true, size: 19, color: STATUS[status].color })],
              }),
            ],
          }),
        ],
      });
    }),
  });
}

// Полоса прогресса: доли готового, начатого и оставшегося.
function progressBar(all) {
  const parts = ["done", "work", "todo"].map((s) => [s, count(all, s)]).filter(([, n]) => n > 0);
  const widths = parts.map(([, n]) => Math.round((n / all.length) * W));
  widths[widths.length - 1] += W - widths.reduce((a, b) => a + b, 0);
  const blank = () => new Paragraph({ spacing: { before: 0, after: 0, line: 20 }, children: [new TextRun({ text: "", size: 2 })] });
  return new Table({
    columnWidths: widths,
    width: { size: W, type: WidthType.DXA },
    borders: NO_BORDERS,
    rows: [
      new TableRow({
        height: { value: 150, rule: HeightRule.EXACT },
        children: parts.map(([s], i) =>
          new TableCell({
            width: { size: widths[i], type: WidthType.DXA },
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
            shading: { type: ShadingType.CLEAR, color: "auto", fill: STATUS[s].fill },
            children: [blank()],
          })
        ),
      }),
    ],
  });
}

const square = (color) => new TextRun({ text: "■ ", font: SYMBOL_FONT, color, size: 20 });

function screenLine([level, name, status]) {
  return new Paragraph({
    spacing: { after: 60 },
    indent: { left: level * 420 },
    children: [
      new TextRun({ text: level ? "└ " : "", color: INK_3 }),
      new TextRun({ text: name, bold: level < 2 }),
      new TextRun({
        children: [
          new PositionalTab({
            alignment: PositionalTabAlignment.RIGHT,
            relativeTo: PositionalTabRelativeTo.MARGIN,
            leader: PositionalTabLeader.DOT,
          }),
          ` ${STATUS[status].label}`,
        ],
        bold: true,
        size: 20,
        color: STATUS[status].color,
      }),
    ],
  });
}

// Врезка в рамке с фоном — «Что нужно от вас».
function askBox(title, text) {
  return new Table({
    columnWidths: [W],
    width: { size: W, type: WidthType.DXA },
    borders: NO_BORDERS,
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: W, type: WidthType.DXA },
            margins: { top: 200, bottom: 200, left: 280, right: 280 },
            shading: { type: ShadingType.CLEAR, color: "auto", fill: BRAND_TINT },
            borders: { top: NONE, bottom: NONE, right: NONE, left: { style: BorderStyle.SINGLE, size: 36, color: BRAND } },
            children: [
              new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: title, bold: true, size: 24, color: BRAND_DK })] }),
              new Paragraph({ spacing: { after: 0, line: 288 }, children: [new TextRun({ text, color: INK })] }),
            ],
          }),
        ],
      }),
    ],
  });
}

const STAGE_FILL = { done: OK_TINT, now: BRAND, next: BRAND_TINT };
const STAGE_LABEL = { done: ["готово", OK_TEXT], now: ["идёт сейчас", BRAND], next: ["впереди", INK_3] };

function timeline() {
  const first = 3398;
  const month = (W - first) / MONTHS.length;
  const cols = [first, ...MONTHS.map(() => month)];
  const head = new TableRow({
    tableHeader: true,
    children: ["Этап", ...MONTHS].map((t, i) =>
      new TableCell({
        width: { size: cols[i], type: WidthType.DXA },
        margins: cellMargins,
        children: [
          new Paragraph({
            alignment: i ? AlignmentType.CENTER : AlignmentType.LEFT,
            children: [new TextRun({ text: t, bold: true, size: 19, color: INK_3 })],
          }),
        ],
      })
    ),
  });
  const rows = STAGES.map((st, n) =>
    new TableRow({
      cantSplit: true,
      children: [
        new TableCell({
          width: { size: cols[0], type: WidthType.DXA },
          margins: cellMargins,
          verticalAlign: VerticalAlign.CENTER,
          children: [
            new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: `${n}. ${st.name}`, bold: true, size: 20 })] }),
            new Paragraph({ children: [new TextRun({ text: st.when, size: 17, color: INK_3 })] }),
          ],
        }),
        ...MONTHS.map((_, m) => {
          const on = st.months.includes(m);
          const gate = st.gate && on;
          return new TableCell({
            width: { size: cols[m + 1], type: WidthType.DXA },
            margins: cellMargins,
            verticalAlign: VerticalAlign.CENTER,
            shading: on ? { type: ShadingType.CLEAR, color: "auto", fill: STAGE_FILL[st.state] } : undefined,
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: gate ? [new TextRun({ text: "◆", font: SYMBOL_FONT, size: 22, color: BRAND_DK })] : [],
              }),
            ],
          });
        }),
      ],
    })
  );
  return new Table({
    columnWidths: cols,
    width: { size: W, type: WidthType.DXA },
    borders: {
      ...NO_BORDERS,
      bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "FFFFFF" },
    },
    rows: [head, ...rows],
  });
}

function stageBlock(st, n) {
  const [label, color] = STAGE_LABEL[st.state];
  const notes = [
    ...(st.done ? [["Готово, когда", st.done, st.state === "done" ? OK_TEXT : BRAND]] : []),
    ...(st.decide ? [["Что именно делать — решим", st.decide, INK_3]] : []),
    ...(st.gate ? [["◆", st.gate, WARN_TEXT]] : []),
  ];
  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun(`Этап ${n}. ${st.name}`)],
    }),
    new Paragraph({
      keepNext: true,
      spacing: { after: 120 },
      children: [
        new TextRun({ text: st.when, bold: true, size: 20, color: INK_2 }),
        new TextRun({ text: `  ·  ${label}`, bold: true, size: 20, color }),
      ],
    }),
    P([new TextRun({ text: "Цель: ", bold: true }), new TextRun(st.goal)], { keepNext: true, after: 100 }),
    ...st.tasks.map(
      (t, i) =>
        new Paragraph({
          numbering: { reference: "tasks", level: 0, instance: n + 1 },
          spacing: { after: i === st.tasks.length - 1 && notes.length ? 180 : 60, line: 276 },
          keepNext: i === st.tasks.length - 1 && notes.length > 0,
          children: [new TextRun(t)],
        })
    ),
    ...(notes.length ? [Callouts(notes)] : []),
  ];
}

function risksTable() {
  const cols = [2500, 3400, 3738];
  const cell = (text, i, opts = {}) =>
    new TableCell({
      width: { size: cols[i], type: WidthType.DXA },
      margins: cellMargins,
      shading: opts.fill ? { type: ShadingType.CLEAR, color: "auto", fill: opts.fill } : undefined,
      children: [
        new Paragraph({
          spacing: { after: 0, line: 264 },
          children: [new TextRun({ text, size: opts.head ? 19 : 20, bold: opts.bold, color: opts.color ?? INK })],
        }),
      ],
    });
  return new Table({
    columnWidths: cols,
    width: { size: W, type: WidthType.DXA },
    borders: {
      ...NO_BORDERS,
      top: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: LINE },
    },
    rows: [
      new TableRow({
        tableHeader: true,
        children: ["Риск", "Почему это опасно", "Что делаем"].map((t, i) =>
          cell(t, i, { head: true, bold: true, color: BRAND_DK, fill: BRAND_TINT })
        ),
      }),
      ...RISKS.map(
        (r, k) =>
          new TableRow({
            cantSplit: true,
            children: r.map((t, i) => cell(t, i, { bold: i === 0, fill: k % 2 ? PAPER_2 : undefined })),
          })
      ),
    ],
  });
}

// ---------- документ ----------

function build() {
  const all = CHECKLIST.flatMap((g) => g.items);
  const done = count(all, "done");
  const work = count(all, "work");
  const todo = count(all, "todo");

  const cover = [
    new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: `ДОРОЖНАЯ КАРТА ПРОЕКТА · ${DATE.toUpperCase()}`, bold: true, size: 18, color: BRAND, characterSpacing: 30 })],
    }),
    new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: "Тендерный юрист", bold: true, size: 56, color: BRAND_DK })],
    }),
    new Paragraph({
      spacing: { after: 240 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BRAND, space: 12 } },
      children: [new TextRun({ text: "Чек-лист и дорожная карта: что сделано, что дальше и в каком порядке", size: 26, color: INK_2 })],
    }),

    H2("Коротко о проекте"),
    P(
      "«Тендерный юрист» — помощник для поставщиков в госзакупках по 44-ФЗ и 223-ФЗ. Загружаете документы закупки — " +
        "он выписывает требования и сроки, готовит черновик технического предложения по ТЗ и отвечает на вопросы " +
        "со ссылкой на пункт документа."
    ),
    P(
      "Для кого: поставщик, который сам готовит заявки. Главная боль по первому интервью — техническое предложение: " +
        "ручная сверка с ТЗ по пунктам занимает от 15 минут до 2 часов на каждую закупку. Юридические вопросы возникают " +
        "примерно раз в год, поэтому ответы юриста — дополнение, а не основа продукта."
    ),

    H2("Где мы сейчас"),
    P(
      [
        new TextRun({ text: `Готово ${done} из ${all.length} ${plural(all.length, "пункта", "пунктов", "пунктов")} чек-листа`, bold: true }),
        new TextRun(`, ${work} — в работе, ${todo} — впереди.`),
      ],
      { keepNext: true, after: 100 }
    ),
    progressBar(all),
    new Paragraph({
      spacing: { before: 80, after: 160 },
      children: [
        square(OK), new TextRun({ text: "готово    ", size: 18, color: INK_3 }),
        square(WARN), new TextRun({ text: "в работе    ", size: 18, color: INK_3 }),
        square("D9D8E8"), new TextRun({ text: "впереди", size: 18, color: INK_3 }),
      ],
    }),
    P(
      "Приложение работает на вашем компьютере: можно загрузить документы закупки, получить требования с цитатами, " +
        "черновик ТП с выгрузкой в Word и задать вопросы по документам. Следующая цель — чтобы мама сама подготовила ТП " +
        "по реальной закупке."
    ),
    P([new TextRun({ text: "Экраны приложения", bold: true, size: 20, color: INK_2 })], { keepNext: true, after: 80 }),
    ...SCREENS.map(screenLine),

    H2("Ближайшие шаги"),
    ...NEXT_STEPS.map(
      (t) =>
        new Paragraph({
          numbering: { reference: "steps", level: 0 },
          spacing: { after: 60, line: 276 },
          children: [new TextRun(t)],
        })
    ),
    new Paragraph({ spacing: { after: 160 }, children: [] }),
    askBox("Что нужно от вас", ASK),
  ];

  const checklist = [
    H1("1. Чек-лист"),
    P(
      [
        new TextRun({ text: "☑", font: SYMBOL_FONT, color: OK_TEXT }),
        new TextRun({ text: " готово   ", color: INK_2 }),
        new TextRun({ text: "☐", font: SYMBOL_FONT, color: INK_3 }),
        new TextRun({ text: " ещё нет   ", color: INK_2 }),
        new TextRun({ text: "жёлтая строка — в работе. ", color: INK_2 }),
        new TextRun({ text: "Квадратики живые: щёлкните по любому в Word, чтобы отметить пункт.", color: INK_2 }),
      ],
      { after: 80 }
    ),
    ...CHECKLIST.flatMap((g) => {
      const d = count(g.items, "done");
      const n = g.items.length;
      const aside = d === n ? "всё готово" : d ? `готово ${d} из ${n}` : `${n} ${plural(n, "пункт", "пункта", "пунктов")}`;
      return [H2(g.title, aside), checklistTable(g.items)];
    }),
  ];

  const roadmap = [
    H1("2. Дорожная карта"),
    P(
      "Шесть этапов: от того, что уже сделано, до роста в 2027 году. Сроки — ориентир при нынешнем темпе. " +
        "Следующий этап начинается, когда предыдущий ответил на свой вопрос.",
      { after: 200 }
    ),
    timeline(),
    new Paragraph({
      spacing: { before: 100, after: 120 },
      children: [
        square(OK_TINT), new TextRun({ text: "сделано    ", size: 18, color: INK_3 }),
        square(BRAND), new TextRun({ text: "идёт сейчас    ", size: 18, color: INK_3 }),
        square(BRAND_TINT), new TextRun({ text: "впереди    ", size: 18, color: INK_3 }),
        new TextRun({ text: "◆ ", font: SYMBOL_FONT, size: 18, color: BRAND_DK }),
        new TextRun({ text: "точка решения", size: 18, color: INK_3 }),
      ],
    }),
    ...STAGES.flatMap(stageBlock),
  ];

  const risks = [
    H1("3. Риски и что с ними делаем", false),
    P("Семь вещей, которые могут помешать. Первые два — главные: они решают, есть ли у продукта будущее.", { after: 200 }),
    risksTable(),
  ];

  return new Document({
    creator: "Тендерный юрист",
    title: "Тендерный юрист — чек-лист и дорожная карта",
    description: `Состояние проекта на ${DATE}`,
    styles: {
      default: { document: { run: { font: FONT, size: 22, color: INK } } },
      paragraphStyles: [
        {
          id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { font: FONT, size: 34, bold: true, color: BRAND_DK },
          paragraph: { spacing: { before: 0, after: 200 }, outlineLevel: 0, keepNext: true },
        },
        {
          id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { font: FONT, size: 26, bold: true, color: BRAND },
          paragraph: { spacing: { before: 320, after: 120 }, outlineLevel: 1, keepNext: true },
        },
        {
          id: "BoxDone", name: "Checkbox done", basedOn: "Normal",
          run: { size: 30, color: OK_TEXT },
          paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 } },
        },
        {
          id: "BoxTodo", name: "Checkbox todo", basedOn: "Normal",
          run: { size: 30, color: INK_3 },
          paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 } },
        },
      ],
    },
    numbering: {
      config: ["steps", "tasks"].map((reference) => ({
        reference,
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: "%1.",
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 420, hanging: 320 } },
              run: { bold: true, color: BRAND },
            },
          },
        ],
      })),
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
                  new TextRun({ text: `Тендерный юрист · чек-лист и дорожная карта · ${DATE_SHORT}`, size: 16, color: INK_3 }),
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
        children: [...cover, ...checklist, ...roadmap, ...risks],
      },
    ],
  });
}

const out = process.argv[2] || "Тендерный юрист — чек-лист и дорожная карта.docx";
Packer.toBuffer(build()).then((buf) => {
  fs.writeFileSync(out, buf);
  console.log(`Готово: ${out}`);
});
