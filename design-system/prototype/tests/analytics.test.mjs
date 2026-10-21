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
    renderToStaticMarkup(h(mods.home.AnalyticsHome, { purchases: [{ id: 'p1', title: 'Поставка угля', price: '25 930 002,00 ₽', kind: '223-ФЗ · аукцион' }], onOpen: none, onNew: none })),
  );
  assert.match(list, /Поставка угля/);
  assert.match(list, /начальная цена 25 930 002,00 ₽/);
  assert.match(list, /Открыть расчёт/);
  assert.match(list, /РИЦ — расчёт индикативной цены/);
  assert.match(list, /Расчёт цены у заказчика/);
  assert.match(list, /Ценовой бейдж/);
  assert.match(list, /Риски и расходы из договора/);
  assert.match(list, /Сколько это может стоить/);
  assert.match(list, /Какую цену ставить/);
  assert.ok((list.match(/готово/g) ?? []).length >= 5, 'пять шагов готовы');
  assert.ok((renderToStaticMarkup(h(mods.home.AnalyticsHome, { purchases: [], onOpen: none, onNew: none })).match(/скоро/g) ?? []).length >= 3, 'остальное помечено «скоро»');
  assert.match(text(renderToStaticMarkup(h(mods.home.AnalyticsHome, { purchases: [], onOpen: none, onNew: none }))), /Новая закупка/);
  assert.match(text(renderToStaticMarkup(h(mods.home.AnalyticsHome, { purchases: null, onOpen: none, onNew: none }))), /Читаю закупки/);
});

test('пока позиций нет: сказано, что делать — взять из документов или добавить, нужно не меньше трёх аналогов с источником и датой', () => {
  const out = text(panel(data([]), null));
  assert.match(out, /РИЦ — расчёт индикативной цены/);
  assert.match(out, /Взять позиции из документов/);
  assert.match(out, /Добавить позицию/);
  assert.match(out, /Для РИЦ нужно не меньше 3 цен на позицию, для ценового бейджа — не меньше 5/);
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
  assert.match(out, /Высокая цена ещё не значит выгодный контракт/);
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
  assert.match(low, /хватит ли такой цены на ваши затраты/);
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
  assert.match(out, /решаете вы/);
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
  assert.match(out, /В документах не нашёл расчёт начальной цены по предложениям поставщиков/);
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
  assert.match(none, /Проект договора в документах не нашёл/);
  assert.match(none, /Не проверено/);
  assert.equal(/Подтверждено/.test(none), false);
  const empty = text(renderToStaticMarkup(h(mods.risksUi.ContractRisks, { risks: [], hasContract: true })));
  assert.match(empty, /Это не значит, что их нет/);
});

const SEVASTOPOL = { text: 'Место поставки: г. Севастополь', region: { name: 'Севастополь', hard: true } };
const estimateUi = (register, price = 1_000_000) => {
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
  assert.match(out, /Ещё 2 без суммы/);
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
  assert.match(out, /Это типовые допущения, а не факты о вашей компании/);
  assert.match(out, /На чём держатся числа/);
  assert.match(out, /допущение: ставка 14 % годовых/);
  assert.match(out, /Ещё риски для такой закупки без оценки: 7/);
  assert.match(out, /Сумму по ним посчитает ИИ с российским поиском/);
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
  assert.match(noPrice, /Цена контракта не найдена в документах, поэтому оценить в рублях нечего/);
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
  assert.match(out, /плюс одна неустойка: Просрочка: пеня 0,1 % в день/);
  assert.ok(econUi().includes('placeholder="из шага «Цена»: 700 000"'), 'затраты из шага «Цена» подсказаны в поле');
});

test('какую цену ставить: затрат нет — просьба их ввести без выдуманных цифр; начальной цены нет — так и сказано; убыток даже по начальной — «участвовать не стоит»', () => {
  const none = text(econUi({ costs: null }, mods.hiddenLib.EMPTY_REGISTER, { costs: null, extra: null, taxPct: null }));
  assert.match(none, /Введите свои затраты на исполнение — без них цену не посчитать/);
  assert.match(none, /Своих цифр у программы нет/);
  assert.equal(/Ставьте не ниже/.test(none), false);
  assert.match(text(econUi({ nmck: null })), /Начальная цена в документах не найдена/);
  const loss = text(econUi({ costs: 950_000 }));
  assert.match(loss, /Даже по начальной цене \(1 000 000,00 ₽\) контракт убыточный на ваших затратах/);
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

test('резюме: итог светофором с причинами, метка «Оценка», цифры, абзац резюме и обе кнопки отчёта', () => {
  const out = summaryUi(summaryOf('careful'));
  const t = text(out);
  assert.match(t, /Участвовать осторожно/);
  assert.match(t, /Первая причина\. Вторая причина\./);
  assert.match(t, /Оценка/);
  assert.match(t, /Начальная цена 1 000 000 ₽/);
  assert.match(t, /Резюме Поставка угля\./);
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
