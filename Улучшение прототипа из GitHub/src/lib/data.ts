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

export const tender = {
  id: '0173200001325001842',
  title: 'Поставка компьютерного оборудования для нужд ГБУЗ «ГКБ №52»',
  platform: 'ЕИС / Госзакупки (44-ФЗ)',
  customer: 'ГБУЗ города Москвы «Городская клиническая больница №52»',
  nmck: 4_280_000,
  deadline: '14 окт 2026, 10:00 МСК',
  law: '44-ФЗ',
  procedure: 'auction' as Procedure,
  security: 214_000,
};

// Реквизиты компании пользователя — используются для автозаполнения документов заявки.
export type CompanyField = { key: string; label: string; value: string; group: 'org' | 'bank' | 'contact' };

export const company = {
  name: 'ООО «ТехСнаб»',
  smp: true,
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

export const statusLabels: Record<TenderStatus, { label: string; tone: 'neutral' | 'warn' | 'success' }> = {
  draft: { label: 'Черновик', tone: 'neutral' },
  progress: { label: 'В работе', tone: 'warn' },
  ready: { label: 'Готова к подаче', tone: 'success' },
  submitted: { label: 'Подана', tone: 'success' },
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

// Найденные закупки при поиске по площадкам (ЕИС, площадки 44-ФЗ / 223-ФЗ).
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

// История поданных заявок с результатами.
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

export type RequiredDoc = {
  id: string;
  title: string;
  ref: string;
  status: CheckStatus;
  note: string;
  auto: boolean;
};

export const requiredDocs: RequiredDoc[] = [
  {
    id: 'zayavka-1',
    title: 'Заявка на участие (первая часть)',
    ref: 'ч. 1 ст. 43 44-ФЗ',
    status: 'ok',
    note: 'Согласие на поставку по ТЗ. Сформировано автоматически.',
    auto: true,
  },
  {
    id: 'zayavka-2',
    title: 'Заявка на участие (вторая часть)',
    ref: 'ч. 2 ст. 43 44-ФЗ',
    status: 'warn',
    note: 'Требуется подтвердить характеристики по 3 позициям ТЗ.',
    auto: true,
  },
  {
    id: 'decl-smsp',
    title: 'Декларация о принадлежности к СМП',
    ref: 'ч. 3 ст. 30 44-ФЗ',
    status: 'ok',
    note: 'Организация в реестре СМП. Подтягивается из ЕГРЮЛ.',
    auto: true,
  },
  {
    id: 'license',
    title: 'Лицензия / сертификаты соответствия',
    ref: 'п. 5 ТЗ',
    status: 'missing',
    note: 'Нет сертификата соответствия на позицию №7 (МФУ).',
    auto: false,
  },
  {
    id: 'guarantee',
    title: 'Обеспечение заявки',
    ref: 'ст. 44 44-ФЗ',
    status: 'warn',
    note: 'Спецсчёт указан, но сумма блокировки не подтверждена банком.',
    auto: false,
  },
  {
    id: 'price-form',
    title: 'Ценовое предложение',
    ref: 'Приложение №2',
    status: 'ok',
    note: 'Рассчитано на основе обоснования НМЦК.',
    auto: true,
  },
];

export type PriceRow = {
  position: string;
  qty: number;
  nmc: number;
  our: number;
};

export const priceRows: PriceRow[] = [
  { position: 'Моноблок 23.8", i5 / 16 ГБ', qty: 40, nmc: 62_000, our: 57_900 },
  { position: 'Ноутбук 15.6", i5 / 16 ГБ', qty: 25, nmc: 71_000, our: 66_400 },
  { position: 'МФУ лазерное А4', qty: 12, nmc: 34_500, our: 32_100 },
  { position: 'Источник беспереб. питания', qty: 40, nmc: 8_900, our: 8_200 },
];

// «Слепая зона» — место, которое ИИ пометил как незаполненное/некорректное.
// Каждая зона объясняет ЧТО не так, ПОЧЕМУ ИИ не смог заполнить сам,
// и даёт конкретный способ исправить прямо в интерфейсе.
export type GapKind = 'text' | 'upload' | 'choice';

export type Gap = {
  id: string;
  position: string; // например «Поз. 7»
  label: string; // что именно требуется
  severity: 'high' | 'medium' | 'low';
  ref: string; // ссылка на норму / пункт ТЗ
  // Почему это «слепая зона» — что именно ИИ проверил и почему не смог заполнить
  why: string;
  // Последствие, если оставить как есть
  consequence: string;
  kind: GapKind;
  // Для text: подсказка ввода; для choice: варианты; для upload: тип файла
  placeholder?: string;
  choices?: string[];
  accept?: string;
  weight: number; // вклад в риск отклонения, %
};

export const gaps: Gap[] = [
  {
    id: 'cert-poz7',
    position: 'Поз. 7',
    label: 'Сертификат соответствия на МФУ',
    severity: 'high',
    ref: 'ч. 12 ст. 48 44-ФЗ · п. 5 ТЗ',
    why: 'Сертификат — это отдельный файл. В загруженном комплекте (извещение, ТЗ, контракт, расчёт НМЦК) его нет, а автоматически создать его нельзя — документ выдаёт орган по сертификации. Поэтому ИИ не может ни найти, ни подставить его сам.',
    consequence: 'Без сертификата заявку отклонят автоматически как несоответствующую требованиям.',
    kind: 'upload',
    accept: 'PDF, JPG — скан сертификата или письма производителя',
    weight: 35,
  },
  {
    id: 'guarantee',
    position: 'Обеспечение',
    label: 'Подтверждение блокировки 214 000 ₽',
    severity: 'medium',
    ref: 'ст. 44 44-ФЗ',
    why: 'ИИ видит реквизиты спецсчёта, но статус блокировки суммы приходит из банка, а не из тендерной документации. Эти данные вне загруженных файлов — подтвердить может только участник.',
    consequence: 'Если сумма не заблокирована к моменту подачи, заявка не будет допущена.',
    kind: 'choice',
    choices: ['Заблокировано — подтверждено банком', 'Гарантия от банка (независимая)', 'Ещё не оформлено'],
    weight: 18,
  },
  {
    id: 'poz2-storage',
    position: 'Поз. 2',
    label: 'Тип и объём накопителя ноутбука',
    severity: 'low',
    ref: 'ТЗ п. 4.2',
    why: 'В ТЗ параметр обязателен, но в вашем коммерческом предложении поле пустое. У ИИ нет источника этого значения — его знаете только вы (по модели поставляемого товара).',
    consequence: 'Неполная характеристика — основание отклонить вторую часть заявки.',
    kind: 'text',
    placeholder: 'например: SSD, 512 ГБ',
    weight: 7,
  },
  {
    id: 'poz5-speed',
    position: 'Поз. 5',
    label: 'Скорость печати МФУ, стр/мин',
    severity: 'low',
    ref: 'ТЗ п. 5.3',
    why: 'Требование ТЗ — не менее 30 стр/мин. В прайсе и спецификации из загруженных файлов скорость не указана, поэтому ИИ оставил поле открытым.',
    consequence: 'Расхождение с ТЗ по неуказанному параметру — риск отклонения.',
    kind: 'text',
    placeholder: 'например: 35 стр/мин',
    weight: 7,
  },
  {
    id: 'poz9-power',
    position: 'Поз. 9',
    label: 'Выходная мощность ИБП, ВА/Вт',
    severity: 'low',
    ref: 'ТЗ п. 7.1',
    why: 'Значение зависит от конкретной модели ИБП, которую вы поставляете. В документах закупки его нет — заполняется участником.',
    consequence: 'Характеристика неполна — вторую часть могут отклонить.',
    kind: 'text',
    placeholder: 'например: 800 ВА / 480 Вт',
    weight: 6,
  },
];

export type ExportFormat = { ext: string; label: string };
export const exportFormats: ExportFormat[] = [
  { ext: 'PDF', label: 'Portable Document Format' },
  { ext: 'DOCX', label: 'Microsoft Word' },
  { ext: 'ODT', label: 'OpenDocument' },
  { ext: 'ZIP', label: 'Весь пакет одним архивом' },
];

export function rub(n: number) {
  return n.toLocaleString('ru-RU') + ' ₽';
}
