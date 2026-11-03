// Графики проверки контрагента: кольцо, столбики по годам, полосы, счётчик; анимация уважает «уменьшить движение» — npm test в design-system/prototype.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
let server;
const mods = {};

before(async () => {
  server = await createServer({
    root,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, fs: { allow: [path.resolve(root, '../..')] } },
    resolve: { alias: [{ find: '@', replacement: path.resolve(root, '../../web/src') }] },
  });
  mods.viz = await server.ssrLoadModule('/src/components/CounterpartyViz.tsx');
  mods.view = await server.ssrLoadModule('/src/components/Counterparty.tsx');
  mods.lib = await server.ssrLoadModule('@/lib/counterparty.ts');
});

after(async () => {
  await server?.close();
});

// Суммы пишутся с неразрывными пробелами — для сравнения приводим их к обычным.
const html = (element) => renderToStaticMarkup(element).replace(/[  ]/g, ' ');
const text = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

const report = {
  inn: '7702429410', kind: 'legal', at: '2026-11-03T12:00:00.000Z', name: 'ООО "ТЕСТ"', identity: { ogrn: '1', kpp: '2', region: 'Москва' }, address: 'Москва',
  status: { text: 'Действующее', tone: 'good' }, facts: [], links: [], provider: 'checko', sources: { checko: { ok: true } },
  statements: [
    { year: 2025, revenue: 412300, netProfit: -13100, assets: 301000, equity: 48200 },
    { year: 2024, revenue: 389800, netProfit: 21400, assets: 288000, equity: 61300 },
    { year: 2023, revenue: 301200, netProfit: 17800, assets: 240000, equity: 39900 },
  ],
  reliability: { scale: 61, nominality: { level: 1, text: 'ок' }, financial: { level: 2, text: 'умеренные' }, balance: { good: 64, warn: 28, bad: 8 }, factors: [{ code: 'a', tone: 'danger', weight: 3, text: 'Убыток' }, { code: 'b', tone: 'good', weight: 1, text: 'Давно работает' }] },
  courts: { total: 3, active: 1, plaintiff: 1, defendant: 2, claimSum: 5000000, cases: [
    { number: 'А40-1/2023', date: '2023-02-01', url: null, role: 'defendant', claimSum: 1000000, active: true, result: null, opponent: 'ООО "А"' },
    { number: 'А40-2/2024', date: '2024-03-01', url: null, role: 'plaintiff', claimSum: null, active: false, result: null, opponent: null },
    { number: 'А40-3/2024', date: '2024-04-01', url: null, role: 'defendant', claimSum: 2000000, active: false, result: null, opponent: null },
  ] },
  enforcements: { total: 1, debtSum: 2400000, outstandingSum: 1650000, items: [{ number: '1-ИП', date: '2024-05-12', subject: 'Долг', debt: 2400000, outstanding: 1650000 }] },
};

test('отчёт: кольцо надёжности в шапке, столбики по годам, переключатель «Активы и капитал», таблица остаётся под графиком', () => {
  const out = html(h(mods.view.CounterpartyReportView, { report }));
  assert.match(out, /role="img" aria-label="Факторы надёжности по Checko: положительных 64%, требующих внимания 28%, негативных 8%"/);
  assert.match(out, />64%</, 'в центре кольца — доля положительных факторов');
  assert.match(out, /role="img" aria-label="Выручка и Чистая прибыль по годам, 2023–2025"/);
  assert.match(text(out), /Активы и капитал/);
  assert.match(out, /aria-label="2025: Выручка 412,3 млн ₽, Чистая прибыль −13,1 млн ₽"/, 'у каждого года — подпись для чтения с экрана');
  assert.match(out, /<details[^>]*>[\s\S]*Бухгалтерская отчётность \(ГИР БО ФНС\)/, 'таблица со всеми цифрами — рядом с графиком');
  assert.equal(out.includes('role="status"'), false, 'подсказка графика показывается только при наведении');
});

