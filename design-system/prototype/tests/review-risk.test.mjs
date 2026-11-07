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
let favorites;

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
  favorites = await server.ssrLoadModule('/src/components/Favorites.tsx');
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
  filters: { query: '', law: 'any', priceFrom: null, priceTo: null, publishedFrom: null, publishedTo: null, activeOnly: true, titleOnly: false, customer: '', region: '', method: '', smp: false, withDocs: false, platform: '', daysLeft: null },
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

test('«Поиск закупок»: без выгрузки — фильтры и «Найти в ЕИС»; закупок не выдумываем; загрузка из ЕИС (закладка, вставка, CSV) с экрана убрана 05.11.2026', () => {
  const out = html(h(search.TenderSearch, searchProps()));
  const plain = text(out);
  assert.match(plain, /Поиск закупок/);
  assert.match(plain, /44-ФЗ и 223-ФЗ/);
  assert.match(plain, /Только приём заявок идёт/);
  assert.match(plain, /Найти в ЕИС/);
  assert.doesNotMatch(plain, /Скопировать закупки|Живая лента без выгрузки|Файл CSV|Вставьте таблицу|Загрузить закупки из ЕИС/, 'загрузка из ЕИС скрыта по просьбе владельца');
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
  assert.doesNotMatch(plain, /№ 32616515024/, 'номер — в окне закупки, не в списке');
  assert.doesNotMatch(plain, /Открыть в ЕИС|Открыть на Ростендере|Загрузить документы/, 'в списке этих кнопок нет (владелец, 05.11.2026)');
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
  assert.doesNotMatch(withExt, /Загрузка без расширения|Скопировать закупки/, 'блок загрузки из ЕИС скрыт');
  assert.doesNotMatch(plain, /Расширение для Chrome «Тендекс/);

  const busy = html(h(search.TenderSearch, searchProps({ extension: { available: true, busy: true, onSearch: () => {} } })));
  assert.match(text(busy), /Ищу в ЕИС…/);
  assert.match(busy, /<button[^>]*disabled[^>]*>.*Ищу в ЕИС…/s);

  const note = text(html(h(search.TenderSearch, searchProps({ extension: { available: true, busy: false, onSearch: () => {} }, importNote: { tone: 'danger', text: 'ЕИС не открылся за 30 секунд.' } }))));
  assert.match(note, /ЕИС не открылся за 30 секунд\./);
});

// ——— «Поиск закупок» на Ростендере (05.11.2026) ———
const ROS_LISTING = {
  id: '0873500002326000924', law: '44-ФЗ', title: 'Оказание услуг по праздничному оформлению территорий', customer: 'ГКУ «Дирекция»', price: 13048317.81, publishedAt: '2026-10-28', deadline: '2026-10-29',
  region: 'Москва', method: 'Электронный аукцион (44-ФЗ)', url: 'https://zakupki.gov.ru/epz/order/notice/ea20/view/common-info.html?regNumber=0873500002326000924',
  source: 'rostender', rostenderId: '90210', platform: 'РТС-тендер', stage: 'Подача заявок', smp: true, customerInn: '7751322445',
  contact: { person: 'Иванова А.', phone: '+7 495 000-00-00', email: 'zakaz@example.ru' }, place: 'г. Москва, ул. Тверская, д. 1',
  positions: [{ name: 'Услуги по оформлению', unit: 'усл.', price: 1 }, { name: 'Монтаж', unit: 'шт', price: 2 }, { name: 'Демонтаж', unit: 'шт', price: 3 }, { name: 'Доставка', unit: 'шт', price: 4 }], positionsTotal: 4,
  docs: [{ title: 'Извещение.pdf', link: 'https://rostender.info/files/1', ext: 'pdf', size: 120000 }, { title: 'Проект контракта', link: 'https://rostender.info/files/2', ext: 'docx', size: 3 * 1048576 }],
  archive: 'https://rostender.info/files/90210.zip',
};
const rosUi = (over = {}) => ({ configured: true, updatedAt: '2026-11-05T09:30:00Z', total: 690, ...over });

test('«Поиск закупок» на Ростендере: ручной загрузки нет — ни шаблонов, ни «Загрузить подборку», ни выбора 20/30/50; ключ в окне не вводится', () => {
  const out = html(h(search.TenderSearch, searchProps({ rostender: rosUi() })));
  const t = text(out);
  for (const word of ['Загрузить подборку', 'Шаблон поиска', 'Сколько разных закупок взять', 'Ростендер — карточки с документами', 'осталось запросов']) assert.doesNotMatch(t, new RegExp(word), `«${word}» с экрана убрано`);
  assert.equal(/<input[^>]*(api|key|ключ)/i.test(out), false, 'поля для ключа нет');
});

