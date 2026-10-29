// «Риск отклонения» на шаге «Проверка» и заглушка «Поиска закупок», отрисованные в разметку, — npm test в design-system/prototype.
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
let server;
let review;
let search;

before(async () => {
  server = await createServer({
    root,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, fs: { allow: [path.resolve(root, '../..')] } },
    resolve: { alias: [{ find: '@', replacement: path.resolve(root, '../../web/src') }] },
  });
  review = await server.ssrLoadModule('/src/components/StepReview.tsx');
  search = await server.ssrLoadModule('/src/components/TenderSearch.tsx');
});

after(async () => {
  await server?.close();
});

const html = (element) => renderToStaticMarkup(element);
const text = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const finding = (id, severity, what) => ({ id, severity, what, requirement: 'Требование', source: 'Техническое предложение', evidence: null, fix: 'Впишите значение' });
const report = (findings, risk) => ({
  critical: findings.filter((f) => f.severity === 'CRITICAL').length,
  warnings: findings.filter((f) => f.severity === 'WARNING').length,
  info: findings.filter((f) => f.severity === 'INFO').length,
  findings,
  risk,
});

test('риск: уровень и причины по замечаниям проверки, без процента', () => {
  const high = text(html(h(review.RiskBlock, { audit: report([finding('a', 'CRITICAL', 'Не заполнено: марка'), finding('b', 'CRITICAL', 'Нет сертификата'), finding('c', 'WARNING', 'Цена')], 'high') })));
  assert.match(high, /Риск отклонения/);
  assert.match(high, /Высокий/);
  assert.match(high, /2 критичных замечания и 1 предупреждение — заявку могут отклонить/);
  assert.equal(/\d\s*%/.test(high), false, 'процента нет');

  const one = text(html(h(review.RiskBlock, { audit: report([finding('a', 'CRITICAL', 'Не заполнено')], 'high') })));
  assert.match(one, /1 критичное замечание — заявку могут отклонить/);

  const medium = text(html(h(review.RiskBlock, { audit: report([finding('a', 'WARNING', 'Подтвердите цену'), finding('b', 'WARNING', 'Подтвердите срок')], 'medium') })));
  assert.match(medium, /Средний/);
  assert.match(medium, /2 предупреждения — нужна ваша проверка/);

  const low = text(html(h(review.RiskBlock, { audit: report([], 'low') })));
  assert.match(low, /Низкий/);
  assert.match(low, /замечаний нет/);
});

test('риск: «Почему такой риск?» — кнопка, а «Пересчитать с ИИ» остаётся недоступной и помечена «скоро»', () => {
  const out = html(h(review.RiskBlock, { audit: report([finding('a', 'CRITICAL', 'x')], 'high') }));
  assert.match(out, /<button[^>]*aria-expanded="false"[^>]*>.*Почему такой риск\?<\/button>/s);
  assert.match(out, /<button[^>]*disabled=""[^>]*>.*Пересчитать с ИИ/s);
  assert.match(out, /скоро/i);
});

test('причины риска: что сделать и источник у каждого замечания, первые 12, остальное — на «Пакете»; честная оговорка про процент', () => {
  const many = Array.from({ length: 15 }, (_, i) => finding(`f${i}`, i < 10 ? 'CRITICAL' : 'WARNING', `Замечание номер ${i + 1}`));
  const out = text(html(h(review.RiskReasons, { audit: report(many, 'high') })));
  assert.match(out, /Замечание номер 1 /);
  assert.match(out, /Замечание номер 12 /);
  assert.equal(/Замечание номер 13 /.test(out), false, 'тринадцатое не показано');
  assert.match(out, /Что сделать: Впишите значение · Источник: Техническое предложение/);
  assert.match(out, /Критично/);
  assert.match(out, /Предупреждение/);
  assert.match(out, /…и ещё 3: полный список — на шаге «Пакет»/);
  assert.match(out, /Это не вероятность, а вывод по правилам/);
  assert.match(out, /Процент не показываем/);

  const none = text(html(h(review.RiskReasons, { audit: report([], 'low') })));
  assert.match(none, /Замечаний нет/);
});

