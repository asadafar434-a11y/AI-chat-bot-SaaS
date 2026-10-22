// Раздел «Аналитика» и РИЦ (расчёт индикативной цены), отрисованные на сервере в строку, — npm test в design-system/prototype.
// Смотрим на разметку: пункт меню, список закупок, что видит участник при неполном и полном расчёте, и что нет слов про бейдж как готовый.
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
let server;
let mods;

before(async () => {
  server = await createServer({
    root,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, fs: { allow: [path.resolve(root, '../..')] } },
    resolve: { alias: [{ find: '@', replacement: path.resolve(root, '../../web/src') }] },
  });
  mods = {
    home: await server.ssrLoadModule('/src/components/Analytics.tsx'),
    ric: await server.ssrLoadModule('/src/components/RicPanel.tsx'),
    lib: await server.ssrLoadModule('@/lib/indicative-price.ts'),
    badge: await server.ssrLoadModule('@/lib/price-badge.ts'),
    nmcklib: await server.ssrLoadModule('@/lib/nmck-check.ts'),
    nmck: await server.ssrLoadModule('/src/components/NmckCheck.tsx'),
    cert: await server.ssrLoadModule('/src/components/Certainty.tsx'),
    estUi: await server.ssrLoadModule('/src/components/RiskEstimates.tsx'),
    estLib: await server.ssrLoadModule('@/lib/risk-estimate.ts'),
    econUi: await server.ssrLoadModule('/src/components/Economics.tsx'),
    econLib: await server.ssrLoadModule('@/lib/economics.ts'),
    hiddenLib: await server.ssrLoadModule('@/lib/hidden-costs.ts'),
    sensLib: await server.ssrLoadModule('@/lib/sensitivity.ts'),
    risksUi: await server.ssrLoadModule('/src/components/ContractRisks.tsx'),
    risksLib: await server.ssrLoadModule('@/lib/contract-risks.ts'),
    side: await server.ssrLoadModule('/src/components/Sidebar.tsx'),
    sumUi: await server.ssrLoadModule('/src/components/AnalyticsSummary.tsx'),
    collapsible: await server.ssrLoadModule('/src/components/Collapsible.tsx'),
    chartUi: await server.ssrLoadModule('/src/components/AnalyticsChart.tsx'),
    scenUi: await server.ssrLoadModule('/src/components/RicScenarioPanel.tsx'),
    scenLib: await server.ssrLoadModule('@/lib/ric-scenarios.ts'),
    importUi: await server.ssrLoadModule('/src/components/AnalogImport.tsx'),
    factUi: await server.ssrLoadModule('/src/components/FactCosts.tsx'),
    intakeUi: await server.ssrLoadModule('/src/components/AnalyticsIntake.tsx'),
    deliveryLib: await server.ssrLoadModule('@/lib/delivery-cost.ts'),
    fxLib: await server.ssrLoadModule('@/lib/fx-risk.ts'),
    factEst: await server.ssrLoadModule('@/lib/fact-estimates.ts'),
    matrixUi: await server.ssrLoadModule('/src/components/CheckMatrix.tsx'),
    matrixLib: await server.ssrLoadModule('@/lib/check-matrix.ts'),
  };
});

after(async () => {
  await server?.close();
});

const none = () => {};
const text = (out) => out.replace(/<[^>]+>/g, ' ').replace(/[  ]/g, ' ').replace(/\s+/g, ' ');
const NOW = new Date(2026, 9, 21);
const analog = (id, price, over = {}) => ({ id, price, vat: 'without', source: 'КП ООО «Север»', date: '2026-09-15', ...over });
const data = (positions, over = {}) => ({ positions, settings: { ...mods.lib.DEFAULT_SETTINGS, nmckVat: 'without', ...over } });
const panel = (d, nmck, over = {}) => {
  const result = mods.lib.computeRic(d, nmck, NOW);
  return renderToStaticMarkup(
    h(mods.ric.RicPanel, { data: d, result, badge: mods.badge.priceBadge(result, d), importSource: null, importNote: null, onImport: none, onChange: none, ...over }),
  );
};
const five = (id) => ['90', '95', '100', '105', '110'].map((price, i) => analog(`${id}${i}`, price, { source: `КП ${i + 1}` }));

test('меню: есть пункт «Аналитика» — отдельный раздел слева, без пометки «скоро»', () => {
  const out = renderToStaticMarkup(
    h(mods.side.Sidebar, {
      view: 'analytics',
      onNavigate: none,
      onNewTender: none,
      onOpenChat: none,
      dark: false,
      setDark: none,
      notices: [],
      onOpenNotice: none,
      credits: 0,
      company: { name: '', inn: '' },
    }),
  );
  const item = /<button[^>]*>(?:(?!<\/button>).)*Аналитика(?:(?!<\/button>).)*<\/button>/s.exec(out);
  assert.ok(item, 'пункт «Аналитика» в меню');
  assert.equal(/скоро/i.test(item[0]), false);
});

test('раздел: список закупок, «готово» у РИЦ и «скоро» у остального; закупок нет — предложение создать', () => {
  const list = text(
    renderToStaticMarkup(h(mods.home.AnalyticsHome, { purchases: [{ id: 'p1', title: 'Поставка угля', price: '25 930 002,00 ₽', kind: '223-ФЗ · аукцион' }], onOpen: none, onUpload: none })),
  );
  assert.match(list, /Поставка угля/);
  assert.match(list, /начальная цена 25 930 002,00 ₽/);
  assert.equal(list.includes('Открыть расчёт'), false, 'строка закупки — кнопка целиком, без лишней подписи');
  assert.match(list, /РИЦ — расчёт индикативной цены/);
  assert.match(list, /Расчёт цены у заказчика/);
  assert.match(list, /Ценовой бейдж/);
  assert.match(list, /Риски и расходы из договора/);
  assert.match(list, /Сколько это может стоить/);
  assert.match(list, /Какую цену ставить/);
  assert.ok((list.match(/готово/g) ?? []).length >= 5, 'пять шагов готовы');
  assert.ok((renderToStaticMarkup(h(mods.home.AnalyticsHome, { purchases: [], onOpen: none, onUpload: none })).match(/скоро/g) ?? []).length >= 3, 'остальное помечено «скоро»');
  assert.match(text(renderToStaticMarkup(h(mods.home.AnalyticsHome, { purchases: [], onOpen: none, onUpload: none }))), /Загрузить закупку/);
  assert.match(text(renderToStaticMarkup(h(mods.home.AnalyticsHome, { purchases: null, onOpen: none, onUpload: none }))), /Читаю закупки/);
});

test('пока позиций нет: сказано, что делать — взять из документов или добавить, нужно не меньше трёх аналогов с источником и датой', () => {
  const out = text(panel(data([]), null));
  assert.match(out, /РИЦ — расчёт индикативной цены/);
  assert.match(out, /Взять позиции из документов/);
  assert.match(out, /Добавить позицию/);
  assert.match(out, /Нужно не меньше 3 цен на позицию, для бейджа — 5/);
  assert.equal(/Итог по закупке/.test(out), false, 'итога без позиций нет');
});

test('расчёт неполный: видно, у скольких позиций есть цена, итога и отклонения нет; бейдж — «недостаточно данных» с причиной', () => {
  const d = data([
    { id: 'p1', name: 'Уголь', unit: 'т', qty: '10', analogs: [analog('a1', '100'), analog('a2', '100'), analog('a3', '100')] },
    { id: 'p2', name: 'Доставка', unit: 'усл.', qty: '1', analogs: [analog('a4', '50')] },
  ]);
  const out = text(panel(d, 5000));
  assert.match(out, /Недостаточно данных для оценки цены/);
  assert.match(out, /Чего не хватает для оценки цены/);
  assert.match(out, /Цена посчитана не у всех позиций: у 1 из 2/);
  assert.match(out, /Нужно ещё 2 цены/);
  assert.match(out, /РИЦ \(без НДС\) —/);
  assert.equal(/существенно (выше|ниже) рынка/.test(out), false, 'без данных категоричного бейджа нет');
  assert.equal(/Почему такой бейдж/.test(out), false);
});

test('расчёт полный, но цен меньше пяти: РИЦ, диапазон и отклонение есть, а бейдж «выше рынка» не ставится', () => {
  const d = data([{ id: 'p1', name: 'Уголь', unit: 'т', qty: '10', customerUnit: 130, analogs: [analog('a1', '90'), analog('a2', '100'), analog('a3', '110')] }]);
  const out = text(panel(d, 1300));
  assert.match(out, /РИЦ \(без НДС\) 1 000,00 ₽/);
  assert.match(out, /900,00 ₽ — 1 100,00 ₽/);
  assert.match(out, /\+300,00 ₽ \(\+30,0 %\)/);
  assert.match(out, /Начальная цена заказчика за единицу: 130,00 ₽ — выше индикативной на 30,0 %/);
  assert.match(out, /цены однородны/);
  assert.match(out, /Недостаточно данных для оценки цены/);
  assert.match(out, /«Уголь»: сопоставимых цен 3, нужно не меньше 5\./);
  assert.equal(/существенно выше рынка/.test(out), false);
});

test('пять сопоставимых цен: бейдж «существенно выше рынка» с меткой «По вашим данным», осторожным пояснением и деталями расчёта', () => {
  const d = data([{ id: 'p1', name: 'Уголь', unit: 'т', qty: '10', analogs: five('a') }]);
  const out = text(panel(d, 2000));
  assert.match(out, /Цена существенно выше рынка/);
  assert.match(out, /По вашим данным/);
  assert.match(out, /Отклонение от РИЦ \+1 000,00 ₽ \(\+100,0 %\)/);
  assert.match(out, /Высокая цена — не повод для выводов: сверьте объёмы и условия/);
  assert.match(out, /Это не вывод о нарушении со стороны заказчика/);
  assert.match(out, /Это не вывод о нарушении со стороны заказчика/);
  assert.match(out, /Почему такой бейдж/);
  assert.match(out, /Рыночная медиана 1 000,00 ₽/);
  assert.match(out, /по позиции не меньше 5, всего 5/);
  assert.match(out, /Даты цен 15\.09\.2026 — 15\.09\.2026/);
  assert.match(out, /Источники КП 1; КП 2; КП 3; КП 4; КП 5/);
  assert.match(out, /Уверенность средняя/);
  assert.match(out, /отклонение от РИЦ не меньше 15 %/);
  assert.equal(/Чего не хватает/.test(out), false);
  const low = text(panel(d, 500));
  assert.match(low, /Цена существенно ниже рынка/);
  assert.match(low, /хватит ли цены на затраты, объёмы и характеристики/);
  assert.match(text(panel(d, 1050)), /Цена в рыночном диапазоне/);
});

