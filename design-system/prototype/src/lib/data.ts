// Справочники интерфейса: статусы и способы закупки, виды полей заявки, формат сумм. Всё, что раньше было здесь
// выдуманным примером закупки, теперь берётся из настоящей закупки (web/src/lib). Остались только примеры экранов
// «Поиск закупок» и «История заявок»: они помечены «скоро» и показывают пример.

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
  // Из настоящих закупок: название способа, как в документах, и пометка примера.
  procedureLabel?: string;
  sample?: boolean;
};

export const statusLabels: Record<TenderStatus, { label: string; tone: 'neutral' | 'warn' | 'success'; hint: string }> = {
  draft: { label: 'Черновик', tone: 'neutral', hint: 'Загружена не вся документация — разбор ещё не сделан.' },
  progress: { label: 'В работе', tone: 'warn', hint: 'Документы составлены, осталось заполнить и подтвердить поля.' },
  ready: { label: 'Готова к подаче', tone: 'success', hint: 'Пустых обязательных полей нет — осталось подписать и подать на площадке.' },
  submitted: { label: 'Подана', tone: 'success', hint: 'Заявка подана на площадке — ждём итогов.' },
};


// Найденные закупки при поиске по площадкам (ЕИС, 44-ФЗ / 223-ФЗ).
export type FoundTender = {
  id: string;
  title: string;
  customer: string;
  region: string;
  nmck: number;
  law: '44-ФЗ' | '223-ФЗ';
  procedure: Procedure;
  platform: string;
  okpd: string;
  deadline: string;     // ISO YYYY-MM-DD — для сортировки и расчёта «осталось дней»
  publishedAt: string;  // ISO YYYY-MM-DD
  relevance: number;    // релевантность профилю компании, %
};