test('суды и приставы: полосы ролей и долга, дела по годам, подписи словами (цвет не единственный признак)', () => {
  const t = text(html(h(mods.view.CounterpartyReportView, { report })));
  assert.match(t, /ответчик 2/);
  assert.match(t, /истец 1/);
  assert.match(t, /Дел в году/);
  assert.match(t, /остаток 1,7 млн ₽/);
  assert.match(t, /погашено 750 тыс\. ₽/);
  const bars = html(h(mods.view.CounterpartyReportView, { report }));
  assert.match(bars, /aria-label="Долг по производствам: остаток 1,7 млн ₽ из 2,4 млн ₽"/);
  assert.match(bars, /aria-label="Число арбитражных дел по годам"/);
});

test('счётчик числа без анимации (сервер, «уменьшить движение») сразу показывает итог; пусто — прочерк', () => {
  assert.match(html(h(mods.viz.CountUp, { to: 412300, format: mods.lib.thousandsText })), /412,3 млн ₽/);
  assert.match(html(h(mods.viz.CountUp, { to: null, format: mods.lib.thousandsText })), /—/);
});

test('столбики: отрицательное значение уходит вниз от нулевой линии, подпись нуля и оси на месте, легенда по рядам', () => {
  const out = html(h(mods.viz.GroupedBars, { rows: [{ label: '2024', values: [100, -50] }], series: [{ name: 'Доход', color: 'red' }, { name: 'Убыток', color: 'blue' }], format: (n) => String(n), label: 'проба' }));
  assert.match(out, /border-radius:0 0 4px 4px/, 'столбик ниже нуля скруглён снизу');
  assert.match(out, /border-radius:4px 4px 0 0/);
  assert.match(out, /Доход/);
  assert.match(out, /Убыток/);
  assert.match(out, />0</, 'подпись нуля');
});

test('анимации отключаются при «уменьшить движение»: CSS и код проверяют настройку', () => {
  const css = readFileSync(path.join(root, 'src/index.css'), 'utf8');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.cp-float[^}]*animation: none/);
  assert.match(css, /prefers-reduced-motion: reduce\)\s*\{\s*\.animate-fade-up/);
  const viz = readFileSync(path.join(root, 'src/components/CounterpartyViz.tsx'), 'utf8');
  assert.match(viz, /prefers-reduced-motion: reduce/);
  assert.match(viz, /IntersectionObserver/, 'графики оживают, когда попали на экран');
});

test('нет ключа Checko: у отчёта из открытых реестров ссылки на ручную проверку — плитки, а не голый список', () => {
  const links = [{ id: 'rnp', title: 'Реестр недобросовестных поставщиков', hint: 'ЕИС, поиск по ИНН', url: 'https://zakupki.gov.ru/x' }];
  const out = html(h(mods.view.CounterpartyReportView, { report: { ...report, provider: 'direct', reliability: null, courts: null, enforcements: null, links } }));
  assert.match(out, /<a href="https:\/\/zakupki\.gov\.ru\/x"[^>]*rel="noopener noreferrer"/);
  assert.match(out, /sm:grid-cols-2/);
  assert.equal(out.includes('Факторы надёжности по Checko'), false, 'кольца без оценки Checko нет');
});

test('РНП: проверка показана всегда — «не включена» зелёным, «включена» красным со сроком и заказчиком; без ответа Checko строки нет', () => {
  const clean = text(html(h(mods.view.CounterpartyReportView, { report: { ...report, rnp: { included: false, records: [] } } })));
  assert.match(clean, /РНП \(реестр недобросовестных поставщиков\): не включена в реестр/);
  const bad = text(html(h(mods.view.CounterpartyReportView, { report: { ...report, rnp: { included: true, records: [{ number: '1', date: '2025-06-01', customer: 'ГБУ "Школа"', purchase: null }] } } })));
  assert.match(bad, /РНП \(реестр недобросовестных поставщиков\): включена в реестр: 1 зап\.; последняя от 01\.06\.2025, заказчик ГБУ "Школа"/);
  assert.doesNotMatch(text(html(h(mods.view.CounterpartyReportView, { report: { ...report, rnp: null, efrsb: null, sanctions: null, reliability: null, courts: null, enforcements: null } }))), /РНП \(реестр/);
});
