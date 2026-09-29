export type CheckStatus = 'ok' | 'warn' | 'missing';

// Способ определения поставщика — структурированное поле извещения ЕИС.
export type Procedure = 'auction' | 'quotation' | 'contest' | 'single';
export const procedureMeta: Record<
  Procedure,
  { label: string; short: string; hint: string }
> = {
  auction: {
    label: 'Электронный аукцион',
    short: 'Аукцион',
    hint: 'Торги на понижение в реальном времени. Побеждает наименьшая цена.',
  },
  quotation: {
    label: 'Запрос котировок',
    short: 'Котировки',
    hint: 'Одно ценовое предложение без торгов. Побеждает наименьшая цена.',
  },
  contest: {
    label: 'Электронный конкурс',
    short: 'Конкурс',
    hint: 'Оценка по критериям: цена, опыт, квалификация — не только цена.',
  },
  single: {
    label: 'Закупка у ед. поставщика',
    short: 'Ед. поставщик',
    hint: 'Прямой контракт без конкурентной процедуры.',
  },
};

// Пример закупки. Обеспечение заявки — по ч. 2 ст. 44 44-ФЗ: при НМЦК до 20 млн — от 0,5 до 1 % НМЦК.
export const tender = {
  id: '0173200001325001842',
  title: 'Поставка компьютерного оборудования для нужд ГБУЗ «ГКБ №52»',
  platform: 'ЕИС / Госзакупки (44-ФЗ)',
  customer: 'ГБУЗ города Москвы «Городская клиническая больница №52»',
  nmck: 4_280_000,
  deadline: '14 окт 2026, 10:00 МСК',
  law: '44-ФЗ',
  procedure: 'auction' as Procedure,
  security: 42_800,
  securityPct: 1,
  // Обеспечение исполнения контракта из извещения — для расчёта нижней цены.
  performancePct: 5,
};

// Цены продукта: заявка под ключ и проверка живым специалистом.
export const PRICE_APP = 1000;
export const PRICE_EXPERT = 500;
// Полный повторный разбор ИИ — ограничен; правки полей проверяются бесплатно и сразу.
export const RECHECKS = 3;
// Новая версия документов после третьей — только с подтверждением.
export const GENERATIONS = 3;

// Реквизиты компании пользователя — используются для автозаполнения документов заявки.
export type CompanyField = { key: string; label: string; value: string; group: 'org' | 'bank' | 'contact' };

export const company = {
  name: 'ООО «ТехСнаб»',
  sme: 'Малое предприятие',
  fields: [
    { key: 'fullName', label: 'Полное наименование', value: 'Общество с ограниченной ответственностью «ТехСнаб»', group: 'org' },
    { key: 'inn', label: 'ИНН', value: '7701234567', group: 'org' },
    { key: 'kpp', label: 'КПП', value: '770101001', group: 'org' },
    { key: 'ogrn', label: 'ОГРН', value: '1157746000000', group: 'org' },
    { key: 'director', label: 'Руководитель', value: 'Смирнов Алексей Петрович', group: 'org' },
    { key: 'address', label: 'Юридический адрес', value: '101000, г. Москва, ул. Мясницкая, д. 12, оф. 305', group: 'org' },
    { key: 'bank', label: 'Банк', value: 'ПАО Сбербанк, г. Москва', group: 'bank' },
    { key: 'bik', label: 'БИК', value: '044525225', group: 'bank' },
    { key: 'account', label: 'Расчётный счёт', value: '40702810400000012345', group: 'bank' },
    { key: 'special', label: 'Спецсчёт для обеспечения', value: '40702810900000008814', group: 'bank' },
    { key: 'email', label: 'E-mail', value: 'zakupki@techsnab.ru', group: 'contact' },
    { key: 'phone', label: 'Телефон', value: '+7 (495) 120-45-67', group: 'contact' },
  ] as CompanyField[],
};