test('«Поиск закупок» на Ростендере: строка о том, что закупки обновляются сами раз в сутки, когда обновлено и сколько действующих', () => {
  const t = text(html(h(search.TenderSearch, searchProps({ rostender: rosUi() }))));
  assert.match(t, /Закупки обновляются автоматически раз в сутки/);
  assert.match(t, /обновлено \d\d\.\d\d, \d\d:\d\d/);
  assert.match(t, /690 действующих закупок/);
  const first = text(html(h(search.TenderSearch, searchProps({ rostender: rosUi({ total: 0, updatedAt: null }) }))));
  assert.match(first, /первая загрузка ещё идёт/);
  const none = text(html(h(search.TenderSearch, searchProps({ rostender: rosUi({ configured: false, total: 0, updatedAt: null }) }))));
  assert.match(none, /Автообновление закупок не настроено/);
  assert.match(none, /ROSTENDER_API_KEY=ключ/);
  assert.match(none, /web\/\.env\.local/);
  assert.doesNotMatch(none, /Загрузить подборку/);
});

test('«Поиск закупок» на Ростендере: итог по загруженному — сколько документов и гигабайт; файлы не скачиваются; «Очистить выгрузку» только у выгрузки из ЕИС', () => {
  const result = { items: [ROS_LISTING], total: 1, hiddenNoPrice: 0, hiddenNoDate: 0 };
  const t = text(html(h(search.TenderSearch, searchProps({ result, onClear: undefined, rostender: rosUi({ totals: { cards: 200, cardsBytes: 900 * 1024, docs: 1500, docsBytes: 2.5 * 1073741824, docsNoSize: 4 } }) }))));
  assert.match(t, /документов 1500 \(\s*2,50 ГБ\s*, у 4 размер не назван\)/);
  assert.match(t, /сами файлы не скачиваются, пока вы их не откроете/);
  assert.doesNotMatch(t, /Очистить выгрузку/, 'закупки сервера очистить нельзя — без onClear кнопки нет');
  assert.match(text(html(h(search.TenderSearch, searchProps({ result, onClear: noop })))), /Очистить выгрузку/);
});

test('каждая закупка — отдельная карточка: свой блок со скруглением и рамкой, между ними промежуток, а не одна общая рамка со строками', () => {
  const result = { items: [ROS_LISTING, { ...ROS_LISTING, id: '2', title: 'Вторая закупка' }, { ...ROS_LISTING, id: '3', title: 'Третья закупка' }], total: 3, hiddenNoPrice: 0, hiddenNoDate: 0 };
  const out = html(h(search.TenderSearch, searchProps({ result, hasRostender: true })));
  const list = out.slice(out.indexOf('<ul class="space-y-4">'));
  assert.ok(out.includes('<ul class="space-y-4">'), 'список с промежутком между карточками');
  const rows = list.split('<li class="relative">').slice(1);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    const head = row.slice(0, 400);
    assert.match(head, /^<button type="button"/, 'вся карточка нажимается и открывает окно');
    assert.match(head, /class="[^"]*\brounded-xl\b[^"]*"/);
    assert.match(head, /class="[^"]*\bbg-card\b[^"]*"/);
    assert.match(head, /class="[^"]*\bborder\b[^"]*"/, 'каждая закупка лежит в своей карточке');
  }
  assert.doesNotMatch(out, /border-b border-border px-4 py-3 last:border-0/, 'строк-разделителей внутри общей рамки нет');
});

test('закупка в списке — компактная карточка: заголовок крупнее, цена, закон и МСП, заказчик, срок, регион, число документов; контактов, позиций, ссылок и кнопок нет', () => {
  const result = { items: [ROS_LISTING], total: 1, hiddenNoPrice: 0, hiddenNoDate: 0 };
  const out = html(h(search.TenderSearch, searchProps({ result, hasRostender: true })));
  const li = out.slice(out.indexOf('<ul class="space-y-4">'));
  const t = text(li);
  assert.match(li, /class="[^"]*\btext-subtitle\b[^"]*\bfont-semibold\b[^"]*"[^>]*>Оказание услуг/, 'заголовок крупнее прежнего');
  assert.match(t, /13 048 318 ₽/);
  assert.match(t, /44-ФЗ/);
  assert.match(t, /для МСП/);
  assert.match(t, /ГКУ «Дирекция»/);
  assert.match(t, /заявки до 29\.10\.2026 · осталось 2 дня/);
  assert.match(t, /Москва/);
  assert.match(t, /2 документа/);
  for (const word of ['ИНН', 'Место поставки', 'Позиции', 'Иванова', 'Скачать всё архивом', 'Открыть', 'Загрузить документы', 'РТС-тендер', 'Подача заявок']) assert.doesNotMatch(t, new RegExp(word), `«${word}» — только в окне закупки`);
  assert.doesNotMatch(li, /href=/, 'в карточке списка ссылок нет — она сама открывает окно');
});

