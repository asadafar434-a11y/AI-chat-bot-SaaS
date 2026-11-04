import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { buildReport, type Parts } from '@/lib/counterparty';
import { contractRisks } from '@/lib/contract-risks';
import { DEFAULT_ASSUMPTIONS, estimateRisks } from '@/lib/risk-estimate';
import { DEFAULT_ECON, economics } from '@/lib/economics';
import { findCustomerPriceTable } from '@/lib/customer-price-table';
import { executionCost } from '@/lib/execution-cost';
import { AnalyticsChart } from './components/AnalyticsChart';
import { AnalyticsFindings } from './components/AnalyticsFindings';
import { CrewCostCard } from './components/CrewCost';
import { CustomerQuotesCard } from './components/CustomerQuotes';
import { ExecutionCostCard } from './components/ExecutionCost';
import { PositionPricesCard } from './components/PositionPrices';
import { ServiceVolumeCard } from './components/ServiceVolume';
import { AnalyticsSummary } from './components/AnalyticsSummary';
import { CounterpartyReportView } from './components/Counterparty';
import { TenderRating } from './components/TenderRating';
import { Button } from './components/ui';

// Предпросмотр отчёта «Проверка контрагента» на примерных данных — служебная страница, в продукт не входит. Суммы — в тысячах рублей, как в отчётности.

const OK = { checko: { ok: true as const } };

const healthy: Parts = {
  inn: '7707049388',
  egrul: { name: 'ООО "СЕВЕРНЫЙ ПОСТАВЩИК"', shortName: 'ООО "СЕВЕРНЫЙ ПОСТАВЩИК"', ogrn: '1087746123456', kpp: '770701001', registered: '2008-04-14', terminated: null, headRole: 'Генеральный директор', headName: 'Петров Алексей Сергеевич', region: 'г. Москва' },
  fedresurs: null,
  bo: null,
  address: '125009, г. Москва, ул. Тверская, д. 12, стр. 1',
  statusText: 'Действует',
  statements: [
    { year: 2025, revenue: 842_000, netProfit: 69_000, assets: 512_000, equity: 231_000 },
    { year: 2024, revenue: 742_000, netProfit: 58_000, assets: 468_000, equity: 162_000 },
    { year: 2023, revenue: 610_000, netProfit: 41_000, assets: 401_000, equity: 104_000 },
    { year: 2022, revenue: 520_000, netProfit: 34_000, assets: 352_000, equity: 63_000 },
    { year: 2021, revenue: 410_000, netProfit: 21_000, assets: 300_000, equity: 29_000 },
  ],
  rnp: { included: false, records: [] },
  taxes: { year: '2025', paid: 98_400, arrears: null, arrearsDate: null, regimes: ['ОСН'] },
  msp: { category: 'средний', since: '2016-08-10' },
  staff: 184,
  courts: {
    total: 14,
    active: 2,
    plaintiff: 9,
    defendant: 5,
    claimSum: 3_200,
    cases: [
      { number: 'А40-118204/2026', date: '2026-09-18', url: 'https://kad.arbitr.ru/', role: 'plaintiff', claimSum: 1_450, active: true, result: null, opponent: 'ООО "ТехноСнаб"' },
      { number: 'А40-90311/2026', date: '2026-07-02', url: 'https://kad.arbitr.ru/', role: 'defendant', claimSum: 380, active: true, result: null, opponent: 'АО "Логистик-Центр"' },
      { number: 'А40-14002/2026', date: '2026-02-11', url: 'https://kad.arbitr.ru/', role: 'plaintiff', claimSum: 920, active: false, result: 'иск удовлетворён', opponent: 'ООО "Вектор"' },
    ],
  },
  enforcements: { total: 1, debtSum: 420, outstandingSum: 120, items: [{ number: '111/2026/77001-ИП', date: '2026-03-04', subject: 'Взыскание задолженности', debt: 420, outstanding: 120 }] },
  efrsb: [],
  sanctions: { included: false, countries: [], founderLinked: false },
  contacts: { phones: ['+7 495 000-00-00'], emails: ['info@severny.example'], website: 'https://severny.example' },
  reliability: {
    scale: 62,
    nominality: { level: 1, text: 'Риск номинальности не выявлен' },
    financial: { level: 1, text: 'Финансовые риски не выявлены' },
    balance: { good: 78, warn: 19, bad: 3 },
    factors: [
      { code: 'age', tone: 'good', weight: 1, text: 'Юридическое лицо зарегистрировано 18 лет назад' },
      { code: 'msp', tone: 'good', weight: 1, text: 'Входит в реестр субъектов малого и среднего предпринимательства' },
      { code: 'courts', tone: 'warn', weight: 1, text: 'Есть незавершённые арбитражные дела в роли ответчика' },
    ],
  },
  provider: 'checko',
  sources: OK,
};