// Образцы и документы компании: по ним ИИ пишет новые документы так же, как ваши, и берёт опыт для конкурсов.
export type SampleDoc = { name: string; kind: string; note: string };
export const samples: SampleDoc[] = [
  { name: 'Заявка МФЦ 2026.pdf', kind: 'Заявка целиком', note: 'предложение по товару и декларации — образец оформления' },
  { name: 'Прайс ТехСнаб сентябрь.xlsx', kind: 'Прайс поставщика', note: 'модели, товарные знаки, страны происхождения' },
  { name: 'Контракт ГКБ 52 — 2025.pdf', kind: 'Опыт', note: 'исполненный контракт с актами — для конкурсов' },
  { name: 'Карточка предприятия.pdf', kind: 'Реквизиты', note: 'из неё заполнен профиль компании' },
];

export type TenderStatus = 'draft' | 'progress' | 'ready' | 'submitted';

export type TenderCard = {
  id: string;
  title: string;
  customer: string;
  nmck: number;
  law: string;
  procedure: Procedure;
  deadline: string;
  status: TenderStatus;
  progress: number;
  docsLoaded: number;
  docsTotal: number;
  active?: boolean; // текущая закупка, открываемая в мастере
};

export const statusLabels: Record<TenderStatus, { label: string; tone: 'neutral' | 'warn' | 'success'; hint: string }> = {
  draft: { label: 'Черновик', tone: 'neutral', hint: 'Загружена не вся документация — разбор ещё не сделан.' },
  progress: { label: 'В работе', tone: 'warn', hint: 'Документы составлены, осталось заполнить и подтвердить поля.' },
  ready: { label: 'Готова к подаче', tone: 'success', hint: 'Пустых обязательных полей нет — осталось подписать и подать на площадке.' },
  submitted: { label: 'Подана', tone: 'success', hint: 'Заявка подана на площадке — ждём итогов.' },
};

export const myTenders: TenderCard[] = [
  {
    id: '0173200001325001842',
    title: 'Поставка компьютерного оборудования для ГБУЗ «ГКБ №52»',
    customer: 'ГБУЗ «ГКБ №52» ДЗМ',
    nmck: 4_280_000,
    law: '44-ФЗ',
    procedure: 'auction',
    deadline: '14 окт 2026',
    status: 'progress',
    progress: 60,
    docsLoaded: 4,
    docsTotal: 4,
    active: true,
  },
  {
    id: '0173200001325002001',
    title: 'Закупка канцелярских товаров и расходных материалов',
    customer: 'ФГБОУ ВО «МГУ им. Ломоносова»',
    nmck: 890_000,
    law: '44-ФЗ',
    procedure: 'quotation',
    deadline: '02 окт 2026',
    status: 'draft',
    progress: 15,
    docsLoaded: 1,
    docsTotal: 3,
  },
  {
    id: '32100045678',
    title: 'Оказание услуг по техническому обслуживанию оргтехники',
    customer: 'ПАО «Ростелеком»',
    nmck: 1_650_000,
    law: '223-ФЗ',
    procedure: 'contest',
    deadline: '21 окт 2026',
    status: 'ready',
    progress: 95,
    docsLoaded: 5,
    docsTotal: 5,
  },
  {
    id: '0173200001325001777',
    title: 'Поставка серверного оборудования и СХД',
    customer: 'Департамент информ. технологий г. Москвы',
    nmck: 12_400_000,
    law: '44-ФЗ',
    procedure: 'auction',
    deadline: '28 сен 2026',
    status: 'submitted',
    progress: 100,
    docsLoaded: 6,
    docsTotal: 6,
  },
];

// Найденные закупки при поиске по площадкам (ЕИС, площадки 44-ФЗ / 223-ФЗ). Поиск — в разработке, это пример.
export type FoundTender = {
  id: string;
  title: string;
  customer: string;
  nmck: number;
  law: string;
  procedure: Procedure;
  platform: string;
  okpd: string;
  deadline: string;
  relevance: number; // релевантность профилю компании, %
};

