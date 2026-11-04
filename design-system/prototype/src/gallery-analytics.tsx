import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { buildReport, type Parts } from '@/lib/counterparty';
import { contractRisks } from '@/lib/contract-risks';
import { DEFAULT_ASSUMPTIONS, estimateRisks } from '@/lib/risk-estimate';
import { DEFAULT_ECON, economics } from '@/lib/economics';
import { AnalyticsChart } from './components/AnalyticsChart';
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
  const [which, setWhich] = useState<'healthy' | 'troubled' | 'purchase'>('healthy');
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
        <Button variant="secondary" size="sm" onClick={() => setDark(!dark)}>
          {dark ? 'Светлая' : 'Тёмная'}
        </Button>
      </div>
      {which === 'purchase' ? (
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