test('неоднородные цены, устаревшая и неучтённая цена: предупреждения с причинами и предложение не учитывать одну цену — решает человек', () => {
  const d = data([
    {
      id: 'p1',
      name: 'Кран',
      unit: 'шт',
      qty: '1',
      analogs: [
        analog('a1', '100'),
        analog('a2', '105', { source: 'Прайс «Север»' }),
        analog('a3', '110'),
        analog('a4', '300', { source: 'КП «Дорогой»', date: '2026-01-10' }),
        analog('a5', '120', { source: '' }),
      ],
    },
  ]);
  const out = text(panel(d, 500));
  assert.match(out, /разброс выше 33 %/);
  assert.match(out, /Не учитывается: не указан источник/);
  assert.match(out, /Цена устарела/);
  assert.match(out, /Если не учитывать цену «КП «Дорогой»», вариация станет 4,8 %/);
  assert.equal(out.includes('решаете вы'), false);
  assert.match(out, /«Кран»: сопоставимых цен 4, нужно не меньше 5\./);
});

const NMCK_HEADER = ' |  |  | Поставщик №1 | Поставщик №2 | Поставщик №3 | Средняя арифметическая цена | Среднее квадратичное отклонение | коэффициент вариации цен V (%) | Расчёт НМЦК';
const nmckCalcs = (...rows) => mods.nmcklib.findNmckCalculations([{ name: 'Обоснование.xlsx', text: [NMCK_HEADER, ...rows].join('\n') }]);

test('расчёт цены у заказчика: метка «Подтверждено», замечания с текстом, сошедшиеся позиции свёрнуты', () => {
  const calcs = nmckCalcs('Питание |  |  | 170 | 173 | 176 | 173 | 0,098488578 | 0,072274586 | 173', 'Уголь | 2900 | 3 | 100 | 110 | 120 | 110 | 10 | 9,0909 | 319000');
  const out = text(renderToStaticMarkup(h(mods.nmck.NmckCheck, { calcs })));
  assert.match(out, /Расчёт цены у заказчика/);
  assert.match(out, /Подтверждено/);
  assert.match(out, /замечаний: 1 из 2/);
  assert.match(out, /Питание/);
  assert.match(out, /цены поставщиков: 170 · 173 · 176 → средняя 173, вариация 1,7 %/);
  assert.match(out, /Коэффициент вариации в расчёте 7,2 % не сходится с ценами: по ним получается 1,7 %/);
  assert.match(out, /Остальные позиции: 1/);
  const clean = text(renderToStaticMarkup(h(mods.nmck.NmckCheck, { calcs: nmckCalcs('Уголь | 2900 | 3 | 100 | 110 | 120 | 110 | 10 | 9,0909 | 319000') })));
  assert.match(clean, /1 из 1 сходятся/);
  assert.equal(/замечаний:/.test(clean), false);
});

test('расчёт цены у заказчика не нашёлся: так и сказано, метки «Подтверждено» нет', () => {
  const out = text(renderToStaticMarkup(h(mods.nmck.NmckCheck, { calcs: [] })));
  assert.match(out, /Расчёта начальной цены в документах нет/);
  assert.equal(/Подтверждено/.test(out), false);
});

const contractDocs = (...lines) => [{ name: 'Проект.docx', text: ['Договор поставки № 1', ...lines].join('\n') }];

test('риски из договора: метка «Подтверждено», «требуют внимания», крупная неустойка, кто платит, цитата с пунктом и файлом; остальные условия свёрнуты', () => {
  const docs = contractDocs(
    '7.3. Исполнитель обязан уплатить Заказчику пеню в размере 5% от цены Договора за каждый день просрочки.',
    '6.2. Заказчик выплачивает Исполнителю пеню в размере 0,01% от суммы долга за каждый день просрочки.',
    '5.12. Расходы на экспертизу несёт Исполнитель, за исключением случаев, когда экспертизой установлено отсутствие нарушений.',
    '2.2. Авансирование по Договору не предусмотрено.',
  );
  const out = text(renderToStaticMarkup(h(mods.risksUi.ContractRisks, { risks: mods.risksLib.contractRisks(docs), hasContract: true })));
  assert.match(out, /Риски и расходы из договора/);
  assert.match(out, /Подтверждено/);
  assert.match(out, /требуют внимания: 2/);
  assert.match(out, /Пеня 5 %, за каждый день просрочки, от цены Договора/);
  assert.match(out, /платите вы/);
  assert.match(out, /крупная/);
  assert.match(out, /Расходы за ваш счёт: экспертиза/);
  assert.match(out, /Цитата/);
  assert.match(out, /п\. 7\.3 · Проект\.docx/);
  assert.match(out, /Остальные условия: 2/);
  assert.match(out, /платит заказчик/);
});

test('риски из договора: договора нет — так и сказано и метка «Не проверено»; договор есть, цифр нет — не значит, что рисков нет', () => {
  const none = text(renderToStaticMarkup(h(mods.risksUi.ContractRisks, { risks: [], hasContract: false })));
  assert.match(none, /Проект договора не найден/);
  assert.match(none, /Не проверено/);
  assert.equal(/Подтверждено/.test(none), false);
  const empty = text(renderToStaticMarkup(h(mods.risksUi.ContractRisks, { risks: [], hasContract: true })));
  assert.match(empty, /Условий с цифрами не найдено — прочитайте раздел об ответственности/);
});

const SEVASTOPOL = { text: 'Место поставки: г. Севастополь', region: { name: 'Севастополь', hard: true } };
const estimateUi = (register, price = 1_000_000, extra = {}) => {
  const risks = mods.risksLib.contractRisks(
    contractDocs(
      '6.4. Заказчик вправе потребовать уплаты пени в размере 5 % (Пяти процентов) от Цены ГПД за каждый день просрочки.',
      '3.7. Оплата производится Заказчиком в течение 30 рабочих дней с момента получения заключения эксперта.',
      '10.1. Договор заключается после предоставления Исполнителем обеспечения исполнения Договора в размере 30 % от начальной цены.',
      '5.12. Расходы на экспертизу несёт Исполнитель, за исключением случаев, когда экспертизой установлено отсутствие нарушений.',
      '2.1. Цена Договора является твёрдой и определяется на весь срок исполнения Договора.',
    ),
  );
  const note = mods.hiddenLib.regionNote(SEVASTOPOL, 'г. Екатеринбург');
  const result = mods.estLib.estimateRisks({ price, risks, type: 'goods', region: note, assumptions: register.assumptions });
  return renderToStaticMarkup(
    h(mods.estUi.RiskEstimates, {
      result,
      price,
      priceNote: 'цена вашей заявки',
      hypotheses: mods.hiddenLib.hypothesesFor('goods', note, '44'),
      data: register,
      sens: mods.sensLib.computeSensitivity(register.sens),
      defaultDrivers: mods.hiddenLib.DEFAULT_DRIVERS.goods,
      priceHint: '1000000',
      onChange: none,
      ...extra,
    }),
  );
};

test('сколько это может стоить: метка «Оценка», общая сумма и доля цены, строки с рублями по условиям договора, «не определено» без числа', () => {
  const out = text(estimateUi(mods.hiddenLib.EMPTY_REGISTER));
  assert.match(out, /Сколько это может стоить по этому контракту/);
  assert.match(out, /Оценка/);
  assert.match(out, /Если сработают все риски с оценкой \(цена вашей заявки 1 000 000,00 ₽\)/);
  assert.match(out, /630 109,59 ₽ 63,0 % цены/);
  assert.match(out, /Просрочка: пеня 5 % в день 500 000,00 ₽ · 50,0 %/);
  assert.match(out, /Срыв срока на 10 дней по вашей вине: 5 % в день от цены/);
  assert.match(out, /Деньги заморожены 42 дней до оплаты 16 109,59 ₽ · 1,6 %/);
  assert.match(out, /Банковская гарантия 30 % цены 9 000,00 ₽ · 0,9 %/);
  assert.match(out, /Рост затрат на 10 % при твёрдой цене 85 000,00 ₽ · 8,5 %/);
  assert.match(out, /Гарантийный ремонт и замена брака 20 000,00 ₽ · 2,0 %/);
  assert.match(out, /За ваш счёт: экспертиза сумма не определена/);
  assert.match(out, /Запросите цену у исполнителя \(эксперта, банка, перевозчика\)/);
  assert.match(out, /Доставка или выезд: Севастополь вместо Свердловская область сумма не определена/);
  assert.match(out, /Без суммы: 2 — нужны данные/);
  assert.equal(/Не разобрано|Учтено в цене|Не актуально/.test(out), false, 'никаких отметок «разберите сами»');
  assert.ok(out.indexOf('Просрочка: пеня') < out.indexOf('Деньги заморожены'), 'крупное — выше');
  assert.ok(out.indexOf('Гарантийный ремонт') < out.indexOf('За ваш счёт: экспертиза'), 'без суммы — в конце');
});

test('сколько это может стоить: допущения видны и меняются, «на чём держатся числа», остальные риски без оценки списком; цены нет — оценить нечего', () => {
  const out = text(estimateUi(mods.hiddenLib.EMPTY_REGISTER));
  assert.match(out, /Допущения расчёта — можно поменять/);
  assert.match(out, /Стоимость денег, % годовых/);
  assert.match(out, /Банковская гарантия, % годовых/);
  assert.match(out, /Просрочка по вашей вине, дней/);
  assert.match(out, /На чём держатся числа/);
  assert.match(out, /допущение: ставка 14 % годовых/);
  assert.match(out, /Ещё риски для такой закупки без оценки: 7/);
  assert.equal(out.includes('Сумму по ним посчитает ИИ'), false, 'пояснение вместо списка рисков не нужно');
  const noPrice = text(
    renderToStaticMarkup(
      h(mods.estUi.RiskEstimates, {
        result: { items: [], total: 0, totalPct: null, unknown: 0 },
        price: null,
        priceNote: '',
        hypotheses: [],
        data: mods.hiddenLib.EMPTY_REGISTER,
        sens: mods.sensLib.computeSensitivity(mods.hiddenLib.EMPTY_REGISTER.sens),
        defaultDrivers: [],
        priceHint: '0,00',
        onChange: none,
      }),
    ),
  );
  assert.match(noPrice, /Цены контракта нет — укажите её на шаге «Цена»/);
});