const noop = () => {};
const searchProps = (over = {}) => ({
  filters: { query: '', law: 'any', priceFrom: null, priceTo: null, publishedFrom: null, publishedTo: null, activeOnly: true, titleOnly: false, customer: '', region: '', method: '' },
  onFilters: noop,
  sort: 'deadline',
  onSort: noop,
  result: { items: [], total: 0, hiddenNoPrice: 0, hiddenNoDate: 0 },
  loadedAt: '',
  today: '2026-10-27',
  eisUrl: 'https://zakupki.gov.ru/epz/order/extendedsearch/results.html?searchString=x',
  bookmarklet: 'javascript:void(0)',
  onImport: noop,
  importNote: null,
  onClear: noop,
  onNew: noop,
  ...over,
});

test('«Поиск закупок»: без выгрузки — фильтры, «Найти в ЕИС» и три шага; закупок не выдумываем; «живая лента» — скоро', () => {
  const out = html(h(search.TenderSearch, searchProps()));
  const plain = text(out);
  assert.match(plain, /Поиск закупок/);
  assert.match(plain, /44-ФЗ и 223-ФЗ/);
  assert.match(plain, /Только приём заявок идёт/);
  assert.match(plain, /Найти в ЕИС/);
  assert.match(plain, /Скопировать закупки/);
  assert.match(plain, /Живая лента без выгрузки — скоро/);
  assert.match(plain, /Скопировать ссылку/);
  assert.match(plain, /ЕИС открывается не в каждом окне/);
  assert.match(out, /href="https:\/\/zakupki\.gov\.ru\/epz\/order\/extendedsearch\/results\.html/);
  assert.doesNotMatch(plain, /Найдено:/);
  assert.equal(/\d{11,}/.test(plain), false, 'номеров закупок нет');
});

test('«Поиск закупок»: список — название, заказчик, цена, срок с остатком дней, номер, ссылка в ЕИС; скрытое без цены названо', () => {
  const l = (over) => ({ id: '32616515024', law: '223-ФЗ', title: 'Разработка проектной документации', customer: 'ПАО «Россети»', price: 3304140, publishedAt: '2026-10-27', deadline: '2026-10-29', region: null, method: 'Иной способ', url: null, ...over });
  const items = [l({}), l({ id: '0194200000526005766', law: '44-ФЗ', price: null, deadline: '2026-11-20', title: 'Поставка препаратов', url: 'https://zakupki.gov.ru/epz/order/x' })];
  const out = html(h(search.TenderSearch, searchProps({ result: { items, total: 5, hiddenNoPrice: 3, hiddenNoDate: 0 }, loadedAt: '2026-10-27T10:00:00Z' })));
  const plain = text(out);
  assert.match(plain, /В выгрузке 5 закупок/);
  assert.match(plain, /Найдено: 2/);
  assert.match(plain, /Разработка проектной документации/);
  assert.match(plain, /ПАО «Россети»/);
  assert.match(plain, /3\s?304\s?140 ₽/);
  assert.match(plain, /заявки до 29\.10\.2026 · осталось 2 дня/);
  assert.match(plain, /цена не указана/);
  assert.match(plain, /№ 32616515024/);
  assert.match(out, /href="https:\/\/zakupki\.gov\.ru\/epz\/order\/x"/, 'своя ссылка закупки');
  assert.match(out, /regNumber|searchString=32616515024/, 'без своей ссылки — поиск по номеру');
  assert.match(plain, /Скрыто без цены в выгрузке: 3/);
  assert.match(plain, /Очистить выгрузку/);
});


// ——— Шаг «Проверка»: уровни важности ———
test('риск: уровень — самым крупным и цветом (красный, янтарный, зелёный), плашка подкрашена; причина — жирным рядом', () => {
  const high = html(h(review.RiskBlock, { audit: report([finding('a', 'CRITICAL', 'x')], 'high') }));
  assert.match(high, /text-2xl font-bold[^"]*text-danger[^>]*>Высокий/);
  assert.match(high, /bg-danger\/5/);
  const medium = html(h(review.RiskBlock, { audit: report([finding('a', 'WARNING', 'x')], 'medium') }));
  assert.match(medium, /text-2xl font-bold[^"]*text-warn-foreground[^>]*>Средний/);
  const low = html(h(review.RiskBlock, { audit: report([], 'low') }));
  assert.match(low, /text-2xl font-bold[^"]*text-success[^>]*>Низкий/);
  assert.match(low, /bg-success\/5/);
});

test('причины риска: оговорка про «не вероятность» — в подсказке, на виду только «ИИ не вызывается»', () => {
  const out = html(h(review.RiskReasons, { audit: report([finding('a', 'WARNING', 'x')], 'medium') }));
  assert.match(text(out), /ИИ не вызывается\./);
  assert.match(out, /role="tooltip"[^>]*>Это не вероятность, а вывод по правилам/);
});

test('итоговая проверка: сверху вывод словами и цветом, под ним тихие цифры по видам; готово — зелёная плашка, нет — янтарная', () => {
  const final = (ready, text) => ({ ready, text, fields: { required: 10, filled: 10, empty: 0, invalid: 0 }, documents: { required: 3, ready: 3 }, confirmations: { required: 2, done: 2 }, signatures: { required: 1, done: 0 } });
  const ok = html(h(review.FinalCheck, { final: final(true, 'Всё готово к подаче.') }));
  assert.match(ok, /bg-success\/10 text-success[^"]*"[^>]*>.*Всё готово к подаче\./s);
  assert.ok(ok.indexOf('Всё готово к подаче.') < ok.indexOf('Итоговая проверка'), 'вывод — раньше подписи «Итоговая проверка»');
  assert.match(text(ok), /Обязательные поля.*10 из 10 · пустых 0/);
  const bad = html(h(review.FinalCheck, { final: final(false, 'Не хватает двух пунктов.') }));
  assert.match(bad, /bg-warn-surface\/50 text-warn-foreground/);
  assert.match(bad, /border-warn\/40/);
});

test('итоговая проверка на «Пакете» (compact): фразы-итога нет — её говорит заголовок «Пакет почти готов»; остаются цифры по видам', () => {
  const final = { ready: false, text: 'Заявка ещё не готова к подаче.', fields: { required: 24, filled: 2, empty: 22, invalid: 0 }, documents: { required: 6, ready: 0 }, confirmations: { required: 1, done: 1 }, signatures: { required: 1, done: 0 } };
  const out = html(h(review.FinalCheck, { final, compact: true }));
  assert.doesNotMatch(text(out), /Заявка ещё не готова к подаче/);
  assert.match(text(out), /Итоговая проверка/);
  assert.match(text(out), /Обязательные поля.*2 из 24 · пустых 22/);
  assert.match(text(out), /Документы.*0 из 6/);
});

test('«Поиск закупок»: с расширением Chrome — кнопка «Найти» ищет здесь, «Открыть в ЕИС» — запасная, закладка в раскрывающемся блоке; без него — подсказка про установку', () => {
  const without = text(html(h(search.TenderSearch, searchProps())));
  assert.match(without, /Расширение для Chrome «Тендекс — поиск закупок в ЕИС»/);
  assert.match(without, /extension\/eis-bridge/);
  assert.match(without, /Найти в ЕИС/);
  assert.doesNotMatch(without, /Загрузка без расширения/);

  const withExt = html(h(search.TenderSearch, searchProps({ extension: { available: true, busy: false, onSearch: () => {} } })));
  const plain = text(withExt);
  assert.match(plain, /Найти\s*Открыть в ЕИС/);
  assert.match(plain, /Расширение ищет в фоне: до трёх страниц ЕИС, до 150 закупок за раз/);
  assert.match(withExt, /<details><summary[^>]*>Загрузка без расширения: закладка или вставка таблицы/);
  assert.doesNotMatch(plain, /Расширение для Chrome «Тендекс/);

  const busy = html(h(search.TenderSearch, searchProps({ extension: { available: true, busy: true, onSearch: () => {} } })));
  assert.match(text(busy), /Ищу в ЕИС…/);
  assert.match(busy, /<button[^>]*disabled[^>]*>.*Ищу в ЕИС…/s);

  const note = text(html(h(search.TenderSearch, searchProps({ extension: { available: true, busy: false, onSearch: () => {} }, importNote: { tone: 'danger', text: 'ЕИС не открылся за 30 секунд.' } }))));
  assert.match(note, /ЕИС не открылся за 30 секунд\./);
});
