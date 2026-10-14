// Справочники интерфейса: статусы и способы закупки, виды полей заявки, формат сумм. Всё, что раньше было здесь
// выдуманным примером закупки, теперь берётся из настоящей закупки (web/src/lib). Остались только примеры экранов
// «Поиск закупок»: он помечен «скоро» и показывает пример. История заявок — из настоящих закупок (BidHistory.tsx).

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
  // Срок подачи на глаз: красноватый — приём закончился, жёлтый — скоро (lib/deadline.ts); «осталось N дней» — словами.
  dueTone?: 'danger' | 'warn' | 'neutral';
  dueLeft?: string;
};

export const statusLabels: Record<TenderStatus, { label: string; tone: 'neutral' | 'warn' | 'success'; hint: string }> = {
  draft: { label: 'Черновик', tone: 'neutral', hint: 'Загружена не вся документация — разбор ещё не сделан.' },
  progress: { label: 'В работе', tone: 'warn', hint: 'Документы составлены, осталось заполнить и подтвердить поля.' },
  ready: { label: 'Готова к подаче', tone: 'success', hint: 'Пустых обязательных полей нет — осталось подписать и подать на площадке.' },
  submitted: { label: 'Подана', tone: 'success', hint: 'Заявка подана на площадке — ждём итогов.' },
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

export function rub(n: number) {
  return Math.round(n).toLocaleString('ru-RU') + '\u00a0₽';
}

// «3,8 млн ₽» — для крупных сумм в сводках.
export function mln(n: number) {
  return (n / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '\u00a0млн\u00a0₽';
}