test('окно закупки: шапка, цена и срок плитками, позиции с кодами, паспорт закупки, что учесть, контакты, документы со ссылками и архив', () => {
  const l = { ...ROS_LISTING, deadlineTime: '15:30', city: 'Москва город', branches: ['Услуги связи'], rev: 2, positions: [{ name: 'Услуги по оформлению', unit: 'мес', price: null, quantity: 12, okpd2: '61.10.30.190', ktru: '61.10.30.190-00000317' }, { name: 'Монтаж', unit: 'шт', price: 2, quantity: null, okpd2: null, ktru: null }], positionsTotal: 5 };
  const out = html(h(search.TenderDetails, { l, today: '2026-10-27' }));
  const t = text(out);
  assert.match(t, /Оказание услуг по праздничному оформлению территорий/);
  assert.match(t, /13 048 318 ₽/);
  for (const word of ['44-ФЗ', 'Электронный аукцион', 'для МСП', 'РТС-тендер', 'Подача заявок']) assert.match(t, new RegExp(word));
  assert.match(t, /ГКУ «Дирекция» · ИНН 7751322445/);
  assert.match(t, /Начальная цена[\s\S]*13 048 318 ₽/);
  assert.match(t, /Подача заявок до[\s\S]*29\.10\.2026[\s\S]*15:30 \(МСК\)[\s\S]*осталось 2 дня/);
  assert.match(t, /Паспорт закупки/);
  assert.match(t, /Номер закупки/);
  assert.match(t, /Способ закупки[\s\S]*Электронный аукцион/);
  assert.match(t, /Размещено[\s\S]*28\.10\.2026/);
  assert.match(t, /Регион[\s\S]*Москва/);
  assert.match(t, /Место поставки[\s\S]*Москва город · г\. Москва, ул\. Тверская, д\. 1/);
  assert.match(t, /Отрасль[\s\S]*Услуги связи/);
  assert.match(t, /Что учесть/);
  assert.match(t, /До конца приёма 2 дня/, 'срок подходит к концу — об этом сказано');
  assert.match(t, /Закупка для МСП: участвовать могут только субъекты/);
  assert.match(t, /В закупке 2 документа/);
  assert.match(t, /Иванова А\./);
  assert.match(out, /href="tel:\+74950000000"/);
  assert.match(out, /href="mailto:zakaz@example\.ru"/);
  assert.match(t, /Позиции · 5/);
  assert.match(t, /Услуги по оформлению[\s\S]*12 мес/);
  assert.match(t, /ОКПД2 61\.10\.30\.190 КТРУ 61\.10\.30\.190-00000317/, 'коды — плашками рядом с позицией');
  assert.match(t, /Монтаж[\s\S]*шт · 2 ₽/);
  assert.match(t, /и ещё 3 — полный список в документах закупки/);
  assert.match(t, /Документы · 2/);
  assert.match(out, /href="https:\/\/rostender\.info\/files\/90210\.zip"[^>]*rel="noopener noreferrer"/, 'архив одним файлом');
  assert.match(out, /href="https:\/\/rostender\.info\/files\/1"/, 'документы раскрыты сразу, со ссылками');
});

test('окно закупки из ЕИС: только то, что есть в выгрузке, пустых блоков нет', () => {
  const l = { id: '32616515024', law: '223-ФЗ', title: 'Разработка проектной документации', customer: 'ПАО «Россети»', price: 3304140, publishedAt: '2026-10-27', deadline: '2026-10-29', region: null, method: 'Иной способ', url: null };
  const t = text(html(h(search.TenderDetails, { l, today: '2026-10-27' })));
  assert.match(t, /Подача заявок до[\s\S]*29\.10\.2026[\s\S]*осталось 2 дня/);
  assert.match(t, /Паспорт закупки[\s\S]*Номер закупки[\s\S]*32616515024/);
  for (const word of ['Контакты заказчика', 'Позиции', 'Документы', 'Отрасль', 'Место поставки', 'Регион']) assert.doesNotMatch(t, new RegExp(word), `«${word}» — пусто, не показываем`);
});