test('сколько это может стоить: на своих цифрах — прибыль и вывод «хватит или нет» против общей суммы рисков, «бензин +10 %»', () => {
  const register = {
    assumptions: mods.estLib.DEFAULT_ASSUMPTIONS,
    sens: { price: '1 000 000', cost: '800 000', drivers: [{ id: 'a', name: 'Бензин', amount: '200 000', shock: '10' }, { id: 'b', name: 'Материалы', amount: '700 000', shock: '5' }] },
  };
  const out = text(estimateUi(register));
  assert.match(out, /Прибыль на ваших цифрах: 200 000,00 ₽ \(20,0 %\)/);
  assert.match(out, /Затраты могут вырасти на 25,0 %\s*, пока прибыль не станет нулевой/);
  assert.match(out, /Если сработают все оценённые риски \(\s*630 109,59 ₽\s*\), прибыли не хватит: контракт уйдёт в убыток/);
  assert.match(out, /Бензин: \+20 000,00 ₽ → прибыль 180 000,00 ₽ \(18,0 %\)/);
  assert.match(out, /Статьи в сумме больше всех затрат/);
  const roomy = text(estimateUi({ ...register, sens: { price: '1 000 000', cost: '200 000', drivers: [] } }));
  assert.match(roomy, /прибыль останется 169 890,41 ₽/);
});

const ECON_CALC = { nmck: 1_000_000, costs: 700_000, extra: 10_000, taxPct: 6, securityPct: 5, smeOnly: false, exempt: false, method: 'guarantee', guaranteeRatePct: null, moneyRatePct: null, days: null, antiDumping: false, goodFaith: false, price: null };
const econUi = (calcOver = {}, register = mods.hiddenLib.EMPTY_REGISTER, fromStep = { costs: 700000, extra: 10000, taxPct: 6 }) => {
  const risks = mods.risksLib.contractRisks(
    contractDocs(
      '7.3. Исполнитель обязан уплатить Заказчику пеню в размере 0,1% от цены Договора за каждый день просрочки.',
      '3.6. Оплата производится Заказчиком в течение 30 дней с даты акта.',
      '10.1. Договор заключается после предоставления Исполнителем обеспечения исполнения Договора в размере 5 % от цены.',
      '2.1. Цена Договора является твёрдой и определяется на весь срок исполнения Договора.',
    ),
  );
  const estimate = mods.estLib.estimateRisks({ price: 1_000_000, risks, type: 'goods', region: null, assumptions: mods.estLib.DEFAULT_ASSUMPTIONS });
  const result = mods.econLib.economics({ calc: { ...ECON_CALC, ...calcOver }, estimate, settings: mods.econLib.DEFAULT_ECON, price: null });
  return renderToStaticMarkup(
    h(mods.econUi.Economics, { result, nmck: calcOver.nmck === undefined ? 1_000_000 : calcOver.nmck, priceNote: 'цене вашей заявки', fromStep, targetMarginPct: 10, data: register, onChange: none }),
  );
};

test('какую цену ставить: метка «Оценка», целевая цена с маржой 10 %, три цены, прибыль по трём сценариям, снижение цены и «как посчитано» свёрнуты', () => {
  const out = text(econUi());
  assert.match(out, /Какую цену ставить/);
  assert.match(out, /Оценка/);
  assert.match(out, /Ставьте не ниже 8\d\d \d{3},\d{2} ₽ \(12,\d % от начальной\): маржа 10,0 % в базовом сценарии/);
  assert.match(out, /Чтобы выдержать стресс — не ниже 8\d\d \d{3},\d{2} ₽/);
  assert.match(out, /Не ниже\s+7\d\d \d{3},\d{2} ₽/);
  assert.match(out, /Безопасная\s+8\d\d \d{3},\d{2} ₽/);
  assert.match(out, /Целевая\s+8\d\d \d{3},\d{2} ₽/);
  assert.match(out, /Прибыль по сценариям при цене вашей заявки 1 000 000,00 ₽/);
  assert.match(out, /Оптимистичный Базовый Стрессовый/);
  assert.match(out, /251 993,15 ₽ маржа 25,2 %/);
  assert.match(out, /196 993,15 ₽ маржа 19,7 %/);
  assert.match(out, /96 993,15 ₽ маржа 9,7 %/);
  assert.match(out, /Снижение цены: что будет с прибылью/);
  assert.match(out, /Как посчитано/);
  assert.match(out, /Налог с выручки: 60 000,00 ₽/);
  assert.match(out, /Проценты за деньги до оплаты: 11 506,85 ₽/);
  assert.match(out, /плюс неустойка: Просрочка: пеня 0,1 % в день/);
  assert.ok(econUi().includes('placeholder="из шага «Цена»: 700 000"'), 'затраты из шага «Цена» подсказаны в поле');
});

test('какую цену ставить: затрат нет — просьба их ввести без выдуманных цифр; начальной цены нет — так и сказано; убыток даже по начальной — «участвовать не стоит»', () => {
  const none = text(econUi({ costs: null }, mods.hiddenLib.EMPTY_REGISTER, { costs: null, extra: null, taxPct: null }));
  assert.match(none, /Впишите затраты на исполнение — здесь или на шаге «Цена»/);
  assert.equal(/Ставьте не ниже/.test(none), false);
  assert.match(text(econUi({ nmck: null })), /Начальной цены в документах нет/);
  const loss = text(econUi({ costs: 950_000 }));
  assert.match(loss, /Даже по начальной цене \(1 000 000,00 ₽\) контракт убыточный/);
  assert.match(loss, /Участвовать не стоит/);
  assert.match(loss, /не достижима/);
});

test('какую цену ставить: цена выше целевой маржи недостижима — прямо сказано, ниже какой цены убыток', () => {
  const out = text(econUi({ costs: 840_000 }));
  assert.match(out, /Целевая маржа 10,0 % недостижима даже по начальной цене/);
  assert.match(out, /Ниже \d{3} \d{3},\d{2} ₽ — убыток/);
});

test('метки достоверности: подтверждено, по вашим данным, гипотеза, не проверено — у каждой своё слово', () => {
  for (const [kind, label] of [['confirmed', 'Подтверждено'], ['own', 'По вашим данным'], ['hypothesis', 'Гипотеза'], ['unchecked', 'Не проверено']]) {
    assert.match(text(renderToStaticMarkup(h(mods.cert.CertaintyBadge, { kind }))), new RegExp(label));
  }
});

test('чужой текст в названии и источнике остаётся текстом, а не разметкой страницы', () => {
  const d = data([{ id: 'p1', name: '<img src=x onerror=alert(1)>', unit: 'шт', qty: '1', analogs: [analog('a1', '1', { source: '<script>x</script>' })] }]);
  const out = panel(d, null);
  assert.equal(out.includes('<img src=x'), false);
  assert.equal(out.includes('<script>x'), false);
});

const summaryOf = (level, over = {}) => ({
  verdict: { level, label: { go: 'Участвовать можно', careful: 'Участвовать осторожно', stop: 'Участвовать не стоит', unknown: 'Мало данных для решения' }[level], reasons: ['Первая причина.', 'Вторая причина.'] },
  text: 'Поставка угля. Начальная цена 1 000 000 ₽.',
  facts: [{ label: 'Начальная цена', value: '1 000 000 ₽' }],
  recommendations: ['Заложите запас по срокам.', 'Запросите цену экспертизы.'],
  sections: [],
  ...over,
});
const summaryUi = (summary, over = {}) =>
  renderToStaticMarkup(h(mods.sumUi.AnalyticsSummary, { summary, busy: null, error: null, onWord: none, onPdf: none, ...over }));

test('раскрывашка: закрытая показывает название и строку итога, кнопка знает про состояние, содержимое остаётся в разметке скрытым', () => {
  const render = (open) => renderToStaticMarkup(h(mods.collapsible.Collapsible, { title: 'Риски и расходы из договора', brief: '3 условия, внимания требуют 1', open, onToggle: none }, h('p', null, 'Подробности')));
  const closed = render(false);
  assert.match(text(closed), /Риски и расходы из договора 3 условия, внимания требуют 1/);
  assert.match(closed, /aria-expanded="false"/);
  assert.match(closed, /<div id="[^"]+" hidden=""/);
  assert.match(closed, /Подробности/);
  const opened = render(true);
  assert.match(opened, /aria-expanded="true"/);
  assert.equal(/ hidden=""/.test(opened), false);
});

test('резюме: итог светофором с причинами, метка «Оценка», цифры и обе кнопки отчёта', () => {
  const out = summaryUi(summaryOf('careful'));
  const t = text(out);
  assert.match(t, /Участвовать осторожно/);
  assert.match(t, /Первая причина\. Вторая причина\./);
  assert.match(t, /Оценка/);
  assert.match(t, /Начальная цена 1 000 000 ₽/);
  assert.equal(t.includes('Резюме'), false, 'абзац резюме — только в отчёте: на экране причины и цифры');
  assert.match(t, /Скачать Word[\s\S]*Скачать PDF/);
});

test('резюме: рекомендации свёрнуты, в заголовке их число; нет рекомендаций — плашки нет', () => {
  const out = summaryUi(summaryOf('go'));
  assert.match(text(out), /Рекомендации \(2\)/);
  assert.match(out, /aria-expanded="false"/);
  assert.equal(text(summaryUi(summaryOf('go', { recommendations: [] }))).includes('Рекомендации'), false);
});