const troubled: Parts = {
  inn: '7814123727',
  egrul: { name: 'ООО "ВОЗРОЖДЕНИЕ ПЕТЕРБУРГА"', shortName: 'ООО "ВОЗРОЖДЕНИЕ ПЕТЕРБУРГА"', ogrn: '1137847000000', kpp: '781401001', registered: '2013-05-20', terminated: null, headRole: 'Конкурсный управляющий', headName: 'Сидоров Игорь Павлович', region: 'г. Санкт-Петербург' },
  fedresurs: null,
  bo: null,
  address: '197198, г. Санкт-Петербург, ул. Блохина, д. 8',
  statusText: 'Юридическое лицо признано несостоятельным (банкротом) и в отношении него открыто конкурсное производство',
  statements: [
    { year: 2025, revenue: 96_000, netProfit: -31_000, assets: 74_000, equity: -52_000 },
    { year: 2024, revenue: 188_000, netProfit: -22_000, assets: 120_000, equity: -21_000 },
    { year: 2023, revenue: 241_000, netProfit: 3_000, assets: 176_000, equity: 1_000 },
  ],
  rnp: { included: true, records: [{ number: 'РНП.54321-26', date: '2026-04-09', customer: 'ГБУ «Жилищное агентство»', purchase: 'Ремонт кровли, закупка № 0372200000126000041' }] },
  taxes: { year: '2025', paid: 4_100, arrears: 9_800, arrearsDate: '2026-10-01', regimes: ['УСН'] },
  msp: null,
  staff: 12,
  courts: { total: 63, active: 21, plaintiff: 3, defendant: 60, claimSum: 128_000, cases: [{ number: 'А56-40112/2026', date: '2026-10-21', url: 'https://kad.arbitr.ru/', role: 'defendant', claimSum: 18_400, active: true, result: null, opponent: 'ПАО "Банк Развития"' }] },
  enforcements: { total: 38, debtSum: 64_000, outstandingSum: 58_000, items: [{ number: '88121/26/78022-ИП', date: '2026-08-14', subject: 'Задолженность по кредитному договору', debt: 31_000, outstanding: 31_000 }] },
  efrsb: [{ type: 'Решение о признании банкротом', date: '2026-06-17', caseNumber: 'А56-7788/2025' }],
  sanctions: { included: true, countries: ['США', 'ЕС'], founderLinked: true },
  contacts: { phones: [], emails: [], website: null },
  reliability: { scale: 8, nominality: { level: 3, text: 'Высокий риск номинальности' }, financial: { level: 3, text: 'Высокие финансовые риски' }, balance: { good: 14, warn: 31, bad: 55 }, factors: [{ code: 'bk', tone: 'danger', weight: 3, text: 'Открыто конкурсное производство' }, { code: 'rnp', tone: 'danger', weight: 3, text: 'Есть запись в реестре недобросовестных поставщиков' }] },
  provider: 'checko',
  sources: OK,
};

const NOW = new Date('2026-11-04T10:00:00Z');