test('фильтры под Ростендер: «Коммерческие», срок, только МСП, только с документами и выпадающие списки региона, способа и площадки — только когда в выгрузке есть такие закупки', () => {
  const facets = { regions: [{ value: 'Москва', count: 5 }, { value: 'Тверская область', count: 2 }], methods: [{ value: 'Электронный аукцион', count: 4 }, { value: 'Конкурс', count: 3 }], platforms: [{ value: 'РТС-тендер', count: 3 }, { value: 'ЕИС', count: 4 }] };
  const plain = text(html(h(search.TenderSearch, searchProps())));
  for (const word of ['Коммерческие', 'Только для малого и среднего бизнеса', 'Только с документами', 'Сегодня последний день', 'Ещё 3 дня', 'Ещё неделя', 'Площадка']) assert.doesNotMatch(plain, new RegExp(word), `без Ростендера «${word}» не показываем`);
  const out = html(h(search.TenderSearch, searchProps({ facets, hasRostender: true, filters: { ...searchProps().filters, smp: true, daysLeft: 3, platform: 'ЕИС', region: 'Москва' } })));
  const t = text(out);
  for (const word of ['Коммерческие', 'Только для малого и среднего бизнеса', 'Только с документами', 'Сегодня последний день', 'Ещё 3 дня', 'Ещё неделя', 'Регион', 'Способ закупки', 'Площадка']) assert.match(t, new RegExp(word), word);
  assert.match(t, /Все регионы[\s\S]*Москва · 5[\s\S]*Тверская область · 2/);
  assert.match(t, /Электронный аукцион · 4/);
  assert.match(t, /ЕИС · 4/);
  assert.match(t, /Москва/);
});

test('сердечко на карточке: в списке — «В избранное», в избранном заполнено «Убрать из избранного»; кнопка не вложена в кнопку-карточку; без favorites сердечек нет', () => {
  const l = { ...ROS_LISTING, deadline: '2026-10-29' };
  const result = { items: [l], total: 1, hiddenNoPrice: 0, hiddenNoDate: 0 };
  const plain = html(h(search.TenderSearch, searchProps({ result, hasRostender: true })));
  assert.doesNotMatch(plain, /В избранное|Убрать из избранного/, 'без избранного сердечек нет');
  const off = html(h(search.TenderSearch, searchProps({ result, hasRostender: true, favorites: { has: () => false, toggle: () => {} } })));
  assert.match(off, /aria-label="В избранное"[^>]*aria-pressed="false"|aria-pressed="false"[^>]*aria-label="В избранное"/);
  const on = html(h(search.TenderSearch, searchProps({ result, hasRostender: true, favorites: { has: () => true, toggle: () => {} } })));
  assert.match(on, /aria-label="Убрать из избранного"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Убрать из избранного"/);
  assert.match(on, /fill-primary/, 'в избранном сердечко закрашено');
  const li = on.slice(on.indexOf('<ul class="space-y-4">'));
  const card = li.slice(li.indexOf('<button'), li.indexOf('</button>') + 9);
  assert.doesNotMatch(card.slice(7), /<button/, 'внутри кнопки-карточки других кнопок нет');
});

test('«Избранное»: пусто — подсказка и кнопка к поиску; есть закупки — те же карточки с закрашенным сердечком, число и «новые сверху»; пока не прочитано — ожидание', () => {
  const noop = () => {};
  const empty = text(html(h(favorites.Favorites, { items: [], ready: true, today: '2026-10-27', onToggle: noop, onSearch: noop })));
  assert.match(empty, /Избранное/);
  assert.match(empty, /В избранном пока пусто/);
  assert.match(empty, /Нажмите сердечко на карточке закупки в «Поиске закупок»/);
  assert.match(empty, /Перейти к поиску закупок/);
  const wait = text(html(h(favorites.Favorites, { items: [], ready: false, today: '2026-10-27', onToggle: noop, onSearch: noop })));
  assert.match(wait, /Читаю избранное/);
  assert.doesNotMatch(wait, /пока пусто/, 'пока не прочитано — не говорим, что пусто');
  const items = [{ listing: ROS_LISTING, addedAt: '2026-10-27T10:00:00Z' }, { listing: { ...ROS_LISTING, id: '2', title: 'Поставка бумаги' }, addedAt: '2026-10-26T10:00:00Z' }];
  const out = html(h(favorites.Favorites, { items, ready: true, today: '2026-10-27', onToggle: noop, onSearch: noop }));
  const t = text(out);
  assert.match(t, /2 закупки · новые сверху/);
  assert.match(t, /Оказание услуг по праздничному оформлению территорий/);
  assert.match(t, /Поставка бумаги/);
  assert.equal((out.match(/aria-label="Убрать из избранного"/g) ?? []).length, 2, 'у каждой карточки сердечко закрашено');
});