test('резюме: четыре итога — у каждого свои слова; «мало данных» может предложить действие', () => {
  for (const [level, label] of [['go', 'Участвовать можно'], ['careful', 'Участвовать осторожно'], ['stop', 'Участвовать не стоит'], ['unknown', 'Мало данных для решения']]) {
    assert.match(text(summaryUi(summaryOf(level))), new RegExp(label));
  }
  assert.match(text(summaryUi(summaryOf('unknown'), { action: { label: 'Ввести затраты', onClick: none } })), /Ввести затраты/);
  assert.equal(text(summaryUi(summaryOf('unknown'))).includes('Ввести затраты'), false);
});

test('резюме: кнопки отчёта блокируются, пока файл готовится; ошибка показана как предупреждение; светофор не называет себя вероятностью', () => {
  const busy = summaryUi(summaryOf('go'), { busy: 'word' });
  assert.match(text(busy), /Готовлю файл…/);
  assert.equal((busy.match(/disabled=""/g) ?? []).length, 2);
  const err = summaryUi(summaryOf('go'), { error: 'Не удалось собрать файл Word. Нет памяти.' });
  assert.match(err, /role="alert"[^>]*>Не удалось собрать файл Word\. Нет памяти\./);
  // Подсказка прямо говорит, что это не вероятность победы; вне подсказки ни процентов победы, ни «шансов» нет.
  assert.match(text(summaryUi(summaryOf('go'))), /не балл и не вероятность победы/);
  assert.equal(/\d\s*%\s*побед|шанс/.test(text(summaryUi(summaryOf('go')))), false);
});

const chartUi = (calcOver = {}, lines = [], price = null, ric = null) => {
  const risks = mods.risksLib.contractRisks(
    contractDocs(
      '7.3. Исполнитель обязан уплатить Заказчику пеню в размере 0,1% от цены Договора за каждый день просрочки.',
      '3.6. Оплата производится Заказчиком в течение 30 дней с даты акта.',
      '10.1. Договор заключается после предоставления Исполнителем обеспечения исполнения Договора в размере 5 % от цены.',
      '2.1. Цена Договора является твёрдой и определяется на весь срок исполнения Договора.',
      '5.12. Расходы на экспертизу несёт Исполнитель, за исключением случаев, когда экспертизой установлено отсутствие нарушений.',
      ...lines,
    ),
  );
  const estimate = mods.estLib.estimateRisks({ price: 1_000_000, risks, type: 'goods', region: null, assumptions: mods.estLib.DEFAULT_ASSUMPTIONS });
  const econ = mods.econLib.economics({ calc: { ...ECON_CALC, ...calcOver }, estimate, settings: mods.econLib.DEFAULT_ECON, price });
  return renderToStaticMarkup(h(mods.chartUi.AnalyticsChart, { econ, estimate, ric }));
};

test('диаграмма: метка «Оценка», проценты в карточках, из чего складывается цена с суммами и долями, риски полосками, график прибыли, «процент победы» не показан', () => {
  const out = chartUi();
  const t = text(out);
  assert.match(t, /Оценка/);
  assert.match(t, /Рентабельность \d+,\d %/);
  assert.match(t, /Снижение от начальной цены 0,0 %/);
  assert.match(t, /Риски к цене до \d+,\d %/);
  assert.match(t, /Из чего складывается цена 1 000 000 ₽/);
  for (const part of ['Ваши затраты', 'Налог и обеспечение', 'Риски по договору', 'Прибыль']) assert.ok(t.includes(part), part);
  assert.match(t, /Риски в процентах от цены/);
  assert.match(t, /Прибыль при снижении цены/);
  assert.match(t, /Процент победы не показываем/);
  assert.match(t, /скоро/);
  assert.equal(/\d\s*%\s*побед|шанс[а-я]* на победу: \d/.test(t), false);
});

test('диаграмма: полоса цены — картинка с описанием, три сценария переключаются кнопками, у каждого сегмента подсказка и подпись в списке', () => {
  const out = chartUi();
  assert.match(out, /role="radiogroup"[^>]*aria-label="Сценарий"/);
  assert.equal((out.match(/role="radio"/g) ?? []).length, 3);
  assert.match(out, /aria-checked="true"[^>]*title="Базовый"/);
  assert.match(out, /role="img" aria-label="Базовый сценарий: Ваши затраты \d+,\d\s%, Налог и обеспечение \d+,\d\s%, Риски по договору \d+,\d\s%, Прибыль \d+,\d\s%"/);
  assert.match(out, /title="Ваши затраты: [^"]+\s₽\s·\s\d+,\d\s%"/);
  // Без убытка полоса и есть цена: отдельной метки «цена заявки» на ней нет (она только на графике).
  assert.equal(/<span[^>]*>цена заявки<\/span>/.test(out), false);
});

test('диаграмма: при убытке полоса длиннее цены — метка «цена заявки», строка «Убыток», прибыльной части нет', () => {
  const t = text(chartUi({ costs: 950_000 }));
  assert.match(t, /Убыток Затраты, налог и риски сверх цены заявки/);
  const out = chartUi({ costs: 950_000 });
  assert.match(out, />цена заявки<\/span>/);
  assert.equal(/aria-label="Базовый сценарий:[^"]*Прибыль \d/.test(out), false);
  assert.match(out, /aria-label="Базовый сценарий:[^"]*; убыток \d+,\d\s%\sцены"/);
});

test('диаграмма: затрат нет — просьба их ввести без выдуманных цифр, графика прибыли и процентов рентабельности нет, а риски от договора остаются', () => {
  const out = chartUi({ costs: null });
  const t = text(out);
  assert.match(t, /Впишите затраты на исполнение — покажу, из чего складывается цена/);
  assert.equal(t.includes('Прибыль при снижении цены'), false);
  assert.equal(t.includes('Рентабельность'), false);
  assert.match(t, /Риски к цене до \d+,\d %/);
  assert.match(t, /Риски в процентах от цены/);
  assert.match(t, /Штраф|Просрочка/);
});

test('диаграмма: нет начальной цены — так и сказано', () => {
  assert.match(text(chartUi({ nmck: null })), /Начальной цены в документах нет — раскладывать нечего/);
});