export const foundTenders: FoundTender[] = [
  {
    id: '0173200001325002190',
    title: 'Поставка ноутбуков и периферийного оборудования',
    customer: 'ГБОУ «Школа №1502»',
    nmck: 2_140_000,
    law: '44-ФЗ',
    procedure: 'auction',
    platform: 'ЕИС · РТС-тендер',
    okpd: '26.20.11',
    deadline: '18 окт 2026',
    relevance: 96,
  },
  {
    id: '32100098765',
    title: 'Поставка многофункциональных устройств (МФУ) и картриджей',
    customer: 'АО «Почта России»',
    nmck: 3_580_000,
    law: '223-ФЗ',
    procedure: 'contest',
    platform: 'ЭТП Газпромбанк',
    okpd: '28.23.21',
    deadline: '25 окт 2026',
    relevance: 91,
  },
  {
    id: '0173200001325002233',
    title: 'Поставка серверов и систем хранения данных',
    customer: 'ГКУ «Инфогород»',
    nmck: 8_900_000,
    law: '44-ФЗ',
    procedure: 'auction',
    platform: 'ЕИС · Сбербанк-АСТ',
    okpd: '26.20.14',
    deadline: '30 окт 2026',
    relevance: 84,
  },
  {
    id: '0173200001325002250',
    title: 'Поставка источников бесперебойного питания',
    customer: 'ФГУП «НИИ Автоматики»',
    nmck: 760_000,
    law: '44-ФЗ',
    procedure: 'quotation',
    platform: 'ЕИС · РТС-тендер',
    okpd: '27.11.50',
    deadline: '12 окт 2026',
    relevance: 78,
  },
];

// История поданных заявок с результатами. Итоги с площадок — в разработке, это пример.
export type BidResult = 'won' | 'lost' | 'pending';
export type BidRecord = {
  id: string;
  title: string;
  customer: string;
  date: string;
  law: string;
  procedure: Procedure;
  ourPrice: number;
  winnerPrice: number;
  result: BidResult;
  rank: number;
  participants: number;
};

export const bidResultMeta: Record<BidResult, { label: string; tone: 'success' | 'danger' | 'warn' }> = {
  won: { label: 'Победа', tone: 'success' },
  lost: { label: 'Проигрыш', tone: 'danger' },
  pending: { label: 'На рассмотрении', tone: 'warn' },
};

export const bidHistory: BidRecord[] = [
  {
    id: '0173200001325001501',
    title: 'Поставка компьютерной техники для АУ «МФЦ»',
    customer: 'ГБУ «МФЦ города Москвы»',
    date: '12 сен 2026',
    law: '44-ФЗ',
    procedure: 'auction',
    ourPrice: 3_120_000,
    winnerPrice: 3_120_000,
    result: 'won',
    rank: 1,
    participants: 4,
  },
  {
    id: '0173200001325001777',
    title: 'Поставка серверного оборудования и СХД',
    customer: 'Департамент ИТ г. Москвы',
    date: '05 сен 2026',
    law: '44-ФЗ',
    procedure: 'auction',
    ourPrice: 11_800_000,
    winnerPrice: 11_800_000,
    result: 'pending',
    rank: 1,
    participants: 6,
  },
  {
    id: '32100031122',
    title: 'Обслуживание оргтехники',
    customer: 'ПАО «МТС»',
    date: '28 авг 2026',
    law: '223-ФЗ',
    procedure: 'contest',
    ourPrice: 1_490_000,
    winnerPrice: 1_355_000,
    result: 'lost',
    rank: 3,
    participants: 7,
  },
  {
    id: '0173200001325001320',
    title: 'Поставка расходных материалов для печати',
    customer: 'ГБУЗ «ГКБ №52» ДЗМ',
    date: '19 авг 2026',
    law: '44-ФЗ',
    procedure: 'quotation',
    ourPrice: 640_000,
    winnerPrice: 640_000,
    result: 'won',
    rank: 1,
    participants: 3,
  },
  {
    id: '32100029004',
    title: 'Поставка сетевого оборудования',
    customer: 'АО «Ростелеком»',
    date: '07 авг 2026',
    law: '223-ФЗ',
    procedure: 'auction',
    ourPrice: 2_780_000,
    winnerPrice: 2_610_000,
    result: 'lost',
    rank: 2,
    participants: 5,
  },
];

export type SourceDoc = {
  name: string;
  size: string;
  pages: number;
  kind: string;
};