// Цены и исполнение: блоки экрана закупки на данных из тестов экрана.
const bratskRows = [
  ['1', 'Офисное кресло', '7,00', '6 905,20 | 8 300,00 | 0,00 | 5 510,00 | 0,00 | 0,00', '6 905,07', '48 335,49'],
  ['12', 'Кровать односпальная с металлическим основанием', '20,00', '19 642,00 | 24 390,00 | 22 000,00 | 0,00 | 0,00 | 0,00', '22 010,67', '440 213,40'],
  ['13', 'Комод', '15,00', '7 667,70 | 0,00 | 0,00 | 0,00 | 9 825,00 | 7 469,00', '8 320,57', '124 808,55'],
  ['14', 'Тумба с выдвижным ящиком и дверцей', '50,00', '7 454,20 | 9 700,00 | 9 500,00 | 0,00 | 0,00 | 0,00', '8 884,73', '444 236,50'],
]
  .map(([no, name, qty, offers, mean, total]) => [no, name, '31.09.12.121', 'шт', qty, offers, '1 000,00', '10,00', mean, total].join(' | '))
  .join('\n');
const priceTable = findCustomerPriceTable([{ name: 'Извещение.docx', text: bratskRows }] as never)!;
const execution = executionCost(priceTable, 1_150_000);
const terms = { place: 'г. Братск', term: '15 календарных дней', duties: ['разгрузка', 'подъём на этаж', 'сборка', 'установка'], priceClause: '2.5' };
const sheet = {
  rows: [
    { id: 'doc-1', name: 'Офисное кресло Chairman 696 LT', qty: 7, doc: { min: 5510, mean: 6905.07, max: 8300 }, web: { kind: 'exact', from: 5223.8, to: 5223.8, mid: 5223.8, n: 1, host: 'o-manager.ru' }, used: 'internet', webDiffers: false, total: 36566 },
    { id: 'doc-12', name: 'Кровать', qty: 20, doc: { min: 19642, mean: 22010, max: 24390 }, web: { kind: 'exact', from: 7040, to: 7040, mid: 7040, n: 1, host: 'a.ru' }, used: 'document', webDiffers: true, total: 440200 },
  ],
  table: null,
  counts: { internet: 1, document: 1, analog: 0, missing: 0 },
};
const priceRow = (over = {}) => ({
  id: 'p1', name: 'Уголь каменный ДПК', unit: 'т', qty: '1500', customerUnit: 6100, state: 'found', median: 5100, range: { from: 5000, to: 5200 }, n: 5, gapPct: 19.6, cost: 7650000,
  sources: [{ host: 'shop3.ru', product: 'Уголь каменный ДПК', price: 5100, date: '2026-10-20', url: 'https://shop3.ru/price' }, { host: 'shop9.ru', product: 'Уголь ДПК 6-13', price: 5150, date: '2026-10-19', url: null }],
  ...over,
});
const prices = {
  rows: [priceRow(), priceRow({ id: 'p2', name: 'Сварочный агрегат НПП КВАНТ МАКС-500', unit: 'шт', qty: '2', state: 'few', median: null, n: 1, range: { from: 1507504, to: 1507504 }, gapPct: null, cost: null, customerUnit: 1600000, sources: [{ host: 'gk-sk.ru', product: 'Сварочный агрегат МАКС-500', price: 1507504, date: '2026-10-23', url: 'https://gk-sk.ru/x' }] })],
  priced: 2, cost: 7650000, costPositions: 1, asOf: '2026-10-20',
};
const quotes = { doc: 'Приложение №9 к ДоЗ - ОБОСНОВАНИЕ НМЦ.docx', quotes: [{ label: 'ТКП №1', price: 9305651.64 }, { label: 'ТКП №2', price: 9377049.18 }, { label: 'ТКП №3', price: 9581967.21 }], min: 9305651.64, max: 9581967.21, mean: 9421556.01, spreadPct: 2.969, vat: 'without' };
const volume = { doc: 'Техническое задание.docx', unit: 'детодень', unitsLabel: 'детодней', unitOf: 'детодня', one: 'одного', rows: new Array(10).fill(null).map((_, i) => ({ category: 'Категория ' + (i + 1), people: 1, period: 1, units: 1 })), people: 608, total: 54112 };
const obs = (host: string, monthly: number) => ({ kind: 'salary', subject: 'x', monthly, min: null, max: null, region: 'Тверская область', regionMatch: 'same', host, url: `https://${host}/1`, date: '2026-10-27', quote: 'цитата с ценой', notes: [] });
const crewLine = (key: string, kind: string, name: string, count: number, monthly: number | null, sources: unknown[] = []) => ({ key, kind, name, count, monthly, basis: monthly === null ? 'none' : 'region', sources, total: monthly === null ? null : monthly * count });
const crewNeed = { doc: 'Проектно-техническая документация.docx', staff: [{ role: 'Кладовщик', count: 6, requirement: null }, { role: 'Водитель штабелера', count: 20, requirement: null }], equipment: [{ name: 'Ричтрак', count: 10 }], months: 24 };
const crewCost = {
  staff: [crewLine('s:Кладовщик', 'salary', 'Кладовщик', 6, 65000, [obs('gorodrabot.ru', 65000)]), crewLine('s:Водитель штабелера', 'salary', 'Водитель штабелера', 20, null)],
  equipment: [crewLine('e:Ричтрак', 'rent', 'Ричтрак', 10, 100000, [obs('arenda.ru', 100000)])],
  months: 24, contributionsPct: 30.2, covered: { staff: [1, 2], equipment: [1, 1] }, complete: false,
  staffMonth: 390000, contributionsMonth: 117780, equipmentMonth: 1000000, monthTotal: 1507780, termTotal: 36186720, perUnit: 103.06,
};
const findings = [
  { id: 'contract', label: 'Договор', text: 'Неустойка 0,1 % в день, оплата через 30 дней, твёрдая цена', tone: 'warn' },
  { id: 'risks', label: 'Риски в рублях', text: 'до 128 007 ₽ — если сработают все', tone: 'warn' },
  { id: 'price', label: 'Цена и рынок', text: 'запас начальной цены над закупкой 19,6 %', tone: 'good' },
  { id: 'matrix', label: '27 проверок', text: 'проверено 15 из 27, критичных рисков нет', tone: 'good' },
];

