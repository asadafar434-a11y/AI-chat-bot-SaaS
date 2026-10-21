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
    side: await server.ssrLoadModule('/src/components/Sidebar.tsx'),
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
  assert.ok((list.match(/готово/g) ?? []).length >= 3, 'три шага готовы');
  assert.ok((renderToStaticMarkup(h(mods.home.AnalyticsHome, { purchases: [], onOpen: none, onNew: none })).match(/скоро/g) ?? []).length >= 4, 'остальное помечено «скоро»');
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
