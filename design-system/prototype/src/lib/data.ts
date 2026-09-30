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