// Экран закупки в «Аналитике»: итог, рейтинг, итоговая диаграмма — на данных из тестов экрана.
const docs = [
  {
    name: 'Проект договора.docx',
    text: [
      'Договор поставки № 1',
      '7.3. Исполнитель обязан уплатить Заказчику пеню в размере 0,1% от цены Договора за каждый день просрочки.',
      '3.6. Оплата производится Заказчиком в течение 30 дней с даты акта.',
      '10.1. Договор заключается после предоставления Исполнителем обеспечения исполнения Договора в размере 5 % от цены.',
      '2.1. Цена Договора является твёрдой и определяется на весь срок исполнения Договора.',
      '5.12. Расходы на экспертизу несёт Исполнитель, за исключением случаев, когда экспертизой установлено отсутствие нарушений.',
    ].join('\n'),
  },
];
const risks = contractRisks(docs as never);
const estimate = estimateRisks({ price: 1_000_000, risks, type: 'goods', region: null, assumptions: DEFAULT_ASSUMPTIONS });
const econ = economics({ calc: { nmck: 1_000_000, costs: 700_000, extra: 10_000, taxPct: 6, securityPct: 5, smeOnly: false, exempt: false, method: 'guarantee', guaranteeRatePct: null, moneyRatePct: null, days: null, antiDumping: false, goodFaith: false, price: null } as never, estimate, settings: DEFAULT_ECON, price: null });
const factor = (id: string, title: string, weight: number, score: number | null, note: string) => ({ id, title, weight, score, tone: score === null ? 'muted' : score >= 65 ? 'good' : score >= 50 ? 'warn' : 'danger', note, basis: 'как считается, формула словами', missing: score === null ? ['чего не хватает'] : [] });
const rating = {
  status: 'ready', score: 72, rawScore: 72, capped: false, verdict: { label: 'Перспективный', tone: 'good' }, coverage: 75, blockers: [], missing: [{ factor: 'Конкуренция', items: ['Источник данных о конкуренции (ЕИС) не подключён'] }],
  factors: [
    factor('profile', 'Соответствие профилю компании', 25, 100, 'проверено 7 из 7; замечаний нет'),
    factor('profit', 'Рентабельность', 25, 64, 'маржа до рисков 6,4 % при цели 10 %'),
    factor('price', 'Цена относительно рынка', 15, null, 'сравнить с рынком нечем'),
    factor('risks', 'Риски исполнения', 15, 80, 'риски до 10 % цены'),
    factor('competition', 'Конкуренция', 10, null, 'проверено 0 из 5'),
    factor('reliability', 'Надёжность заказчика', 10, null, 'проверено 1 из 8'),
  ],
};
const summary = {
  verdict: { level: 'careful', label: 'Участвовать осторожно', reasons: ['Маржа 6,4 % при цели 10 %.', 'Неустойка 0,1 % в день и твёрдая цена.'] },
  text: 'Поставка оборудования. Начальная цена 1 000 000 ₽.',
  facts: [{ label: 'Начальная цена', value: '1 000 000 ₽' }, { label: 'Риски в рублях', value: '84 000 ₽' }],
  recommendations: ['Заложите запас по срокам.', 'Запросите цену экспертизы.'],
  sections: [],
};
const REPORTS = { healthy: buildReport(healthy, NOW), troubled: buildReport(troubled, NOW) };