test('диаграмма: график — две линии с метками в легенде, таблица значений под графиком, значения не только в подсказке', () => {
  const out = chartUi();
  const t = text(out);
  assert.match(out, /role="group"[^>]*aria-label="График прибыли при снижении цены/);
  assert.match(out, /tabindex="0"/);
  assert.match(t, /Базовый сценарий Стрессовый сценарий/);
  assert.match(out, /<path d="M[^"]+" fill="none" stroke="var\(--viz-1\)" stroke-width="2"/);
  assert.match(out, /<path d="M[^"]+" fill="none" stroke="var\(--viz-2\)" stroke-width="2"/);
  assert.match(out, /<details[^>]*>\s*<summary[^>]*>Таблица значений<\/summary>/);
  assert.equal((out.match(/<tr>/g) ?? []).length, 7);
  assert.match(t, /Не ниже [\d ]+ ₽ \(на \d+,\d % ниже начальной\)/);
});

test('диаграмма: чужой текст из договора остаётся текстом', () => {
  const t = chartUi({}, ['9.9. Исполнитель оплачивает <img src=x onerror=alert(1)> за свой счёт в размере 5 % от цены Договора.']);
  assert.equal(t.includes('<img src=x'), false);
});

const withSearch = { searchContext: { year: 2026, place: 'Севастополь' }, onSearch: async () => null };
const RECORD = {
  query: 'тарифы на доставку грузов Севастополь 2026',
  at: '2026-10-21T10:00:00.000Z',
  provider: 'DuckDuckGo (пробный бесплатный поиск)',
  hits: [
    { title: 'Изменение стоимости грузоперевозок в г. Симферополь и г. Севастополь', url: 'https://kuban-kargo.ru/x/', domain: 'kuban-kargo.ru', snippet: 'С 09 июня 2026 года стоимость перевозки рассчитывается индивидуально' },
    { title: 'Опасная', url: 'javascript:alert(1)', domain: '', snippet: '' },
  ],
};

test('проверка поиском: у гипотез, которые можно проверить в интернете, кнопка и точный запрос — что именно уходит в поиск; число таких гипотез в заголовке', () => {
  const out = estimateUi(mods.hiddenLib.EMPTY_REGISTER, 1_000_000, withSearch);
  const t = text(out);
  assert.match(t, /Ещё риски для такой закупки без оценки: \d+ · можно проверить поиском: \d+/);
  assert.match(t, /Проверить поиском/);
  assert.match(t, /В поиск уходит только: «тарифы на доставку грузов Севастополь 2026»/);
  assert.equal(t.includes('обычным бесплатным поиском: найденное не проверено'), false, 'общее пояснение убрано: у каждой кнопки видно, что уходит в поиск');
  // Гипотеза, которую интернетом не проверить, кнопки не получает: кнопок меньше, чем гипотез.
  const buttons = (out.match(/Проверить поиском<\/button>|Проверить поиском(?=<\/button>)/g) ?? []).length;
  assert.ok(buttons >= 1 && buttons < (out.match(/<li class="break-words">/g) ?? []).length);
  // Данных компании в запросе нет.
  assert.equal(/Екатеринбург/.test(t.split('В поиск уходит только')[1] ?? ''), false);
});

test('проверка поиском: без настройки поиска (нет места для запроса) кнопок нет, как раньше', () => {
  const t = text(estimateUi(mods.hiddenLib.EMPTY_REGISTER));
  assert.equal(t.includes('Проверить поиском'), false);
  assert.equal(t.includes('можно проверить поиском'), false);
});

test('проверка поиском: найденное — со ссылками в новой вкладке, меткой «Не проверено», датой и сайтом; опасная ссылка не становится ссылкой; можно открыть тот же запрос в Яндексе', () => {
  const register = { ...mods.hiddenLib.EMPTY_REGISTER, searches: { logistics: RECORD } };
  const out = estimateUi(register, 1_000_000, withSearch);
  const t = text(out);
  assert.match(t, /Не проверено/);
  assert.match(t, /DuckDuckGo \(пробный бесплатный поиск\), 21\.10\.2026/);
  assert.match(t, /Страницы программа не читает и чисел из них не берёт/);
  assert.match(out, /<a href="https:\/\/kuban-kargo\.ru\/x\/" target="_blank" rel="noopener noreferrer"/);
  assert.match(t, /kuban-kargo\.ru С 09 июня 2026 года стоимость перевозки рассчитывается индивидуально/);
  assert.equal(out.includes('href="javascript:'), false);
  assert.match(t, /Искать заново/);
  assert.match(out, /href="https:\/\/yandex\.ru\/search\/\?text=%D1%82%D0%B0%D1%80%D0%B8%D1%84%D1%8B/);
});

test('проверка поиском: чужой текст из выдачи остаётся текстом, а не разметкой', () => {
  const evil = { ...RECORD, hits: [{ title: '<img src=x onerror=alert(1)>', url: 'https://a.ru/', domain: 'a.ru', snippet: '<script>x</script>' }] };
  const out = estimateUi({ ...mods.hiddenLib.EMPTY_REGISTER, searches: { logistics: evil } }, 1_000_000, withSearch);
  assert.equal(out.includes('<img src=x'), false);
  assert.equal(out.includes('<script>x'), false);
});

const COAL = {
  positions: [{ id: '1', name: 'Уголь', unit: 'т', qty: '100', analogs: ['9000', '9500', '10000', '9800', '9700'].map((p, i) => analog(`c${i}`, p)) }],
  // Настройки берутся из модуля, который грузится в before(): поэтому читаются при обращении, а не при разборе файла.
  get settings() {
    return { ...mods.lib.DEFAULT_SETTINGS, nmckVat: 'without' };
  },
};
const scenarioUi = (data = COAL, subject = 'Поставка угля марки ДПК', type = 'goods') => {
  const result = mods.lib.computeRic(data, 1_000_000, NOW);
  return renderToStaticMarkup(h(mods.scenUi.RicScenarioPanel, { data, result, subject, type, onChange: none }));
};

test('сфера РИЦ: по предмету определена сфера, указано метод, роль и почему; метка «на проверку юристу»; цифры без поправок', () => {
  const out = scenarioUi();
  const t = text(out);
  assert.match(t, /Как считается РИЦ для вашей сферы/);
  assert.match(t, /Методика — на проверку юристу/);
  assert.match(t, /Определена по предмету закупки: Топливо и энергоресурсы/);
  assert.match(t, /основной Сопоставимых рыночных цен \(анализ рынка\)\./);
  assert.match(t, /основной Тарифный\./);
  assert.match(t, /Цены на топливо быстро устаревают/);
  assert.match(t, /РИЦ по методу[^]*960 000,00 ₽/);
  assert.match(t, /РИЦ с поправками[^]*960 000,00 ₽[^]*Поправок учтено: 0/);
  assert.match(t, /Начальная цена заказчика выше РИЦ с поправками на 40 000,00 ₽ \(4,2 %\)/);
});

test('сфера РИЦ: выбор сферы — девять вариантов и «определить по предмету»; выбранная вами главнее', () => {
  const auto = scenarioUi();
  assert.equal((auto.match(/<option /g) ?? []).length, 10);
  assert.match(auto, /<option value="" selected="">Определить по предмету/);
  const picked = scenarioUi({ ...COAL, scenario: 'construction' });
  assert.match(picked, /<option value="construction" selected="">Строительство, ремонт, капремонт/);
  const t = text(picked);
  assert.match(t, /Выбрана вами: Строительство, ремонт, капремонт/);
  assert.match(t, /основной Проектно-сметный\./);
  assert.match(t, /Цены-аналоги не заменяют смету/);
});

test('сфера РИЦ: ИТ, логистика, стройка и питание показывают своё — метод, поправки, риски; у каждой сферы не чужое', () => {
  const it = text(scenarioUi(COAL, 'Разработка программного обеспечения для портала', 'it'));
  assert.match(it, /Определена по предмету закупки: ИТ: разработка и сопровождение ПО, лицензии/);
  assert.match(it, /основной Затратный\./);
  assert.match(it, /Резерв на неопределённость требований/);
  assert.match(it, /Недооценка трудозатрат/);
  assert.equal(it.includes('Топливная надбавка'), false);
  const logistics = text(scenarioUi(COAL, 'Оказание услуг по перевозке грузов', 'services'));
  assert.match(logistics, /Определена по предмету закупки: Перевозки и доставка/);
  assert.match(logistics, /Порожний пробег и обратный рейс/);
  assert.match(logistics, /Удалённый или труднодоступный регион/);
  assert.match(logistics, /проверка Затратный\./);
  const build = text(scenarioUi(COAL, 'Капитальный ремонт балконов', 'works'));
  assert.match(build, /Зимнее удорожание/);
  assert.match(build, /Неучтённые объёмы/);
  const food = text(scenarioUi(COAL, 'Организация питания обучающихся', 'food'));
  assert.match(food, /Потери при обработке и выход готового блюда/);
  assert.match(food, /Фактическое число порций/);
});

test('сфера РИЦ: опора — что в документах, что вводите вы, чего нет в программе; ссылки на закон с пометкой «сверьте»; для каждой строки поправки и риска поля числа и основания', () => {
  const out = scenarioUi(COAL, 'Капитальный ремонт балконов', 'works');
  const t = text(out);
  assert.match(t, /В документах закупки/);
  assert.match(t, /Вводите вы/);
  assert.match(t, /Внешний источник — не подключён/);
  assert.match(t, /Сметные нормативы и индексы пересчёта в текущие цены по региону/);
  assert.match(t, /ч\. 9–9\.1 ст\. 22 44-ФЗ/);
  assert.match(t, /сверьте с текстом закона/);
  const scenario = mods.scenLib.scenarioById('construction');
  const fields = (out.match(/aria-label="[^"]+: значение"/g) ?? []).length;
  assert.equal(fields, scenario.adjustments.length + scenario.risks.length);
  assert.equal((out.match(/aria-label="[^"]+: основание"/g) ?? []).length, fields);
});

test('сфера РИЦ: поправка с основанием меняет РИЦ и показывает вклад, без основания — предупреждение и в расчёт не идёт; резерв на риск — отдельной цифрой', () => {
  const data = {
    ...COAL,
    adjustments: [
      { id: 'delivery', value: '20000', basis: 'КП перевозчика' },
      { id: 'quality', value: '5', basis: '' },
      { id: 'risk-price', value: '3', basis: 'рост цен за последние месяцы' },
    ],
  };
  const t = text(scenarioUi(data));
  assert.match(t, /РИЦ с поправками[^]*980 000,00 ₽[^]*Поправок учтено: 1/);
  assert.match(t, /Вклад в расчёт: \+20 000,00 ₽/);
  assert.match(t, /Нет основания — укажите, откуда число; без него оно в расчёт не идёт/);
  assert.match(t, /С учётом отраслевых рисков[^]*1 009 400,00 ₽[^]*Резерв: 29 400,00 ₽\. Для вашего расчёта цены, не рыночный ориентир/);
  assert.match(t, /Вклад в расчёт: \+29 400,00 ₽/);
});

test('сфера РИЦ: цен-аналогов нет — цифр нет, сказано, что нужно; ничего не выдумывается', () => {
  const t = text(scenarioUi({ positions: [], settings: COAL.settings }));
  assert.match(t, /РИЦ по методу[^—]{0,200}—/);  assert.match(t, /Появится, когда цены есть по всем позициям/);
  assert.match(t, /Позиции закупки не добавлены/);
  assert.equal(/Начальная цена заказчика (выше|ниже)/.test(t), false);
});

test('сфера РИЦ: своя поправка — название, единица, основание; чужой текст остаётся текстом', () => {
  const data = { ...COAL, adjustments: [{ id: 'custom-1', label: '<img src=x onerror=alert(1)>', unit: 'rub', value: '7500', basis: 'полис' }] };
  const out = scenarioUi(data);
  assert.equal(out.includes('<img src=x'), false);
  assert.match(text(out), /Вклад в расчёт: \+7 500,00 ₽/);
  assert.match(out, /aria-label="Название поправки"/);
  assert.match(text(out), /Добавить свою поправку/);
});

const EIS_TABLE = [
  'Реестровый номер контракта	Предмет контракта	Дата заключения	Цена за единицу, руб.	Количество	Цена контракта',
  '1660100000126000012	Уголь каменный ДПК	15.09.2026	9 850,00	120	1 182 000,00',
  '1660100000126000034	Уголь каменный ДПК	02.10.2026	10 120,50	80	809 640,00',
].join('\n');
const importForm = (initialText = '', positionName = 'Уголь каменный ДПК') =>
  renderToStaticMarkup(h(mods.importUi.AnalogImportForm, { positionName, defaultVat: 'without', makeId: () => 'x', onImport: none, onCancel: none, initialText }));

test('загрузка цен: пустое окно — как вставить, ссылки на поиск в ЕИС (в новой вкладке, по названию позиции), кнопка добавить недоступна', () => {
  const out = importForm();
  const t = text(out);
  assert.match(t, /Вставьте таблицу с ценами или карточку контракта ЕИС/);
  assert.match(t, /В ЕИС она не ходит — ссылки открываются в вашем браузере/);
  assert.match(out, /<a href="https:\/\/zakupki\.gov\.ru\/epz\/contract\/search\/results\.html\?searchString=%D0%A3%D0%B3%D0%BE%D0%BB%D1%8C[^"]*" target="_blank" rel="noopener noreferrer"/);
  assert.match(out, /contractfz223\/search\/results\.html/);
  assert.match(t, /Найти в реестре контрактов ЕИС \(44-ФЗ\)/);
  assert.match(t, /Найти в реестре договоров ЕИС \(223-ФЗ\)/);
  assert.match(out, /aria-label="Таблица с ценами"/);
  assert.match(out, /type="file"[^>]*accept="\.csv,\.tsv,\.txt/);
  assert.match(out, /<button[^>]*disabled=""[^>]*>Нет цен для добавления<\/button>/);
  assert.equal(t.includes('Найдено цен'), false);
});

test('загрузка цен: вставили таблицу ЕИС — столбцы найдены, цены с источником «ЕИС, контракт №» и датой, галочки стоят, кнопка добавляет все', () => {
  const out = importForm(EIS_TABLE);
  const t = text(out);
  assert.match(t, /Найдено цен: 2/);
  assert.match(t, /9850 ₽ · 15\.09\.2026 · ЕИС, контракт № 1660100000126000012/);
  assert.match(t, /10120,5 ₽ · 02\.10\.2026 · ЕИС, контракт № 1660100000126000034/);
  assert.match(out, /Добавить цену из строки 2" checked/);
  assert.match(out, /Добавить цену из строки 3" checked/);
  assert.match(t, /Добавить цен: 2/);
  assert.match(out, /aria-label="Столбец 1: что это"[^>]*>(?:<option[^>]*>[^<]*<\/option>)*<\/select>/);
  // Выбранные значения в списках столбцов (выбор НДС — отдельный список).
  const selected = [...out.matchAll(/<option value="([a-z]+)" selected="">/g)].map((m) => m[1]).filter((v) => v !== 'with' && v !== 'without');
  assert.deepEqual(selected, ['source', 'name', 'date', 'price', 'qty', 'total']);
  assert.match(out, /<input type="checkbox" checked=""\/?>\s*Первая строка — заголовки/);
  assert.match(out, /<option value="without" selected="">без НДС/);
});

test('загрузка цен: нет даты — предупреждение и подсказка; строки без цены пропущены с причиной, не молча', () => {
  const rows = ['Наименование	Цена	Дата', 'Уголь	9850	', 'Уголь	договорная	15.09.2026'].join('\n');
  const t = text(importForm(rows));
  assert.match(t, /Найдено цен: 1 · пропущено строк: 1/);
  assert.match(t, /9850 ₽ · без даты · таблица, строка 2/);
  assert.match(t, /нет даты — впишите её после добавления/);
  assert.match(t, /Почему строки пропущены/);
  assert.match(t, /Строка 3: цена не число/);
  assert.match(t, /Без даты цена в расчёт не идёт/);
});

const EIS_CARD = [
  '№ 3224400384226000002 (Версия № 0 от 07.05.2026, действующая версия)',
  '№ 3224400384226000002',
  'Исполнение',
  'Заказчик',
  'МКОУ "ХМЕЛЕВСКАЯ СРЕДНЯЯ ОБЩЕОБРАЗОВАТЕЛЬНАЯ ШКОЛА"',
  'Контракт',
  '№ 0817200000326005082',
  'Цена контракта',
  '756 493,20 ₽',
  'Заключение контракта',
  '07.05.2026',
  'Объекты закупки',
  '\tНАИМЕНОВАНИЕ ОБЪЕКТА ЗАКУПКИ И ЕГО ХАРАКТЕРИСТИКИ\tПОЗИЦИИ ПО КТРУ, ОКПД2\tТИП ОБЪЕКТА ЗАКУПКИ\tКОЛИЧЕСТВО ТОВАРА, ОБЪЕМ РАБОТЫ, УСЛУГИ,',
  'ЕДИНИЦА ИЗМЕРЕНИЯ\tЦЕНА ЗА ЕДИНИЦУ ИЗМЕРЕНИЯ, ₽\tСУММА, ₽',
  '1. Уголь. Товарный знак: отсутствует',
  'Класс (по размеру кусков) Рядовой (Р) , Марка Длиннопламенный (Д) , Обогащение Нет ...',
  '\tУголь',
  '(05.10.1)\tТовар\t',
  '102 Т ',
  '\t3 609,60\t368 179,20',
  'Ставка НДС: Без НДС',
  '2. Уголь. Товарный знак: отсутствует',
  'Обогащение Нет , Марка Длиннопламенный (Д) , Класс (по размеру кусков) Крупный (К) ...',
  '\tУголь',
  '(05.10.1)\tТовар\t',
  '90 Т ',
  '\t4 314,60\t388 314,00',
  'Ставка НДС: 22%',
  'Итого (2 записи):\t756 493,20',
  'Платежные реквизиты',
].join('\n');
const EIS_LIST = [
  'Результаты поиска',
  '№ 1170100931726000010',
  'Исполнение',
  'Заказчик',
  'ПРОКУРАТУРА РЕСПУБЛИКИ ТЫВА',
  'Контракт',
  '№ 9',
  'Объекты закупки',
  'Уголь. Товарный знак: отсутствует',
  'Цена контракта',
  '1 300 819,25 ₽',
  'Заключение контракта',
  '31.03.2026',
  '№ 1253900763426000010',
  'Исполнение завершено',
  'Заказчик',
  'ФИЛИАЛ ФГБУН "ГОРНОТАЕЖНАЯ СТАНЦИЯ"',
  'Контракт',
  '№ 0320400001126000003',
  'Объекты закупки',
  'Уголь. Товарный знак: отсутствует',
  'Цена контракта',
  '2 186 800,00 ₽',
  'Заключение контракта',
  '15.09.2026',
].join('\n');

test('загрузка цен: вставили карточку контракта ЕИС — цена за единицу, количество, дата заключения и НДС берутся из карточки, таблица столбцов не нужна', () => {
  const out = importForm(EIS_CARD);
  const t = text(out);
  assert.match(t, /Карточек ЕИС: 1 · Найдено цен: 2/);
  assert.match(t, /3609,6 ₽ · 07\.05\.2026 · ЕИС, контракт № 3224400384226000002/);
  assert.match(t, /4314,6 ₽ · 07\.05\.2026 · ЕИС, контракт № 3224400384226000002/);
  assert.match(t, /102 Т · МКОУ &quot;ХМЕЛЕВСКАЯ СРЕДНЯЯ ОБЩЕОБРАЗОВАТЕЛЬНАЯ ШКОЛА&quot; · контракт № 0817200000326005082/);
  assert.match(t, /Рядовой \(Р\)/);
  assert.match(t, /Крупный \(К\)/);
  assert.match(out, /Добавить цену из строки 1" checked/);
  assert.match(t, /Добавить цен: 2/);
  // Столбцов нет, и выбор НДС не спрашивают: он назван в самой карточке.
  assert.equal(t.includes('Проверьте, что в каком столбце'), false);
  assert.equal(out.includes('aria-label="НДС в ценах таблицы"'), false);
});

test('загрузка цен: вставили список результатов ЕИС — это не цены: общая цена контракта и ссылки на карточки, добавить нечего', () => {
  const out = importForm(EIS_LIST);
  const t = text(out);
  assert.match(t, /В списке только общая цена контракта \(2\)/);
  assert.match(t, /цена за единицу — в карточке/);
  assert.match(out, /<a href="https:\/\/zakupki\.gov\.ru\/epz\/contract\/contractCard\/payment-info-and-target-of-order\.html\?reestrNumber=1170100931726000010" target="_blank" rel="noopener noreferrer"/);
  assert.match(t, /№ 1253900763426000010/);
  assert.match(t, /1 300 819,25 ₽/);
  assert.match(t, /ПРОКУРАТУРА РЕСПУБЛИКИ ТЫВА/);
  assert.equal(t.includes('Найдено цен'), false);
  assert.match(out, /<button[^>]*disabled=""[^>]*>Нет цен для добавления<\/button>/);
});

test('загрузка цен: чужой текст из таблицы остаётся текстом, а не разметкой', () => {
  const rows = ['Наименование	Цена	Дата	Источник', '<img src=x onerror=alert(1)>	100	01.10.2026	<script>x</script>'].join('\n');
  const out = importForm(rows);
  assert.equal(out.includes('<img src=x'), false);
  assert.equal(out.includes('<script>x'), false);
  assert.match(text(out), /&lt;img|<img src=x onerror=alert\(1\)>/);
});

test('загрузка цен: у каждой позиции РИЦ есть кнопка «Загрузить цены из таблицы»', () => {
  const d = data([
    { id: 'p1', name: 'Уголь', unit: 'т', qty: '100', analogs: [analog('a1', '100')] },
    { id: 'p2', name: 'Дрова', unit: 'м3', qty: '50', analogs: [] },
  ]);
  const t = text(panel(d, null));
  assert.equal((t.match(/Загрузить цены из таблицы/g) ?? []).length, 2);
  assert.match(t, /Добавить цену-аналог/);
});

const matrixRows = (over = {}) => {
  const docs = [{ name: 'Проект договора.docx', text: ['Договор поставки № 1', '7.3. Исполнитель обязан уплатить Заказчику пеню в размере 0,1% от цены Договора за каждый день просрочки.', '7.4. Исполнитель уплачивает Заказчику штраф в размере 30% от цены Договора за отказ от исполнения.', '3.6. Оплата производится Заказчиком в течение 30 дней с даты акта.', '10.1. Договор заключается после предоставления Исполнителем обеспечения исполнения Договора в размере 5 % от цены.'].join('\n') }];
  const risks = mods.risksLib.contractRisks(docs);
  const estimate = mods.estLib.estimateRisks({ price: 1_000_000, risks, type: 'goods', region: null, assumptions: mods.estLib.DEFAULT_ASSUMPTIONS });
  const econ = mods.econLib.economics({ calc: { ...ECON_CALC, costs: 600_000 }, estimate, settings: mods.econLib.DEFAULT_ECON, price: null });
  return mods.matrixLib.buildMatrix({ kind: 'Электронный аукцион · 44-ФЗ', docs, hasContract: true, risks, estimate, econ, badge: null, ric: null, nmck: 1_000_000, smeOnly: false, companySme: false, registry: null, evidence: null, ...over });
};
const matrixUi = (rows = matrixRows(), data = {}) =>
  renderToStaticMarkup(h(mods.matrixUi.CheckMatrix, { rows, summary: mods.matrixLib.summarize(rows), data, onChange: none }));

test('матрица: сверху «проверено N из 27» и кнопки-фильтры со счётчиками; карта из 27 клеток по четырём группам', () => {
  const rows = matrixRows();
  const s = mods.matrixLib.summarize(rows);
  const out = matrixUi(rows);
  const t = text(out);
  assert.ok(new RegExp('Проверено ' + (s.program + s.manual) + ' из 27 \\(\\d+,\\d %\\)').test(t));
  for (const chip of [`Все 27`, `Риск ${s.risk}`, `Внимание ${s.attention}`, `В порядке ${s.ok}`, `Нет данных ${s.insufficient}`, `Ждут источника ${s.notChecked}`]) assert.ok(t.includes(chip), chip);
  assert.equal((out.match(/aria-pressed=/g) ?? []).length, 6);
  assert.equal((out.match(/aria-label="Проверка \d+: [^"]+\. [^"]+"/g) ?? []).length, 27);
  for (const g of ['Конкуренция', 'Финансовые условия', 'Квалификация', 'Надёжность и договорные риски']) assert.ok(t.includes(g), g);
  assert.match(t, /Конкуренция · \d+ из 6/);
  assert.match(t, /Финансовые условия · \d+ из 7/);
  assert.match(t, /Квалификация · \d+ из 6/);
  assert.match(t, /Надёжность и договорные риски · \d+ из 8/);
});

test('матрица: у строк с вниманием и риском виден факт по этой закупке (пункт, цифра), у «ждёт источника» и «в порядке» лишнего текста нет', () => {
  const rows = matrixRows();
  const t = text(matrixUi(rows));
  assert.match(t, /11 Штрафы, пени и финансовые обязательства Крупная неустойка на вас: Штраф 30 %/);
  assert.match(t, /10 Сроки оплаты и аванс Оплата долгая: Оплата заказчиком в течение 30 дней/);
  assert.match(t, /9 Размер обеспечения исполнения контракта В порядке/);
  assert.match(t, /21 Судебные споры и договорные конфликты Ждёт источника/);
  assert.equal(t.includes('Пока нет источника в программе'), false, 'длинный текст про отсутствие источника на виду не нужен');
  assert.match(t, /8 Размер обеспечения заявки Нужно: размер обеспечения заявки/);
});

test('матрица: «смотреть первым» — до трёх проверок, сначала риск; у каждой номер, название и факт; пояснения «как проверяется» спрятаны', () => {
  const t = text(matrixUi());
  const first = t.split('Смотреть первым')[1].split('Конкуренция ·')[0];
  assert.match(first, /Риск 11\. Штрафы, пени и финансовые обязательства/);
  assert.ok((first.match(/\d+\. /g) ?? []).length <= 3 * 1 + 3, 'не больше трёх');
  assert.equal(t.includes('Как оценивается'), false);
  assert.equal(t.includes('Как проверяется'), false);
});

test('матрица: записанное вами — помечено «Вы», с вашим фактом; чужой текст остаётся текстом', () => {
  const rows = matrixRows({ manual: { 21: { level: 'attention', note: '<img src=x onerror=alert(1)> в КАД 3 дела об оплате', source: 'kad.arbitr.ru' } } });
  const out = matrixUi(rows);
  assert.equal(out.includes('<img src=x'), false);
  const t = text(out);
  const before = mods.matrixLib.summarize(matrixRows()).program;
  assert.ok(t.includes(`Проверено ${before + 1} из 27`), 'запись участника добавляет одну проверенную');
  assert.match(t, /21 Судебные споры и договорные конфликты .*в КАД 3 дела об оплате Вы: внимание/);
});

test('матрица: данных нет совсем — «проверено 0 из 27», у посчитанных «нет данных», у внешних «ждёт источника»; ни одной оценки', () => {
  const rows = matrixRows({ hasContract: false, risks: [], docs: [], kind: '', econ: { ready: false, reason: 'costs' }, nmck: null });
  const t = text(matrixUi(rows));
  assert.match(t, /Проверено 0 из 27 \(0,0 %\)/);
  assert.match(t, /Риск 0/);
  assert.match(t, /Внимание 0/);
  assert.match(t, /В порядке 0/);
  assert.equal(t.includes('Смотреть первым'), false);
});

// ——— Суммы по фактам: доставка и курс валюты ———
const USD_RATES = [
  ['2026-10-01', 83.5588], ['2026-10-02', 83.2454], ['2026-10-03', 83.4839], ['2026-10-06', 84.9309], ['2026-10-07', 85.7116],
  ['2026-10-08', 85.4811], ['2026-10-09', 85.4173], ['2026-10-10', 84.9048], ['2026-10-13', 83.9153], ['2026-10-14', 83.8675],
  ['2026-10-15', 83.9497], ['2026-10-16', 83.76], ['2026-10-17', 83.6177], ['2026-10-20', 82.8504], ['2026-10-21', 82.8879], ['2026-10-22', 81.9739],
];
const factUi = (to = 'Севастополь', from = 'Москва', delivery = {}, fx = {}) => {
  const register = { ...mods.hiddenLib.EMPTY_REGISTER, delivery: { ...mods.deliveryLib.EMPTY_DELIVERY, ...delivery }, fx: { ...mods.fxLib.EMPTY_FX, ...fx } };
  const d = mods.deliveryLib.deliveryCost(from, to, register.delivery);
  const f = mods.fxLib.fxRisk(register.fx);
  return renderToStaticMarkup(h(mods.factUi.FactCosts, { data: register, delivery: d, fx: f, onChange: none, onLoadFx: async () => null }));
};

test('свои цифры: доставка — расстояние между центрами регионов, выбор «перевозчик / своя машина», пока нет тарифа — что вписать; блок раскрыт', () => {
  const out = factUi();
  const t = text(out);
  assert.match(out, /<details class="text-\[12px\]" open="">/);
  assert.match(t, /Свои цифры: доставка и курс валюты/);
  assert.match(t, /Доставка: Москва → Севастополь ≈ 1 652 км/);
  assert.match(t, /Дорога длиннее прямой в/);
  assert.match(out, /aria-pressed="true"[^>]*>Перевозчик</);
  assert.match(out, /aria-pressed="false"[^>]*>Своя машина</);
  assert.match(out, /aria-pressed="true"[^>]*>Туда и обратно</);
  assert.match(t, /Тариф, ₽ за км/);
  assert.match(t, /Впишите: тариф перевозчика, ₽ за км\./);
  assert.equal(t.includes('Расход, л на 100 км'), false);
});

test('свои цифры: доставка с тарифом — сумма и формула под полями; своя машина — расход и цена литра вместо тарифа', () => {
  const t = text(factUi('Севастополь', 'Москва', { rate: '60', trips: '2' }));
  assert.match(t, /= 396 480,00 ₽ · 1 652 км × 2 \(туда и обратно\) × 60 ₽\/км × 2 рейс\./);
  const own = factUi('Севастополь', 'Москва', { mode: 'own', consumption: '30', fuel: '65', trips: '1' });
  assert.match(text(own), /Расход, л на 100 км/);
  assert.match(text(own), /Литр топлива, ₽/);
  assert.match(text(own), /только топливо/);
  assert.equal(text(own).includes('Тариф, ₽ за км'), false);
});

test('свои цифры: доставка в регион без полноценной дороги — предупреждение и просьба запросить маршрут, полей тарифа нет', () => {
  const t = text(factUi('Камчатский край'));
  assert.match(t, /Доставка: Москва → Петропавловск-Камчатский/);
  assert.match(t, /Сухопутная дорога неполная или сезонная/);
  assert.match(t, /Запросите маршрут и тариф у перевозчика/);
  assert.equal(t.includes('Тариф, ₽ за км'), false);
});

test('свои цифры: курс — валюты кнопками, поле суммы, загрузка курса ЦБ; без курса сказано, что и откуда уходит', () => {
  const out = factUi(null, null);
  const t = text(out);
  assert.match(t, /Свои цифры: курс валюты/, 'доставки нет: регионы не определены');
  assert.equal(t.includes('Доставка:'), false);
  assert.match(out, /aria-pressed="true"[^>]*>Доллар США</);
  assert.match(out, /aria-pressed="false"[^>]*>Евро</);
  assert.match(out, /aria-pressed="false"[^>]*>Юань</);
  assert.match(t, /Закупаете, \$/);
  assert.match(t, /Загрузить курс ЦБ/);
  assert.match(t, /Курс загружается с сайта Банка России; уходит только выбранная валюта\./);
  assert.equal(/<details[^>]*open=""/.test(out), false, 'нечего вписывать — блок закрыт');
});

test('свои цифры: курс загружен — курс на последнюю дату и наибольший рост за срок с датами из ряда ЦБ; сумму ещё надо вписать', () => {
  const out = factUi(null, null, {}, { series: USD_RATES, windowDays: '5' });
  const t = text(out);
  assert.match(t, /ЦБ на 22\.10\.2026: 81,9739 ₽/);
  assert.match(t, /за год за 5 дн\. курс вырастал до \+3,0 % \(с 02\.10\.2026 по 07\.10\.2026\)/);
  assert.match(t, /Обновить курс ЦБ/);
  assert.match(t, /Впишите: сумму в валюте\./);
  assert.match(out, /<details class="text-\[12px\]" open="">/, 'нужно вписать сумму — блок раскрыт');
  const full = text(factUi(null, null, {}, { series: USD_RATES, windowDays: '5', amount: '10000' }));
  assert.equal(full.includes('Впишите:'), false);
});

test('сколько это может стоить: с цифрами доставка и курс — суммы со словами «центры регионов» и «курсы ЦБ», общая строка «сумма не определена» исчезает, итог растёт', () => {
  const register = {
    ...mods.hiddenLib.EMPTY_REGISTER,
    delivery: { ...mods.deliveryLib.EMPTY_DELIVERY, rate: '60', trips: '2', usualKm: '200' },
    fx: { ...mods.fxLib.EMPTY_FX, series: USD_RATES, windowDays: '5', amount: '10000' },
  };
  const delivery = mods.deliveryLib.deliveryCost('Москва', 'Севастополь', register.delivery);
  const fx = mods.fxLib.fxRisk(register.fx);
  const note = { kind: 'other', place: { name: 'Севастополь', hard: true }, company: { name: 'Москва', hard: false } };
  const price = 5_000_000;
  const facts = [...mods.factEst.deliveryItems(delivery), ...mods.factEst.fxItems(fx)];
  const result = mods.estLib.estimateRisks({ price, risks: [], type: 'goods', region: note, assumptions: register.assumptions, facts });
  const without = mods.estLib.estimateRisks({ price, risks: [], type: 'goods', region: note, assumptions: register.assumptions });
  const out = text(
    renderToStaticMarkup(
      h(mods.estUi.RiskEstimates, {
        result, price, priceNote: 'цена вашей заявки', hypotheses: [], data: register, sens: mods.sensLib.computeSensitivity(register.sens),
        defaultDrivers: [], priceHint: '5000000', onChange: none, facts: { delivery, fx, onLoadFx: async () => null },
      }),
    ),
  );
  assert.match(out, /Доставка дороже обычной: Москва → Севастополь/);
  assert.match(out, /Курс: Доллар США, закупка 10 000 \$/);
  assert.match(out, /центры регионов \(Москва → Севастополь\), 1 271 км по прямой × 1,3/);
  assert.match(out, /Курсы Банка России за год; прошлый рост не гарантирует будущий/);
  assert.equal(out.includes('Доставка или выезд: Севастополь вместо Москва'), false, 'общая строка заменена фактами');
  assert.ok(result.total > without.total);
  assert.match(out, /Свои цифры: доставка и курс валюты/);
  const noPrice = text(renderToStaticMarkup(h(mods.estUi.RiskEstimates, { result: mods.estLib.estimateRisks({ price: null, risks: [], type: 'goods', region: note, assumptions: register.assumptions }), price: null, priceNote: '', hypotheses: [], data: register, sens: mods.sensLib.computeSensitivity(register.sens), defaultDrivers: [], priceHint: '0', onChange: none, facts: { delivery, fx, onLoadFx: async () => null } })));
  assert.equal(noPrice.includes('Свои цифры'), false, 'без цены оценивать нечего');
});

// ——— Загрузка закупки в «Аналитику» и поиск по всем гипотезам ———
const intakeForm = (over = {}) =>
  renderToStaticMarkup(
    h(mods.intakeUi.AnalyticsIntakeForm, { files: [], failed: null, busy: null, error: '', fields: { title: '', price: '', law: '' }, onFiles: none, onRemove: none, onField: none, ...over }),
  );

test('загрузить закупку: пустое окно — «бесплатно, без ИИ», куда перетащить, кнопка выбора; полей ещё нет', () => {
  const out = intakeForm();
  const t = text(out);
  assert.match(t, /Бесплатно: без ИИ/);
  assert.match(t, /Перетащите файлы закупки сюда/);
  assert.match(t, /Выбрать файлы/);
  assert.match(out, /type="file"[^>]*multiple/);
  assert.match(t, /Сканы без ИИ не читаются/);
  assert.equal(t.includes('Начальная цена'), false);
});

test('загрузить закупку: файлы с описанием и кнопкой «убрать», найденное — в полях (название, цена, закон кнопками), ошибка и непрочитанное видны', () => {
  const out = intakeForm({
    files: [{ name: 'Извещение.docx', meta: 'DOCX · 12 345 симв. · прочитан' }],
    failed: 'Не прочитаны: скан.pdf — сканы без ИИ не читаются',
    error: 'Нет связи с сервером',
    fields: { title: 'Поставка угля', price: '25 930 002 ₽', law: '223' },
  });
  const t = text(out);
  assert.match(t, /Извещение\.docx DOCX · 12 345 симв\. · прочитан/);
  assert.match(out, /aria-label="Убрать файл Извещение\.docx"/);
  assert.match(out, /value="Поставка угля"/);
  assert.match(out, /value="25 930 002 ₽"/);
  assert.match(out, /aria-pressed="true"[^>]*>223-ФЗ</);
  assert.match(out, /aria-pressed="false"[^>]*>44-ФЗ</);
  assert.match(out, /aria-pressed="false"[^>]*>Не указан</);
  assert.match(out, /role="alert"[^>]*>.*?Нет связи с сервером<\/p>/);
  assert.match(t, /Не прочитаны: скан\.pdf/);
});

test('загрузить закупку: пока читаются файлы — «Читаю файлы…» и кнопка выбора недоступна', () => {
  const out = intakeForm({ busy: 'reading' });
  assert.match(text(out), /Читаю файлы…/);
  assert.match(out, /disabled=""[^>]*>Выбрать файлы/);
});

test('аналитика: кнопка «Загрузить закупку» наверху и при пустом списке, и при заполненном; про платное сказано в подсказке', () => {
  const withList = text(renderToStaticMarkup(h(mods.home.AnalyticsHome, { purchases: [{ id: 'p1', title: 'Уголь', price: '1 000 ₽', kind: '44-ФЗ' }], onOpen: none, onUpload: none })));
  assert.match(withList, /Загрузить закупку/);
  assert.match(withList, /Загрузите закупку или выберите из списка/);
  assert.match(withList, /ИИ не используется, платного здесь ничего нет/);
});

test('проверка поиском: одна кнопка на все гипотезы, которые ещё не искали, с числом; уже найденные в число не входят', () => {
  const t = text(estimateUi(mods.hiddenLib.EMPTY_REGISTER, 1_000_000, withSearch));
  assert.match(t, /Проверить поиском \(\d+\)/);
  assert.match(t, /Обычный бесплатный поиск в интернете\. В запрос уходят только ключевые слова/);
  const all = (t.match(/Проверить поиском \((\d+)\)/) ?? [])[1];
  const one = text(estimateUi({ ...mods.hiddenLib.EMPTY_REGISTER, searches: { logistics: RECORD } }, 1_000_000, withSearch));
  const rest = (one.match(/Проверить поиском \((\d+)\)/) ?? [])[1];
  assert.ok(Number(rest) === Number(all) - 1 || (all === '1' && rest === undefined), `${all} → ${rest}`);
});

// ——— Уровни важности на экране: главное число, крупнейшие риски, окрашенные строки итога ———
const HEAD = { tone: 'good', label: 'Участвовать можно по цене не ниже', value: '3 902 197 ₽', note: '22,0 % от начальной', extras: [{ label: 'Безопасная (выдержит стресс)', value: '4 100 000 ₽', tone: 'warn' }, { label: 'Целевая (с вашей маржой)', value: '4 390 282 ₽', tone: 'good' }] };
const TOP = [
  { title: 'Просрочка: пеня 5 % в день', amount: '2 500 000 ₽', pct: '50,0 % цены', tone: 'danger' },
  { title: 'Рост затрат на 10 % при твёрдой цене', amount: '425 000 ₽', pct: '8,5 % цены', tone: 'warn' },
];

test('экран: главное число крупно и цветом — цена, с которой можно участвовать, и две соседние цены; подпись над числом и «от начальной» под ним', () => {
  const out = summaryUi(summaryOf('careful', { headline: HEAD, topRisks: TOP }));
  const t = text(out);
  assert.match(t, /Участвовать можно по цене не ниже 3 902 197 ₽ 22,0 % от начальной/);
  assert.match(out, /text-4xl font-bold[^"]*text-success[^>]*>3 902 197 ₽/, 'главное число — самое крупное и зелёное (тон по итогу)');
  assert.match(out, /text-2xl font-bold[^"]*text-warn-foreground[^>]*>4 100 000 ₽/, 'безопасная — янтарная');
  assert.match(out, /text-2xl font-bold[^"]*text-success[^>]*>4 390 282 ₽/, 'целевая — зелёная');
  assert.match(t, /Безопасная \(выдержит стресс\)/);
});

test('экран: итог окрашен по уровню — «не стоит» красный, «осторожно» янтарный, «можно» зелёный; убыток по начальной цене — красное главное число', () => {
  const stop = summaryUi(summaryOf('stop', { headline: { tone: 'danger', label: 'Убыток даже по начальной цене', value: '−1 962 534 ₽', note: 'начальная цена 5 000 000 ₽', extras: [] } }));
  assert.match(stop, /border-danger\/40 bg-danger\/5/);
  assert.match(stop, /text-2xl font-bold[^"]*text-danger[^>]*>Участвовать не стоит/);
  assert.match(stop, /text-4xl font-bold[^"]*text-danger[^>]*>−1 962 534 ₽/);
  assert.match(summaryUi(summaryOf('careful', { headline: HEAD })), /border-warn\/60/);
  assert.match(summaryUi(summaryOf('go', { headline: HEAD })), /border-success\/40/);
});

test('экран: крупнейшие риски — жирные суммы и доля цены цветом, подпись обычным шрифтом, «если сработают все» красным; эти числа в мелких плитках не повторяются', () => {
  const facts = [
    { id: 'nmck', label: 'Начальная цена', value: '5 000 000 ₽' },
    { id: 'risks', label: 'Риски в рублях, если сработают все', value: 'до 3 476 014 ₽' },
    { id: 'target', label: 'Целевая цена', value: '4 390 282 ₽' },
  ];
  const out = summaryUi(summaryOf('careful', { headline: HEAD, topRisks: TOP, facts }));
  const t = text(out);
  assert.match(t, /Главные риски Если сработают все: до 3 476 014 ₽/);
  assert.match(out, /text-xl font-bold[^"]*text-danger[^>]*>2 500 000 ₽/);
  assert.match(out, /font-semibold text-danger[^>]*>50,0 % цены/);
  assert.match(out, /text-xl font-bold[^"]*text-warn-foreground[^>]*>425 000 ₽/);
  // Начальная цена — в тихой плитке; целевая и общий итог рисков — только крупно выше.
  assert.equal((t.match(/Целевая цена/g) ?? []).length, 0);
  assert.equal((t.match(/Риски в рублях, если сработают все/g) ?? []).length, 0);
  assert.match(t, /Начальная цена 5 000 000 ₽/);
});

test('экран: затрат нет — главного числа нет, вместо него кнопка действия в верхнем блоке; рисков нет — блока «Главные риски» нет', () => {
  const out = summaryUi(summaryOf('unknown', { headline: null, topRisks: [] }), { action: { label: 'Ввести затраты', onClick: none } });
  assert.match(text(out), /Ввести затраты/);
  assert.equal(text(out).includes('Главные риски'), false);
  assert.equal(out.includes('text-4xl'), false);
});

test('раскрывашка: строка итога окрашена по важности — красная и янтарная жирным, обычная тихо', () => {
  const render = (tone) => renderToStaticMarkup(h(mods.collapsible.Collapsible, { title: 'Раздел', brief: 'до 3 476 014 ₽', tone, open: false, onToggle: none }, h('p', null, 'x')));
  assert.match(render('danger'), /font-semibold text-danger[^>]*>до 3 476 014 ₽/);
  assert.match(render('warn'), /font-semibold text-warn-foreground[^>]*>до 3 476 014 ₽/);
  assert.match(render('good'), /font-semibold text-success/);
  assert.match(render('muted'), /font-normal text-muted-foreground[^>]*>до 3 476 014 ₽/);
  assert.match(render(undefined), /font-normal text-muted-foreground/);
});
