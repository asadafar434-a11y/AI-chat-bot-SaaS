// Раскладка шага «Пакет» и защита от выезда за рамки, отрисованные в разметку, — npm test в design-system/prototype.
// Решение владельца 17.10.2026: «Проверка специалистом» — узкой строкой над документами, остальное на всю ширину; ничего не выезжает за рамку.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
let server;
let pkg;
let ui;

before(async () => {
  server = await createServer({
    root,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, fs: { allow: [path.resolve(root, '../..')] } },
    resolve: { alias: [{ find: '@', replacement: path.resolve(root, '../../web/src') }] },
  });
  pkg = await server.ssrLoadModule('/src/components/StepPackage.tsx');
  ui = await server.ssrLoadModule('/src/components/ui.tsx');
});

after(async () => {
  await server?.close();
});

const html = (element) => renderToStaticMarkup(element);
const LONG = 'Наличие_у_участников_закупки_специалистов_и_иных_работников_определённого_уровня_квалификации_2026.docx';
const noop = () => {};

const props = (over = {}) => ({
  hasTp: true,
  format: 'docx',
  onFormat: noop,
  final: { fields: { required: 4, filled: 4, empty: 0, invalid: 0 }, documents: { required: 1, ready: 1 }, confirmations: { required: 0, done: 0 }, signatures: { required: 0, done: 0 }, blocking: [], ready: true, text: 'Готово' },
  rows: [{ part: 'application', title: 'Техническое предложение', sub: 'первая часть заявки', badge: { tone: 'ok', text: 'готово' }, action: 'download', preview: null, canRedo: false }],
  count: 1,
  items: [],
  downloading: null,
  writing: null,
  busy: false,
  error: null,
  note: null,
  onToggleReady: noop,
  onDownload: noop,
  onRedo: noop,
  onDownloadAll: noop,
  onFix: noop,
  onTariffs: noop,
  onBack: noop,
  registry: h('section', { id: 'registry-slot' }, 'Реестровые номера товаров'),
  ...over,
});

const scoring = {
  howWins: 'points',
  totalPoints: null,
  totalMax: null,
  groups: [
    {
      name: 'Квалификация участников закупки',
      weightText: '30 %',
      criteria: [{ row: { indicator: LONG, detail: '', criterion: '' }, maxPoints: 15, points: null, value: { kind: 'count', n: 0 }, gap: LONG }],
    },
  ],
};

test('«Пакет»: «Проверка специалистом» — строкой над документами, а не колонкой справа; всё остальное на всю ширину', () => {
  const out = html(h(pkg.StepPackage, props()));
  const expert = out.indexOf('Проверка специалистом');
  assert.ok(expert > 0, 'блок есть');
  assert.ok(expert < out.indexOf('Состав пакета'), 'он выше состава пакета');
  assert.ok(out.indexOf('Состав пакета') < out.indexOf('registry-slot'), 'реестровые номера — ниже состава пакета');
  assert.equal(/lg:grid-cols-\[/.test(out), false, 'двух колонок нет: правая колонка оставляла пустое место под блоком');
  assert.match(out, /Отправить специалисту · 500 ₽/);
  assert.match(out, /<button[^>]*disabled=""[^>]*>.*Отправить специалисту/s, 'пока недоступно');
  assert.match(out, /Заключение за 2 часа/);
});

test('«Оценка по критериям»: столбцы таблицы фиксированные, длинное название переносится, а не растягивает таблицу за рамку', () => {
  const out = html(h(pkg.StepPackage, props({ scoringReport: scoring })));
  const table = out.slice(out.indexOf('<table'), out.indexOf('</table>'));
  assert.match(table, /<table class="[^"]*table-fixed/);
  assert.match(table, /<colgroup>/);
  assert.equal(/truncate/.test(table), false, 'название в ячейке не обрезается, а переносится');
  assert.match(table, new RegExp(LONG.slice(0, 30)));
});

test('«Бейдж-фраза» переносится на строки (wrap), короткая метка — нет', () => {
  const phrase = html(h(ui.Badge, { tone: 'warn', wrap: true }, 'Такое же название ещё у 2 записей — выберите свой номер'));
  assert.match(phrase, /max-w-full/);
  assert.equal(/whitespace-nowrap/.test(phrase), false);
  const label = html(h(ui.Badge, { tone: 'neutral' }, 'Выбрана'));
  assert.match(label, /whitespace-nowrap/);
  assert.match(label, /rounded-full/);
});

test('слово без пробелов (имя файла) переносится везде: у страницы стоит overflow-wrap: anywhere', () => {
  const css = readFileSync(path.join(root, 'src/index.css'), 'utf8');
  const body = css.slice(css.indexOf('\nbody {'), css.indexOf('}', css.indexOf('\nbody {')));
  assert.match(body, /overflow-wrap:\s*anywhere/);
});

test('«Пакет» без заявки (у единственного поставщика): «Что подготовить» и список заказчика, без файлов, оплаты и проверки специалистом', () => {
  const items = [
    { text: 'Документ о полномочиях', source: 'Извещение', quote: 'Документ о полномочиях', verified: true, ready: false, required: true },
    { text: 'Отсутствие в реестре недобросовестных поставщиков', source: 'Извещение', quote: 'РНП', verified: true, ready: false, required: false, note: 'Отдельного документа не просят' },
  ];
  const out = html(h(pkg.StepPackage, props({ hasTp: false, noApplication: true, rows: [], count: 0, items, registry: undefined })));
  assert.match(out, /Что подготовить/);
  assert.match(out, /В этой закупке заявки нет: заказчик заключает договор с названным поставщиком/);
  assert.match(out, /Что требует заказчик/);
  assert.match(out, /Всё, что заказчик просит от участника. Отметьте, что уже готово./);
  assert.match(out, /Документ о полномочиях/);
  assert.doesNotMatch(out, /Состав пакета|Всё архивом|Проверка специалистом|Заявка под ключ|Документы заявки ещё не составлены|Формат:|Пакет документов/);
  // Обычная закупка без документов — по-прежнему просим составить.
  assert.match(html(h(pkg.StepPackage, props({ hasTp: false }))), /Документы заявки ещё не составлены/);
});