export const sourceDocs: SourceDoc[] = [
  { name: 'Извещение о закупке.pdf', size: '412 КБ', pages: 6, kind: 'Извещение' },
  { name: 'Техническое задание.docx', size: '1.2 МБ', pages: 24, kind: 'ТЗ' },
  { name: 'Проект контракта.pdf', size: '780 КБ', pages: 18, kind: 'Контракт' },
  { name: 'Обоснование НМЦК.xlsx', size: '96 КБ', pages: 3, kind: 'Расчёт' },
];

// Что входит в заявку на электронный аукцион: ч. 1 ст. 49 44-ФЗ отсылает к пп. «м»–«п» п. 1, пп. «а»–«в» п. 2
// и п. 5 ч. 1 ст. 43. Наименование, ИНН и адрес участника в заявку не пишут — их передаёт площадка.
export type RequiredDoc = {
  id: string;
  title: string;
  ref: string;
  status: CheckStatus;
  note: string;
  auto: boolean;
  // Документ, который скачивают в пакете. Обеспечение и одобрение сделки — не файлы заявки.
  file: boolean;
};

export const requiredDocs: RequiredDoc[] = [
  {
    id: 'goods',
    title: 'Предложение по товару: характеристики, товарный знак, страна происхождения',
    ref: 'пп. «а», «б» п. 2 ч. 1 ст. 43 44-ФЗ',
    status: 'warn',
    note: 'Составлено по ТЗ и вашему прайсу. Не хватает 3 характеристик, страну происхождения — подтвердить.',
    auto: true,
    file: true,
  },
  {
    id: 'declaration',
    title: 'Декларация о соответствии участника требованиям',
    ref: 'пп. «о» п. 1 ч. 1 ст. 43 44-ФЗ',
    status: 'ok',
    note: 'Требования пп. 3–5, 7–11 ч. 1 ст. 31. Сформирована автоматически.',
    auto: true,
    file: true,
  },
  {
    id: 'account',
    title: 'Реквизиты счёта для оплаты по контракту',
    ref: 'пп. «п» п. 1 ч. 1 ст. 43 44-ФЗ',
    status: 'ok',
    note: 'Из профиля компании: банк, БИК, расчётный счёт.',
    auto: true,
    file: true,
  },
  {
    id: 'cert',
    title: 'Сертификат соответствия на МФУ',
    ref: 'пп. «в» п. 2 ч. 1 ст. 43 · п. 5 ТЗ',
    status: 'missing',
    note: 'Требуется по ТЗ для поз. 3 (МФУ). В загруженных файлах его нет.',
    auto: false,
    file: true,
  },
  {
    id: 'registry',
    title: 'Номера реестровых записей товара (нацрежим)',
    ref: 'п. 5 ч. 1 ст. 43 44-ФЗ',
    status: 'warn',
    note: 'Для поз. 1 и 2 номера есть в прайсе. Для поз. 3 и 4 — вписать или отметить, что товар иностранный.',
    auto: true,
    file: true,
  },
  {
    id: 'guarantee',
    title: 'Обеспечение заявки 42 800 ₽',
    ref: 'ч. 2 ст. 44 44-ФЗ',
    status: 'warn',
    note: 'Не документ: сумму блокирует площадка на спецсчёте. Подтвердите, что деньги на счёте.',
    auto: false,
    file: false,
  },
  {
    id: 'deal',
    title: 'Одобрение крупной сделки',
    ref: 'пп. «м» п. 1 ч. 1 ст. 43 44-ФЗ',
    status: 'warn',
    note: 'Нужно, только если контракт — крупная сделка для компании. ИИ не знает ваш баланс — подтвердите.',
    auto: false,
    file: false,
  },
];

// Позиции закупки: сумма по НМЦ за единицу — ровно НМЦК.
export type PriceRow = {
  position: string;
  qty: number;
  nmc: number;
};