function Page() {
  const [dark, setDark] = useState(false);
  const [which, setWhich] = useState<'healthy' | 'troubled' | 'purchase' | 'prices'>('healthy');
  document.documentElement.classList.toggle('dark', dark);
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={which === 'healthy' ? 'primary' : 'secondary'} size="sm" onClick={() => setWhich('healthy')}>
          Благополучная
        </Button>
        <Button variant={which === 'troubled' ? 'primary' : 'secondary'} size="sm" onClick={() => setWhich('troubled')}>
          Проблемная
        </Button>
        <Button variant={which === 'purchase' ? 'primary' : 'secondary'} size="sm" onClick={() => setWhich('purchase')}>
          Экран закупки
        </Button>
        <Button variant={which === 'prices' ? 'primary' : 'secondary'} size="sm" onClick={() => setWhich('prices')}>
          Цены и исполнение
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setDark(!dark)}>
          {dark ? 'Светлая' : 'Тёмная'}
        </Button>
      </div>
      {which === 'prices' ? (
        <div className="space-y-4">
          <ServiceVolumeCard volume={volume as never} nmck={10542628.64} costs={null} />
          <CrewCostCard need={crewNeed as never} cost={crewCost as never} state="done" saved={{ at: '2026-10-27T09:00:00.000Z', signature: 's', results: [], spentRub: 3.2 } as never} error={null} perUnitLabel="тонну" />
          <ExecutionCostCard cost={execution} table={priceTable} sheet={sheet as never} terms={terms as never} />
          <PositionPricesCard prices={prices as never} total={3} />
          <CustomerQuotesCard quotes={quotes as never} nmck={9305651.64} step="Шаг аукциона по документам — от 0,5 % до 5 % начальной цены: от 46 528,26 ₽ до 465 282,58 ₽ за один шаг" />
          <AnalyticsFindings lines={findings as never} search={{ line: null, pending: 0, busy: false, done: 0, error: null, onRun: () => {} }} />
        </div>
      ) : which === 'purchase' ? (
        <div className="space-y-4">
          <TenderRating rating={rating as never} />
          <AnalyticsSummary summary={summary as never} busy={null} error={null} onWord={() => {}} onPdf={() => {}} />
          <AnalyticsChart econ={econ} estimate={estimate} ric={null} />
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-4">
          <CounterpartyReportView report={REPORTS[which]} />
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Page />
  </React.StrictMode>,
);
