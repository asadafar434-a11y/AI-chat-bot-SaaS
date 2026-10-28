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

// ——— «Пакет»: уровни важности ———
const plain = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/[  ]/g, ' ').replace(/\s+/g, ' ');

test('«Пакет»: сверху плашка итога — «готов» зелёным, главная кнопка «Всё архивом · ZIP» там же и больше нигде', () => {
  const out = html(h(pkg.StepPackage, props()));
  assert.match(out, /border-success\/40 bg-success\/5/);
  assert.match(out, /text-2xl font-bold[^"]*text-success[^>]*>.*Пакет документов готов/s);
  assert.equal((out.match(/Всё архивом · ZIP/g) ?? []).length, 1, 'кнопка архива одна — в плашке итога');
  assert.ok(out.indexOf('Всё архивом · ZIP') < out.indexOf('Состав пакета'), 'кнопка выше состава пакета');
  assert.equal(/Осталось незакрытых пунктов/.test(out), false);
});

test('«Пакет»: не всё закрыто — плашка янтарная, «осталось незакрытых пунктов: N» жирным и «Вернуться к проверке» рядом с архивом', () => {
  const final = { ...props().final, ready: false, fields: { required: 4, filled: 2, empty: 2, invalid: 0 } };
  const out = html(h(pkg.StepPackage, props({ final })));
  assert.match(out, /border-warn\/50 bg-warn-surface\/30/);
  assert.match(out, /text-2xl font-bold[^"]*text-warn-foreground[^>]*>.*Пакет почти готов/s);
  assert.match(plain(out), /Осталось незакрытых пунктов: 2/);
  assert.match(out, /text-\[15px\] font-bold text-warn-foreground/);
  assert.match(plain(out), /Вернуться к проверке .*Всё архивом · ZIP/);
});

test('«Пакет»: документов заявки ещё нет — «К проверке» в плашке, архива нет; текст «составьте их на шаге «Проверка»» — в подсказке', () => {
  const out = html(h(pkg.StepPackage, props({ hasTp: false })));
  assert.match(plain(out), /Документы заявки ещё не составлены/);
  assert.match(plain(out), /К проверке/);
  assert.equal(out.includes('Всё архивом'), false);
  assert.match(out, /role="tooltip"[^>]*>Составьте их на шаге «Проверка»/);
});

test('«Пакет»: формат файлов — кнопками в шапке состава пакета, выбранный отмечен; отдельной строки «Формат:» нет', () => {
  const out = html(h(pkg.StepPackage, props({ format: 'pdf' })));
  const group = out.slice(out.indexOf('aria-label="Формат файлов"'));
  assert.match(group, /aria-pressed="false"[^>]*>DOCX/);
  assert.match(group, /aria-pressed="true"[^>]*>PDF/);
  assert.match(group, /aria-pressed="false"[^>]*>ODT/);
  assert.ok(out.indexOf('Состав пакета') < out.indexOf('aria-label="Формат файлов"'));
  assert.equal(out.includes('Формат:'), false);
});

test('«Пакет»: оплата и проверка специалистом — тонкие строки «скоро»; длинные описания и список из трёх пунктов — только в подсказках', () => {
  const out = html(h(pkg.StepPackage, props()));
  assert.match(plain(out), /Заявка под ключ · 1 000 ₽ скоро/i);
  assert.match(plain(out), /Проверка специалистом скоро/i);
  assert.equal(/<ul class="mt-2 flex flex-wrap/.test(out), false, 'списка из трёх галочек нет');
  assert.match(out, /role="tooltip"[^>]*>Пакет проверил ИИ\. Живой тендерный юрист/);
  assert.match(out, /<button[^>]*disabled=""[^>]*>.*Оплатить/s);
});

test('«Пакет»: заголовки блоков — крупно и жирно; «готово N из M» зелёным, когда всё отмечено', () => {
  const items = [{ text: 'Документ', source: 'Извещение', quote: 'Документ', verified: true, ready: true, required: true }];
  const out = html(h(pkg.StepPackage, props({ items })));
  assert.match(out, /text-\[15px\] font-bold[^>]*>Состав пакета/);
  assert.match(out, /text-\[15px\] font-bold[^>]*>.*Что требует заказчик/s);
  assert.match(out, /text-success[^>]*>готово 1 из 1/);
  const half = html(h(pkg.StepPackage, props({ items: [{ ...items[0], ready: false }] })));
  assert.doesNotMatch(half, /text-success[^>]*>готово 0 из 1/);
});

test('«Пакет»: «Шаблоны заказчика» — список файлов-образцов над составом пакета; без шаблонов блока нет', () => {
  const templates = [
    { name: 'Приложение № 3 Форма заявки.docx', kind: 'customer_form', label: 'Форма заказчика', blanks: 5, excel: false },
    { name: 'Приложение № 5 Спецификация.xlsx', kind: 'customer_form', label: 'Форма заказчика', blanks: 0, excel: true },
  ];
  const out = html(h(pkg.StepPackage, props({ templates })));
  assert.match(out, /Шаблоны заказчика · 2/);
  assert.match(out, /Приложение № 3 Форма заявки\.docx/);
  assert.match(out, /5 пустых мест/);
  assert.match(out, />Excel</);
  assert.ok(out.indexOf('Шаблоны заказчика') < out.indexOf('Состав пакета'), 'список — над составом пакета');
  assert.doesNotMatch(html(h(pkg.StepPackage, props({ templates: [] }))), /Шаблоны заказчика/);
  assert.doesNotMatch(html(h(pkg.StepPackage, props())), /Шаблоны заказчика/);
});

test('«Пакет»: «Финальная проверка» показывает первые шесть замечаний, остальные — по кнопке «Показать ещё N»', () => {
  const finding = (i) => ({ id: `f${i}`, severity: 'CRITICAL', what: `Замечание номер ${i}`, requirement: 'Требование', source: 'Извещение', fix: 'Исправить' });
  const report = { findings: Array.from({ length: 10 }, (_, i) => finding(i + 1)), critical: 10, warnings: 0, info: 0, risk: 'high' };
  const out = html(h(pkg.StepPackage, props({ auditReport: report })));
  assert.match(out, /Замечание номер 6</);
  assert.doesNotMatch(out, /Замечание номер 7</);
  assert.match(out, /Показать ещё 4/);
  const few = html(h(pkg.StepPackage, props({ auditReport: { ...report, findings: report.findings.slice(0, 5), critical: 5 } })));
  assert.doesNotMatch(few, /Показать ещё/);
});

test('«Пакет»: блоки — вкладками «Файлы», «Реестровые номера», «Что требует заказчик», «Финальная проверка»; видна одна, остальные скрыты, но в странице; счётчики на вкладках', () => {
  const finding = (i) => ({ id: `f${i}`, severity: 'CRITICAL', what: `Замечание ${i}`, requirement: 'Т', source: 'И', fix: 'И' });
  const items = [
    { text: 'Выписка из ЕГРЮЛ', source: 'Извещение', quote: 'Выписка', verified: true, ready: true, required: true },
    { text: 'Справка о задолженности', source: 'Извещение', quote: 'Справка', verified: true, ready: false, required: true },
  ];
  const out = html(h(pkg.StepPackage, props({ items, auditReport: { findings: [finding(1), finding(2)], critical: 2, warnings: 0, info: 0, risk: 'high' } })));
  assert.match(out, /role="tablist"/);
  const tabs = [...out.matchAll(/role="tab"[^>]*aria-selected="(true|false)"[^>]*>(.*?)<\/button>/g)].map((m) => [m[1], m[2].replace(/<[^>]+>/g, '')]);
  assert.deepEqual(tabs.map((t) => t[1]), ['Файлы', 'Реестровые номера', 'Что требует заказчик1/2', 'Финальная проверка2']);
  assert.deepEqual(tabs.map((t) => t[0]), ['true', 'false', 'false', 'false']);
  const panels = [...out.matchAll(/<div role="tabpanel" id="pkg-panel-(\w+)"[^>]*>/g)].map((m) => [m[1], /\bhidden=""/.test(m[0])]);
  assert.deepEqual(panels, [['files', false], ['registry', true], ['needs', true], ['audit', true]]);
  assert.match(out, /Состав пакета/, 'скрытые вкладки остаются в странице: введённое не теряется');
  assert.match(out, /Что требует заказчик/);
  assert.match(out, /Замечание 1</);
});

test('«Пакет» без заявки и без бланков: одна вкладка «Что требует заказчик» — ряда вкладок нет', () => {
  const items = [{ text: 'Документ о полномочиях', source: 'Извещение', quote: 'Документ', verified: true, ready: false, required: true }];
  const out = html(h(pkg.StepPackage, props({ hasTp: false, noApplication: true, rows: [], count: 0, items, registry: undefined })));
  assert.doesNotMatch(out, /role="tablist"/);
  assert.match(out, /Что требует заказчик/);
});