export const priceRows: PriceRow[] = [
  { position: 'Поз. 1. Моноблок 23.8", i5 / 16 ГБ', qty: 32, nmc: 62_000 },
  { position: 'Поз. 2. Ноутбук 15.6", i5 / 16 ГБ', qty: 20, nmc: 71_000 },
  { position: 'Поз. 3. МФУ лазерное А4', qty: 12, nmc: 34_500 },
  { position: 'Поз. 4. Источник бесперебойного питания', qty: 42, nmc: 11_000 },
];

// Расходы участника для расчёта «до какой цены снижаться» — пример, участник вписывает свои.
export const costDefaults = {
  costs: 3_420_000, // закупка товара у поставщиков
  extra: 110_000, // доставка, сборка, прочее
  taxPct: 6, // налог с выручки
  guaranteeRatePct: 3, // комиссия банка за гарантию исполнения, % годовых
  days: 60, // срок исполнения, дней
};

// Карта полей заявки (Manual Input Engine): что заполнено само, что подтвердить, что вписать, что нельзя
// определить и что подписать. Те же виды и тексты, что в приложении (web/src/lib/fields.ts).
export type FieldKind = 'auto' | 'confirm' | 'manual' | 'unknown' | 'sign';

export const kindMeta: Record<FieldKind, { label: string; short: string; tone: 'success' | 'warn' | 'info' | 'danger' | 'neutral'; hint: string }> = {
  auto: { label: 'Заполнено автоматически', short: 'Авто', tone: 'success', hint: 'ИИ заполнил сам: из профиля компании, ТЗ и ваших документов. У каждого поля виден источник.' },
  confirm: { label: 'Нужно подтвердить', short: 'Подтвердить', tone: 'warn', hint: 'Значение ИИ нашёл, но решение за вами: подтвердите или измените.' },
  manual: { label: 'Нужно ввести', short: 'Ввести', tone: 'info', hint: 'Поле обязательно, а значения нет ни в одном файле — его знаете только вы.' },
  unknown: { label: 'Нельзя определить', short: 'Не определено', tone: 'danger', hint: 'ИИ не смог прочитать часть документов — что там требуется, неизвестно.' },
  sign: { label: 'Требует действия', short: 'Действие', tone: 'neutral', hint: 'Сделать может только человек: подписать электронной подписью и подать на площадке.' },
};

// Поля, заполненные автоматически, — с источником. В прототипе показаны не все.
export const autoFields: { label: string; value: string; source: string }[] = [
  { label: 'Реквизиты счёта: банк и БИК', value: 'ПАО Сбербанк · 044525225', source: 'Профиль компании → Банковские реквизиты' },
  { label: 'Расчётный счёт', value: '40702810400000012345', source: 'Профиль компании → Банковские реквизиты' },
  { label: 'Количество: моноблоки', value: '32 шт.', source: 'ТЗ, п. 3.1' },
  { label: 'Характеристики моноблока', value: '23,8", Intel Core i5, ОЗУ 16 ГБ, SSD 512 ГБ', source: 'ТЗ, п. 4.1 · «Прайс ТехСнаб сентябрь.xlsx»' },
  { label: 'Номер реестровой записи: поз. 1, 2', value: 'из прайса поставщика', source: '«Прайс ТехСнаб сентябрь.xlsx», стр. 2' },
  { label: 'Декларация о соответствии требованиям', value: 'стандартный текст по пп. 3–5, 7–11 ч. 1 ст. 31', source: '44-ФЗ, пп. «о» п. 1 ч. 1 ст. 43' },
  { label: 'Номер закупки и заказчик', value: '0173200001325001842 · ГБУЗ «ГКБ №52»', source: 'Извещение, стр. 1' },
];
export const AUTO_TOTAL = 41;

// «Слепая зона» — место, которое ИИ не смог заполнить сам или где решение за человеком.
// Каждая объясняет ЧТО не так, ПОЧЕМУ ИИ не заполнил сам (ответ из сохранённого разбора, без нового запроса к ИИ),
// ЧТО будет, если оставить, и даёт способ исправить прямо в интерфейсе.
export type GapKind = 'text' | 'upload' | 'choice' | 'confirm';