export const foundTenders: FoundTender[] = [
  { id: '0173200001326000001', title: 'Поставка ноутбуков и периферийного оборудования', customer: 'ГБОУ «Школа №1502»', region: 'Москва', nmck: 2_140_000, law: '44-ФЗ', procedure: 'auction', platform: 'РТС-тендер', okpd: '26.20.11', deadline: '2026-10-18', publishedAt: '2026-10-01', relevance: 96 },
  { id: '32100098765', title: 'Поставка многофункциональных устройств (МФУ) и картриджей', customer: 'АО «Почта России»', region: 'Москва', nmck: 3_580_000, law: '223-ФЗ', procedure: 'contest', platform: 'ЭТП Газпромбанк', okpd: '28.23.21', deadline: '2026-10-25', publishedAt: '2026-09-28', relevance: 91 },
  { id: '0173200001326000003', title: 'Поставка серверов и систем хранения данных', customer: 'ГКУ «Инфогород»', region: 'Москва', nmck: 8_900_000, law: '44-ФЗ', procedure: 'auction', platform: 'Сбербанк-АСТ', okpd: '26.20.14', deadline: '2026-10-30', publishedAt: '2026-09-25', relevance: 84 },
  { id: '0173200001326000004', title: 'Поставка источников бесперебойного питания', customer: 'ФГУП «НИИ Автоматики»', region: 'Московская область', nmck: 760_000, law: '44-ФЗ', procedure: 'quotation', platform: 'РТС-тендер', okpd: '27.11.50', deadline: '2026-10-12', publishedAt: '2026-10-03', relevance: 78 },
  { id: '0173200001326000005', title: 'Поставка сетевого оборудования (коммутаторы, маршрутизаторы)', customer: 'Департамент ИТ г. Москвы', region: 'Москва', nmck: 12_500_000, law: '44-ФЗ', procedure: 'auction', platform: 'РТС-тендер', okpd: '26.30.11', deadline: '2026-11-05', publishedAt: '2026-10-04', relevance: 88 },
  { id: '0362100000126001234', title: 'Поставка расходных материалов для оргтехники', customer: 'ГБУЗ «ГКБ №52» ДЗМ', region: 'Москва', nmck: 430_000, law: '44-ФЗ', procedure: 'quotation', platform: 'РТС-тендер', okpd: '32.99.19', deadline: '2026-10-14', publishedAt: '2026-10-05', relevance: 82 },
  { id: '0173300001426000012', title: 'Поставка мониторов и графических рабочих станций', customer: 'ГБОУ «МГТУ им. Баумана»', region: 'Москва', nmck: 4_850_000, law: '44-ФЗ', procedure: 'auction', platform: 'Сбербанк-АСТ', okpd: '26.20.17', deadline: '2026-11-08', publishedAt: '2026-10-04', relevance: 93 },
  { id: '0173200001326000010', title: 'Техническое обслуживание серверного оборудования и систем хранения', customer: 'ГКУ «Московская дирекция транспорта»', region: 'Москва', nmck: 3_200_000, law: '44-ФЗ', procedure: 'auction', platform: 'РТС-тендер', okpd: '26.20.19', deadline: '2026-10-28', publishedAt: '2026-10-03', relevance: 89 },
  { id: '0173200001326000018', title: 'Поставка серверных стоек, комплектующих и кабельных органайзеров', customer: 'ГБОУ «Школа №1551»', region: 'Москва', nmck: 980_000, law: '44-ФЗ', procedure: 'quotation', platform: 'РТС-тендер', okpd: '26.20.14', deadline: '2026-10-10', publishedAt: '2026-10-05', relevance: 90 },
  { id: '32200099001', title: 'Обслуживание и ремонт копировально-множительной техники', customer: 'АО «РЖД»', region: 'Москва', nmck: 1_640_000, law: '223-ФЗ', procedure: 'contest', platform: 'ЭТП РЖД', okpd: '28.23.29', deadline: '2026-10-31', publishedAt: '2026-10-01', relevance: 85 },
  { id: '32100111222', title: 'Поставка лицензий на программное обеспечение для управления проектами', customer: 'ПАО «Газпром нефть»', region: 'Санкт-Петербург', nmck: 7_800_000, law: '223-ФЗ', procedure: 'contest', platform: 'ЭТП ГПБ', okpd: '58.29.11', deadline: '2026-11-01', publishedAt: '2026-09-27', relevance: 71 },
  { id: '32100055333', title: 'Поставка и монтаж системы видеонаблюдения и контроля доступа', customer: 'ПАО «Сбербанк»', region: 'Москва', nmck: 9_200_000, law: '223-ФЗ', procedure: 'contest', platform: 'Сбербанк-АСТ', okpd: '26.30.50', deadline: '2026-10-27', publishedAt: '2026-09-30', relevance: 67 },
  { id: '32100077889', title: 'Услуги облачной инфраструктуры (IaaS) и технической поддержки', customer: 'АО «Аэрофлот»', region: 'Москва', nmck: 34_500_000, law: '223-ФЗ', procedure: 'contest', platform: 'ЭТП Газпромбанк', okpd: '63.11.12', deadline: '2026-11-30', publishedAt: '2026-09-25', relevance: 79 },
  { id: '0173200001326000014', title: 'Поставка источников постоянного тока и зарядных устройств', customer: 'ФГБУ «НИИ Электроники»', region: 'Новосибирская область', nmck: 1_100_000, law: '44-ФЗ', procedure: 'quotation', platform: 'РТС-тендер', okpd: '27.11.29', deadline: '2026-10-16', publishedAt: '2026-10-04', relevance: 74 },
  { id: '0319200000126001010', title: 'Поставка компьютерной техники для образовательных учреждений', customer: 'Министерство образования Красноярского края', region: 'Красноярский край', nmck: 6_700_000, law: '44-ФЗ', procedure: 'auction', platform: 'РТС-тендер', okpd: '26.20.11', deadline: '2026-10-24', publishedAt: '2026-10-02', relevance: 76 },
  { id: '0173200001326000015', title: 'Строительно-монтажные работы по прокладке структурированной кабельной системы', customer: 'АО «Мосэнерго»', region: 'Московская область', nmck: 8_300_000, law: '44-ФЗ', procedure: 'auction', platform: 'Сбербанк-АСТ', okpd: '43.21.10', deadline: '2026-11-20', publishedAt: '2026-09-26', relevance: 55 },
  { id: '0162300002126000016', title: 'Поставка лабораторного оборудования и измерительных приборов', customer: 'ФГБУ «РФЯЦ-ВНИИЭФ»', region: 'Нижегородская область', nmck: 15_600_000, law: '44-ФЗ', procedure: 'contest', platform: 'РТС-тендер', okpd: '26.51.33', deadline: '2026-11-10', publishedAt: '2026-09-28', relevance: 47 },
  { id: '0173200001326000011', title: 'Поставка телекоммуникационного оборудования для центра обработки данных', customer: 'ФСО России', region: 'Москва', nmck: 22_400_000, law: '44-ФЗ', procedure: 'single', platform: 'ЕИС', okpd: '26.30.22', deadline: '2026-10-20', publishedAt: '2026-09-29', relevance: 62 },
  { id: '0162300001526000007', title: 'Поставка медицинского оборудования для диагностики', customer: 'ФГБУ «НМИЦ онкологии»', region: 'Санкт-Петербург', nmck: 18_700_000, law: '44-ФЗ', procedure: 'auction', platform: 'Сбербанк-АСТ', okpd: '32.50.13', deadline: '2026-11-15', publishedAt: '2026-09-30', relevance: 43 },
  { id: '0173200001326000008', title: 'Поставка офисной мебели для государственных учреждений', customer: 'Минтруд России', region: 'Москва', nmck: 5_200_000, law: '44-ФЗ', procedure: 'auction', platform: 'РТС-тендер', okpd: '31.01.11', deadline: '2026-10-22', publishedAt: '2026-10-02', relevance: 31 },
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

export function rub(n: number) {
  return Math.round(n).toLocaleString('ru-RU') + '\u00a0₽';
}

// «3,8 млн ₽» — для крупных сумм в сводках.
export function mln(n: number) {
  return (n / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '\u00a0млн\u00a0₽';
}