export type Gap = {
  id: string;
  field: FieldKind;
  position: string; // например «Поз. 3»
  label: string; // что именно требуется
  severity: 'high' | 'medium' | 'low';
  ref: string; // ссылка на норму / пункт ТЗ
  source: string; // где ИИ искал или нашёл значение
  why: string;
  consequence: string;
  kind: GapKind;
  placeholder?: string;
  choices?: { label: string; ok: boolean }[];
  accept?: string;
  // Найденное ИИ значение для подтверждения.
  found?: string;
  // Для чисел по ТЗ: не меньше.
  min?: number;
  weight: number; // вклад в риск отклонения, баллы
};

export const gaps: Gap[] = [
  {
    id: 'cert-poz3',
    field: 'manual',
    position: 'Поз. 3',
    label: 'Сертификат соответствия на МФУ',
    severity: 'high',
    ref: 'пп. «в» п. 2 ч. 1 ст. 43 · п. 5 ТЗ',
    source: 'Искал: извещение, ТЗ, проект контракта, ваши образцы',
    why: 'Сертификат — отдельный файл от органа по сертификации. В загруженных документах его нет, создать его ИИ не может.',
    consequence: 'Заявку отклонят: нет документа, который требует извещение (п. 1 ч. 12 ст. 48 44-ФЗ).',
    kind: 'upload',
    accept: 'PDF, JPG — скан сертификата или декларации о соответствии',
    weight: 35,
  },
  {
    id: 'file-unread',
    field: 'unknown',
    position: 'Файл',
    label: '«Приложение 3 к ТЗ.pdf»: 2 страницы не прочитаны',
    severity: 'medium',
    ref: 'Документы закупки',
    source: 'Скан низкого качества, стр. 4–5',
    why: 'Это скан с размытым текстом: ИИ не распознал две страницы. Если там требования к заявке, их нет в разборе.',
    consequence: 'Можно пропустить требование, о котором ИИ не знает.',
    kind: 'choice',
    choices: [
      { label: 'Загружу файл получше', ok: false },
      { label: 'Прочитал сам — требований к заявке там нет', ok: true },
    ],
    weight: 10,
  },
  {
    id: 'guarantee',
    field: 'confirm',
    position: 'Обеспечение',
    label: 'Обеспечение заявки 42 800 ₽',
    severity: 'medium',
    ref: 'ч. 2 ст. 44 44-ФЗ',
    source: 'Спецсчёт — из профиля компании',
    why: 'Спецсчёт ИИ знает, но деньги на нём видит только банк. В документах закупки этого нет.',
    consequence: 'Если суммы нет на спецсчёте к подаче, площадка не примет заявку.',
    kind: 'choice',
    choices: [
      { label: 'Деньги на спецсчёте — сумма есть', ok: true },
      { label: 'Независимая гарантия банка', ok: true },
      { label: 'Ещё не оформлено', ok: false },
    ],
    weight: 18,
  },
  {
    id: 'registry',
    field: 'manual',
    position: 'Поз. 3, 4',
    label: 'Номера реестровых записей: МФУ и ИБП',
    severity: 'medium',
    ref: 'п. 5 ч. 1 ст. 43 44-ФЗ',
    source: 'Прайс поставщика: для поз. 3 и 4 номеров нет',
    why: 'Номер записи в реестре российской продукции есть у производителя или поставщика. В ваших файлах его нет.',
    consequence: 'Без номера товар посчитают иностранным (п. 5 ч. 1 ст. 43 44-ФЗ).',
    kind: 'text',
    placeholder: 'номера записей через запятую или «товар иностранный»',
    weight: 15,
  },
  {
    id: 'poz2-storage',
    field: 'manual',
    position: 'Поз. 2',
    label: 'Тип и объём накопителя ноутбука',
    severity: 'low',
    ref: 'ТЗ, п. 4.2',
    source: 'В прайсе у этой модели накопитель не указан',
    why: 'В ТЗ параметр обязателен, а в вашем прайсе поле пустое. Его знаете только вы — по модели, которую поставите.',
    consequence: 'Неполная характеристика — основание отклонить заявку (п. 1 ч. 12 ст. 48 44-ФЗ).',
    kind: 'text',
    placeholder: 'например: SSD, 512 ГБ',
    weight: 7,
  },
  {
    id: 'poz3-speed',
    field: 'manual',
    position: 'Поз. 3',
    label: 'Скорость печати МФУ, стр/мин',
    severity: 'low',
    ref: 'ТЗ, п. 5.3 — не менее 30 стр/мин',
    source: 'В прайсе и спецификации скорости нет',
    why: 'ТЗ требует не менее 30 стр/мин. В загруженных файлах скорость не указана — ИИ оставил поле открытым.',
    consequence: 'Значение не по ТЗ или пустое — риск отклонения.',
    kind: 'text',
    placeholder: 'например: 35',
    min: 30,
    weight: 7,
  },
  {
    id: 'poz4-power',
    field: 'manual',
    position: 'Поз. 4',
    label: 'Выходная мощность ИБП, ВА / Вт',
    severity: 'low',
    ref: 'ТЗ, п. 7.1',
    source: 'Зависит от модели — в документах нет',
    why: 'Значение зависит от модели ИБП, которую вы поставите. В документах закупки его нет.',
    consequence: 'Характеристика неполна — заявку могут отклонить.',
    kind: 'text',
    placeholder: 'например: 800 ВА / 480 Вт',
    weight: 6,
  },
  {
    id: 'deal',
    field: 'confirm',
    position: 'Участник',
    label: 'Крупная ли это сделка для компании',
    severity: 'low',
    ref: 'пп. «м» п. 1 ч. 1 ст. 43 44-ФЗ',
    source: 'Баланс компании ИИ не видит',
    why: 'Решение об одобрении нужно, только если контракт — крупная сделка. Это зависит от баланса компании, его нет в файлах.',
    consequence: 'Если сделка крупная, а решения нет, — основание отклонить заявку.',
    kind: 'choice',
    choices: [
      { label: 'Не крупная — решение не нужно', ok: true },
      { label: 'Крупная — решение об одобрении приложу', ok: true },
      { label: 'Не знаю — уточню у бухгалтера', ok: false },
    ],
    weight: 5,
  },
  {
    id: 'country',
    field: 'confirm',
    position: 'Товар',
    label: 'Страна происхождения товара',
    severity: 'low',
    ref: 'пп. «б» п. 2 ч. 1 ст. 43 44-ФЗ',
    source: '«Прайс ТехСнаб сентябрь.xlsx», стр. 2',
    why: 'ИИ нашёл страны в прайсе поставщика. Страну вы подтверждаете сами — за неё отвечает участник.',
    consequence: 'Неверная страна — риск отклонения и претензий при исполнении.',
    kind: 'confirm',
    found: 'Россия — поз. 1, 2; Китай — поз. 3, 4',
    weight: 4,
  },
  {
    id: 'signer',
    field: 'confirm',
    position: 'Подпись',
    label: 'Кто подписывает заявку',
    severity: 'low',
    ref: 'Подписание на площадке',
    source: 'Профиль компании → Руководитель',
    why: 'Подпись ставит человек. ИИ взял руководителя из профиля — подтвердите, что подписывает он.',
    consequence: 'Подпись не того лица — заявку могут не принять.',
    kind: 'confirm',
    found: 'Смирнов Алексей Петрович, генеральный директор',
    weight: 3,
  },
];

export type ExportFormat = { ext: string; label: string; soon?: boolean };
export const exportFormats: ExportFormat[] = [
  { ext: 'DOCX', label: 'Word — можно править' },
  { ext: 'PDF', label: 'PDF — для подписи и подачи' },
  { ext: 'ODT', label: 'OpenDocument', soon: true },
];

// Специалист проверяет пакет вручную. Кроме открытых пунктов, он пишет то, чего ИИ не видит.
export const expertExtra = 'Проверьте срок действия сертификата: он должен действовать на дату поставки.';

export function rub(n: number) {
  return Math.round(n).toLocaleString('ru-RU') + '\u00a0₽';
}

// «3,8 млн ₽» — для крупных сумм в сводках.
export function mln(n: number) {
  return (n / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '\u00a0млн\u00a0₽';
}
