// Компоненты экрана, отрисованные на сервере в строку, — npm test в design-system/prototype. Браузер и новые пакеты не нужны:
// файлы .tsx грузит сам Vite (тот же, что собирает экран), React рисует их в разметку, а тест смотрит на роли, подписи
// и безопасность вывода. Окна и фокус (порталы) проверяются в браузере; их логика — в web/src/lib/focus-trap.test.ts.
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
let server;
const mods = {};

// Настройки Vite свои, не из vite.config.ts: тот подменяет React на путь в node_modules (одна копия на экран и общий код),
// а на сервере такая подмена превращает React в «встроенный» модуль, который не запускается. Здесь React берётся обычным
// путём из node_modules экрана — тем же, что и в самом тесте; «@/…» — общий код web/src, как в экране.
before(async () => {
  server = await createServer({
    root,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, fs: { allow: [path.resolve(root, '../..')] } },
    resolve: { alias: [{ find: '@', replacement: path.resolve(root, '../../web/src') }] },
  });
  mods.markdown = await server.ssrLoadModule('/src/components/Markdown.tsx');
  mods.ui = await server.ssrLoadModule('/src/components/ui.tsx');
  mods.upload = await server.ssrLoadModule('/src/components/StepUpload.tsx');
  mods.changed = await server.ssrLoadModule('/src/components/DocsChanged.tsx');
  mods.requirements = await server.ssrLoadModule('/src/components/RequirementsList.tsx');
  mods.evidence = await server.ssrLoadModule('/src/components/EvidenceBase.tsx');
  mods.base = await server.ssrLoadModule('@/lib/evidence-base.ts');
  mods.form = await server.ssrLoadModule('@/lib/evidence-form.ts');
  mods.history = await server.ssrLoadModule('/src/components/BidHistory.tsx');
  mods.pricing = await server.ssrLoadModule('/src/components/StepPricing.tsx');
  mods.analysis = await server.ssrLoadModule('/src/components/StepAnalysis.tsx');
});

after(async () => {
  await server?.close();
});

const html = (element) => renderToStaticMarkup(element);

test('история заявок: только настоящие поданные закупки, без примеров; наши цены суммируются; пустой список — подсказка', () => {
  const base = {
    files: [],
    unreadable: [],
    requirements: {},
    createdAt: '2026-10-01T10:00:00.000Z',
    kind: '44-ФЗ · электронный аукцион',
    deadline: { date: '2026-11-01', time: '10:00', zone: 'МСК' },
  };
  const purchases = [
    { ...base, id: 'a', short: 'Поставка ноутбуков', customer: 'Заказчик Один', price: '1 000 000', submitted: true, tpPrice: 900_000 },
    { ...base, id: 'b', short: 'Услуги уборки', customer: 'Заказчик Два', price: '500 000', submitted: true },
    { ...base, id: 'c', short: 'Черновик закупки', customer: 'Заказчик Три', price: '1', submitted: false },
    { ...base, id: 'd', short: 'Пример закупки', customer: 'Пример', price: '1', submitted: true, sample: true },
  ];
  const out = html(h(mods.history.BidHistory, { purchases }));
  assert.match(out, /Поставка ноутбуков/);
  assert.match(out, /Услуги уборки/);
  assert.doesNotMatch(out, /Черновик закупки/, 'не поданная закупка — не в истории');
  assert.doesNotMatch(out, /Пример закупки/, 'пример — не в истории');
  assert.match(out, /01\.11\.2026/, 'срок подачи выведен датой');
  assert.match(out, /900\D+000/, 'наша цена видна в строке');
  assert.doesNotMatch(out, /Победа|Проигрыш|Место победителя|winnerPrice/i, 'итогов, которых нет, не выдумываем');

  const empty = html(h(mods.history.BidHistory, { purchases: [] }));
  assert.match(empty, /Пока ни одной поданной заявки/);

  const loading = html(h(mods.history.BidHistory, { purchases: null }));
  assert.doesNotMatch(loading, /Пока ни одной поданной заявки/, 'пока закупки не загружены, пустой подсказки ещё нет');
});

test('ответ ассистента: чужой HTML, скрипты и опасные ссылки не попадают на страницу', () => {
  const answer = [
    '**Ответ** [клик](javascript:alert(1)) и [ок](https://zakupki.gov.ru/epz) и [данные](data:text/html;base64,PHNjcmlwdD4=) и [файл](file:///etc/passwd).',
    '',
    'Сырой HTML: <img src=x onerror="alert(2)"> и <script>alert(3)</script> и <a href="javascript:alert(4)">ссылка</a> и <iframe src="https://evil.example"></iframe>.',
    '',
    '| а | <b>б</b> |',
    '|---|---|',
    '| 1 | <u>2</u> |',
  ].join('\n');
  const out = html(h(mods.markdown.Markdown, { text: answer }));
  for (const bad of [/<img/i, /<script/i, /<iframe/i, /<u>/i, /<b>/i, /href="javascript:/i, /href="data:/i, /href="file:/i, /<[^>]*onerror=/i]) {
    assert.doesNotMatch(out, bad, String(bad));
  }
  // Текст ссылок остаётся, сами опасные ссылки — нет; безопасная открывается в новой вкладке и закрыта от страницы.
  assert.match(out, /клик/);
  assert.match(out, /&lt;img src=x onerror=&quot;alert\(2\)&quot;&gt;/);
  assert.match(out, /<a href="https:\/\/zakupki\.gov\.ru\/epz" target="_blank" rel="noreferrer"/);
});

test('ответ ассистента: голый адрес (без разметки [текст](ссылка)) тоже кликабелен; точка в конце предложения — не часть ссылки', () => {
  const out = html(
    h(mods.markdown.Markdown, {
      text: 'Смотрите https://zakupki.gov.ru/epz/order. Ещё источник: https://example.com/a,b — и в скобках (https://example.com/c).',
    }),
  );
  assert.match(out, /<a href="https:\/\/zakupki\.gov\.ru\/epz\/order" target="_blank" rel="noreferrer"/, 'голый адрес стал ссылкой');
  assert.doesNotMatch(out, /href="https:\/\/zakupki\.gov\.ru\/epz\/order\."/, 'точка в конце предложения не ушла в адрес');
  assert.match(out, /order<\/a>\./, 'точка осталась обычным текстом после ссылки');
  assert.match(out, /<a href="https:\/\/example\.com\/a,b"/, 'запятая внутри адреса — часть ссылки, не конец предложения');
  assert.match(out, /<a href="https:\/\/example\.com\/c"/, 'адрес в скобках стал ссылкой без скобки внутри href');
  assert.match(out, /<\/a>\)\.<\/p>/, 'закрывающая скобка и точка остались обычным текстом после ссылки');
});

test('ответ ассистента: разметка по делу — жирный, список, таблица, цитата, код; пустой текст не ломает', () => {
  const out = html(h(mods.markdown.Markdown, { text: '## Итог\n\n**Важно:** `ч. 1 ст. 43`\n\n- первое\n- второе\n\n> цитата закона\n\n| а | б |\n|---|---|\n| 1 | 2 |' }));
  assert.match(out, /<strong[^>]*>Важно:<\/strong>/);
  assert.match(out, /<code[^>]*>ч\. 1 ст\. 43<\/code>/);
  assert.equal((out.match(/<li>/g) ?? []).length, 2);
  assert.match(out, /<blockquote[^>]*>цитата закона<\/blockquote>/);
  assert.match(out, /<table/);
  assert.equal(html(h(mods.markdown.Markdown, { text: '' })), '<div class="space-y-2"></div>');
});

test('ответ ассистента: мусорная разметка на десятки тысяч знаков разбирается быстро (экран не зависает на потоке)', () => {
  const nasty = ['[a'.repeat(15_000), '**'.repeat(15_000), '`'.repeat(30_000), '[a](' + 'b'.repeat(30_000), '_'.repeat(30_000), '| a |\n'.repeat(5000)];
  for (const text of nasty) {
    const started = performance.now();
    html(h(mods.markdown.Markdown, { text }));
    assert.ok(performance.now() - started < 1500, `разбор ${JSON.stringify(text.slice(0, 12))}… занял ${Math.round(performance.now() - started)} мс`);
  }
});

test('подсказка у термина читается с клавиатуры и диктором: фокус, роль, текст', () => {
  const out = html(h(mods.ui.HelpTip, { content: 'НМЦК — начальная цена контракта' }));
  assert.match(out, /tabindex="0"/);
  assert.match(out, /role="img"/);
  assert.match(out, /aria-label="НМЦК — начальная цена контракта"/);
  assert.match(out, /focus-visible:ring-2/, 'у подсказки нет видимого фокуса');
  assert.match(out, /role="tooltip"/);
});

test('иконочная кнопка: имя для диктора и подсказка, а не «кнопка»; не отправляет форму', () => {
  const out = html(h(mods.ui.IconButton, { label: 'Закрыть чат' }, 'x'));
  assert.match(out, /<button[^>]*type="button"[^>]*aria-label="Закрыть чат"|<button[^>]*aria-label="Закрыть чат"[^>]*type="button"/);
  assert.match(out, /role="tooltip"[^>]*>Закрыть чат</);
});

test('галочка: настоящий input внутри подписи — нажимается и по тексту, и с клавиатуры', () => {
  const out = html(h(mods.ui.Checkbox, { checked: true, onChange: () => {} }, 'Документ готов'));
  assert.match(out, /^<label[^>]*><input type="checkbox"[^>]*class="peer sr-only"[^>]*checked=""[^>]*\/>/);
  assert.match(out, /Документ готов<\/span><\/label>$/);
  // Не отмечена — атрибута checked нет.
  assert.doesNotMatch(html(h(mods.ui.Checkbox, { checked: false, onChange: () => {} }, 'x')), /checked=""/);
});

test('кнопка «опасно» не белая на светлом красном: в тёмной теме надпись не читалась', () => {
  const out = html(h(mods.ui.Button, { variant: 'danger' }, 'Удалить'));
  assert.match(out, /bg-danger text-primary-foreground/);
  assert.doesNotMatch(out, /text-white/);
});

test('пометка «ИИ ошибается» читается: не бледнее подписей', () => {
  const out = html(h(mods.ui.AIDisclaimer, {}));
  assert.match(out, /text-muted-foreground/);
  assert.doesNotMatch(out, /text-muted-foreground\/\d+/);
  assert.match(out, /проверяйте документы перед подачей/);
});

const upload = (props = {}) =>
  html(h(mods.upload.StepUpload, { files: [], busy: null, onFiles: () => {}, onNext: () => {}, nextLabel: 'Далее', ...props }));

test('шаг «Загрузка»: ошибка объявляется диктору (role=alert), пометка — вежливо (role=status), без них — тишина', () => {
  const quiet = upload();
  assert.doesNotMatch(quiet, /role="alert"/);
  assert.doesNotMatch(quiet, /role="status"/);
  const failed = upload({ error: 'Сервер не успел ответить — повторите через минуту.', notice: 'Не прочитаны: скан.pdf.' });
  assert.match(failed, /<p role="alert"[^>]*>.*Сервер не успел ответить — повторите через минуту\./);
  assert.match(failed, /<p role="status"[^>]*>.*Не прочитаны: скан\.pdf\./);
});

test('шаг «Загрузка»: у поля ссылки на ЕИС есть имя и пометка «скоро», пока поле не работает', () => {
  const out = upload();
  assert.match(out, /<input disabled="" aria-label="Ссылка на закупку в ЕИС — скоро"/);
  assert.match(out, /скоро/);
});

test('шаг «Загрузка»: длинное имя файла и вредная разметка в имени — только текст в списке', () => {
  const evil = '<img src=x onerror=alert(1)>.pdf';
  const out = upload({ files: [{ name: evil, meta: 'PDF · 10 симв.' }, { name: 'А'.repeat(300) + '.docx', meta: 'DOCX' }] });
  assert.doesNotMatch(out, /<img/i);
  assert.match(out, /&lt;img src=x onerror=alert\(1\)&gt;\.pdf/);
  assert.match(out, /А{300}\.docx/);
});

test('«документы закупки изменились»: что изменилось словами, роль status и кнопка подтверждения', () => {
  const out = html(h(mods.changed.DocsChanged, { changes: { added: ['Изменения.pdf'], removed: [], changed: ['ТЗ.docx'] }, onConfirm: () => {} }));
  assert.match(out, /^<div role="status"/);
  assert.match(out, /Документы закупки изменились после составления ТП/);
  assert.match(out, /добавлен файл «Изменения\.pdf»; изменён файл «ТЗ\.docx»\./);
  assert.match(out, /Пока вы не подтвердите, закупка не считается готовой/);
  assert.match(out, /<button[^>]*>Проверил — всё верно<\/button>/);
});

test('«документы закупки изменились»: вредная разметка и очень длинное имя файла — только текст, перенос по словам', () => {
  const evil = '<img src=x onerror=alert(1)>.pdf';
  const long = 'Д'.repeat(300) + '.docx';
  const out = html(h(mods.changed.DocsChanged, { changes: { added: [evil], removed: [], changed: [long] }, onConfirm: () => {} }));
  assert.doesNotMatch(out, /<img/i);
  assert.match(out, /&lt;img src=x onerror=alert\(1\)&gt;\.pdf/);
  assert.match(out, /Д{300}\.docx/);
  assert.match(out, /break-words/, 'длинное имя без пробелов не должно раздвигать строку');
});

const reqRow = (over = {}) => ({
  id: 'scope-0',
  group: 'scope',
  text: 'Зал от 150 мест',
  mandatory: { text: 'Обязательно', tone: 'neutral' },
  type: 'Работы и услуги',
  conditions: [{ text: 'не менее 150 мест', kind: 'choice' }, { text: 'срок не более 5 рабочих дней', kind: 'term' }],
  deadline: '',
  status: 'open',
  statusText: 'Нужны ваши данные',
  source: 'ТЗ, п. 2.1',
  quote: 'зал вместимостью не менее 150 мест',
  quoteFound: true,
  where: '«ТЗ.docx» — стр. 2, п. 2.1',
  check: 'в предложении участника — вместимость зала: не менее 150 мест',
  evidence: [],
  issues: [],
  ...over,
});
const requirementsList = (rows, props = {}) => html(h(mods.requirements.RequirementsList, { rows, onFix: () => {}, ...props }));

test('требования заказчика: обязательность, тип, числа и статус у каждой строки, группы с числом пунктов', () => {
  const out = requirementsList([
    reqRow(),
    reqRow({ id: 'who-0', group: 'who', text: 'Только малый бизнес', type: 'К участнику', conditions: [], status: 'info', statusText: 'Условие заказчика' }),
  ]);
  assert.match(out, /<h2[^>]*>Требования заказчика<\/h2>/);
  assert.match(out, /aria-pressed="true"[^>]*>Все<span[^>]*>2<\/span>/);
  assert.match(out, />Кто участвует<span[^>]*>1<\/span>/);
  assert.match(out, />ТЗ<span[^>]*>1<\/span>/);
  assert.doesNotMatch(out, />Оценка<span/, 'пустой группы нет');
  assert.match(out, /Обязательно/);
  assert.match(out, /Работы и услуги/);
  assert.match(out, /не менее 150 мест/);
  assert.match(out, /срок не более 5 рабочих дней/);
  assert.match(out, /Нужны ваши данные/);
  assert.match(out, /Ждут ваших данных: 1\./);
  assert.match(out, /aria-expanded="false"/);
});

test('требования заказчика: границу заказчика видно отдельно от предложения участника; пустые места в предложении выделены', () => {
  const out = requirementsList(
    [reqRow({ offer: { text: 'Обеспечим зал на [число, не меньше 150] мест.', note: 'ждёт вашего значения: 1', problems: [] } })],
    { initialOpen: 'scope-0' }
  );
  assert.match(out, /aria-expanded="true"/);
  assert.match(out, /Требует заказчик/);
  assert.match(out, /Предлагаете вы/);
  assert.match(out, /<mark class="highlight">\[число, не меньше 150\]<\/mark>/);
  assert.match(out, /ждёт вашего значения: 1/);
  assert.match(out, /Статус: <\/span>Нужны ваши данные — /, 'на телефоне значок статуса скрыт — слово о статусе есть в раскрытой строке');
  assert.match(out, /Где написано: <\/span>ТЗ, п\. 2\.1/);
  assert.match(out, /Место в файле: <\/span>«ТЗ\.docx» — стр\. 2, п\. 2\.1/);
  assert.match(out, /Как проверят: <\/span>в предложении участника/);
  assert.match(out, /<button[^>]*>Вписать своё значение →<\/button>/);
});

test('требования заказчика: без ТП и без строки в ТП сказано, чего нет; не найденная цитата и сомнения — предупреждением', () => {
  const none = requirementsList([reqRow({ status: 'open', offer: undefined })], { initialOpen: 'scope-0' });
  assert.match(none, /В ТП нет строки по этому требованию/);
  const early = requirementsList([reqRow({ status: 'info', statusText: 'Условие заказчика' })], { initialOpen: 'scope-0' });
  assert.match(early, /ТП ещё не составлено/);
  const doubt = requirementsList(
    [reqRow({ status: 'unverified', statusText: 'Сверьте с документом', quoteFound: false, issues: ['в пункте есть число 7, которого нет в цитате: сверьте с документом'] })],
    { initialOpen: 'scope-0' }
  );
  assert.match(doubt, /цитата не найдена в документах дословно — сверьте вручную/);
  assert.match(doubt, /в пункте есть число 7, которого нет в цитате/);
  assert.match(doubt, /Сверить с документом: 1\./);
  assert.doesNotMatch(requirementsList([reqRow({ status: 'met', statusText: 'Подходит' })], { initialOpen: 'scope-0' }), /Вписать своё значение/);
});

test('требования заказчика: вредная разметка и очень длинный текст — только текст, перенос по словам; пустой список ничего не рисует', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const out = requirementsList(
    [reqRow({ text: evil + 'Д'.repeat(300), quote: evil, source: evil, offer: { text: evil, note: evil, problems: [evil] } })],
    { initialOpen: 'scope-0' }
  );
  assert.doesNotMatch(out, /<img/i);
  assert.match(out, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(out, /Д{300}/);
  assert.match(out, /break-words/);
  assert.equal(requirementsList([]), '');
});

test('требования заказчика: много пунктов — показаны первые, остальные по кнопке', () => {
  const rows = Array.from({ length: 40 }, (_, i) => reqRow({ id: 'scope-' + i, text: 'Требование номер ' + i }));
  const out = requirementsList(rows);
  assert.equal((out.match(/Требование номер /g) ?? []).length, 15);
  assert.match(out, /Показать ещё 15[^<]*\(осталось 25\)/);
  const last = requirementsList(rows.slice(0, 20));
  assert.match(last, /Показать ещё 5(?!\d)/);
  assert.doesNotMatch(last, /осталось/, 'остаток помещается в один шаг — «осталось» не пишем');
});

// ———— База доказательств (раздел «Профиля компании») ————

const ON = '2026-10-02';
const fact = (input, id) => mods.base.makeFact(input, new Date('2026-10-01T10:00:00Z'), id);
const INFO = {
  requisites: { filled: 12, total: 20, sources: ['Карточка предприятия.pdf'], problems: ['ИНН: в номере не хватает цифр'] },
  templates: [
    { label: 'технические предложения', count: 2 },
    { label: 'анкеты', count: 0 },
  ],
};
const evidence = (props = {}) =>
  html(
    h(mods.evidence.EvidenceSection, {
      facts: [],
      docs: [],
      on: ON,
      info: INFO,
      gaps: [],
      busy: false,
      notice: null,
      eligible: 0,
      onFind: () => {},
      onSave: () => {},
      onDelete: () => {},
      onConfirm: () => {},
      ...props,
    }),
  );
// Открывающий тег кнопки, на которой написано text.
const openTag = (out, text) => out.match(new RegExp(`<button[^>]*>(?:(?!</button>)[\\s\\S])*?${text}`))?.[0].match(/^<button[^>]*>/)?.[0];

const baseFacts = () => [
  fact({ kind: 'license', title: 'Лицензия образовательная', fields: { number: 'Л035' }, validity: { until: '2027-05-12' }, source: { type: 'document', docId: 'd1', docName: 'Лицензия.pdf', quote: 'действительна до 12.05.2027', where: 'стр. 1' } }, 'a'),
  fact({ kind: 'certificate', title: 'Сертификат ISO 9001', validity: { until: '2026-10-12' } }, 'b'),
  fact({ kind: 'license', title: 'Допуск СРО', validity: { until: '2026-09-01' } }, 'c'),
  fact({ kind: 'employee', title: 'Иванов И. И., режиссёр', origin: 'ai', source: { type: 'document', docId: 'd2', docName: 'Штат.docx', quote: 'Иванов И. И. — режиссёр' } }, 'd'),
  fact({ kind: 'equipment', title: 'Актовый зал', measures: [{ what: 'вместимость', value: 200, unit: 'мест' }] }, 'e'),
];

test('база доказательств: пустая база подсказывает, что делать; поиск фактов недоступен без документов', () => {
  const out = evidence();
  assert.match(out, /<h2[^>]*>База доказательств<\/h2>/);
  assert.match(out, /База пока пуста/);
  assert.match(out, /Действуют: <b[^>]*>0<\/b>/);
  // Класс кнопки содержит «disabled:…», поэтому смотрим на сам атрибут.
  assert.match(openTag(out, 'Найти факты в документах'), / disabled=""/, 'документов нет — искать негде');
  assert.doesNotMatch(openTag(out, 'Добавить факт'), / disabled=""/, 'добавить вручную можно всегда');
  assert.match(out, /Это запрос к ИИ/, 'перед платным запросом сказано, что он к ИИ');
  assert.doesNotMatch(openTag(evidence({ eligible: 2 }), 'Найти факты в документах'), / disabled=""/);
  const busy = evidence({ eligible: 2, busy: true });
  assert.match(openTag(busy, 'Ищу факты…'), / disabled=""/, 'пока идёт поиск, второй запрос не отправить');
});

test('база доказательств: сначала то, что требует внимания; у каждого факта срок, источник и числа', () => {
  const out = evidence({ facts: baseFacts() });
  const at = (text) => out.indexOf(text);
  assert.ok(at('Допуск СРО') > 0 && at('Допуск СРО') < at('Иванов И. И.'), 'просроченное выше всего');
  assert.ok(at('Иванов И. И.') < at('Сертификат ISO 9001'), 'ждущее подтверждения выше скоро истекающего');
  assert.ok(at('Сертификат ISO 9001') < at('Лицензия образовательная'), 'скоро истекающее выше спокойного');
  assert.match(out, /<h2[^>]*>База доказательств<span[^>]*>5<\/span><\/h2>/);
  assert.match(out, /действует до 12\.05\.2027/);
  assert.match(out, /истекает через 10 дней \(12\.10\.2026\)/);
  assert.match(out, /просрочено: действовало до 01\.09\.2026/);
  assert.match(out, /из «Лицензия\.pdf» — стр\. 1: «действительна до 12\.05\.2027»/, 'документ, место в нём и фраза');
  assert.match(out, /вписано вручную — документа нет/, 'факт без документа назван словами человека');
  assert.match(out, /вместимость: 200 мест/);
  assert.match(out, /Номер: Л035/);
  // Сводка: что действует, что истекает, что просрочено, что ждёт человека.
  assert.match(out, /Действуют: <b[^>]*>1<\/b>/);
  assert.match(out, /Скоро истекут: <b[^>]*>1<\/b>/);
  assert.match(out, /Просрочены: <b[^>]*>1<\/b>/);
  assert.match(out, /Ждут подтверждения: <b[^>]*>1<\/b>/);
  assert.doesNotMatch(out, /Без срока/, 'нулевые счётчики не показываются');
  // Группы с числом фактов, «Все» выбрана; реквизиты и шаблоны — сводкой.
  assert.match(out, /aria-pressed="true"[^>]*>Все<span[^>]*>5<\/span>/);
  assert.match(out, />Лицензии и допуски<span[^>]*>2<\/span>/);
  assert.match(out, />Сотрудники<span[^>]*>1<\/span>/);
  assert.match(out, />Реквизиты<span[^>]*>12<\/span>/);
  assert.match(out, /заполнено 12 из 20/);
  assert.match(out, /из «Карточка предприятия\.pdf»/);
  assert.match(out, /ИНН: в номере не хватает цифр/);
  assert.match(out, /технические предложения — 2/);
  assert.doesNotMatch(out, /анкеты — 0/);
});

test('база доказательств: найденное ИИ — не доказательство, пока человек не подтвердил', () => {
  const ai = baseFacts()[3];
  const out = evidence({ facts: [ai] });
  assert.match(out, /Нашёл ИИ в документе — сверьте с ним и подтвердите/);
  assert.match(out, /Пока не подтверждено, это не доказательство/);
  assert.equal((out.match(/Подтверждаю/g) ?? []).length, 1);
  assert.match(out, /Ждут подтверждения: <b[^>]*>1<\/b>/);
  const done = evidence({ facts: [{ ...ai, confirmed: true }] });
  assert.doesNotMatch(done, /Подтверждаю/);
  assert.doesNotMatch(done, /Ждут подтверждения/);
});

test('база доказательств: группа показывает только свои факты; пустая группа и реквизиты — понятным текстом', () => {
  const licenses = evidence({ facts: baseFacts(), initialFilter: 'license' });
  assert.match(licenses, /Допуск СРО/);
  assert.match(licenses, /Лицензия образовательная/);
  assert.doesNotMatch(licenses, /Сертификат ISO 9001/);
  assert.doesNotMatch(licenses, /Реквизиты компании/);
  assert.doesNotMatch(licenses, /Лицензия или допуск/, 'в группе вид факта повторять не нужно');
  assert.match(evidence({ facts: baseFacts() }), /Лицензия или допуск/, 'в общем списке у факта указан вид');
  assert.match(evidence({ facts: baseFacts(), initialFilter: 'finance' }), /В этой группе пока ничего нет/);
  const requisites = evidence({ facts: baseFacts(), initialFilter: 'requisites' });
  assert.match(requisites, /Реквизиты компании/);
  assert.match(requisites, /правятся выше/);
  assert.doesNotMatch(requisites, /Допуск СРО/);
  const templates = evidence({ facts: baseFacts(), initialFilter: 'templates' });
  assert.match(templates, /Шаблоны и образцы/);
  assert.doesNotMatch(templates, /Допуск СРО/);
  assert.match(evidence({ info: { ...INFO, templates: [] }, initialFilter: 'templates' }), /пока нет — загрузите прошлые заявки/);
});

test('база доказательств: много фактов — первые, остальные по кнопке', () => {
  const facts = Array.from({ length: 40 }, (_, i) => fact({ kind: 'equipment', title: 'Площадка номер ' + i }, 'f' + i));
  const out = evidence({ facts });
  assert.equal((out.match(/Площадка номер /g) ?? []).length, 15);
  assert.match(out, /Показать ещё 15[^<]*\(осталось 25\)/);
  assert.doesNotMatch(evidence({ facts: facts.slice(0, 15) }), /Показать ещё/);
});

test('база доказательств: «что требуют закупки» — требование, статус, причина; добавить можно только факт, а не реквизит', () => {
  const gap = (over = {}) => ({
    key: 'k',
    kind: 'license',
    label: 'Лицензия или членство в СРО',
    status: 'needs_evidence',
    optional: false,
    purchases: [{ id: 'p1', title: 'Праздник' }],
    from: [{ basis: 'Требование к участнику', text: 'Наличие лицензии на образовательную деятельность' }],
    reasons: ['в базе нет лицензии, подходящей к требованию'],
    facts: [],
    ...over,
  });
  const gaps = [
    gap(),
    gap({ key: 'k2', kind: 'experience', label: 'Опыт: исполненные договоры', status: 'need_human', optional: true, purchases: [{ id: 'p1', title: 'Праздник' }, { id: 'p2', title: 'Выставка' }], reasons: ['ИИ нашёл договор, он ждёт вашего подтверждения'] }),
    gap({ key: 'k3', kind: 'requisite', label: 'Реквизиты для анкеты', status: 'needs_evidence', reasons: ['не заполнен ИНН'] }),
    gap({ key: 'k4', label: 'Уже подтверждённое', status: 'ok' }),
  ];
  const out = evidence({ gaps });
  assert.match(out, /Что требуют ваши закупки/);
  assert.match(out, /Нужно внимание: 3 из 4/, 'подтверждённое в список «нужно внимание» не попадает');
  assert.doesNotMatch(out, /Уже подтверждённое/);
  assert.match(out, /Нет доказательства/);
  assert.match(out, /Решает человек/);
  assert.match(out, /в базе нет лицензии, подходящей к требованию/);
  assert.match(out, /Требование к участнику: «Наличие лицензии на образовательную деятельность»/, 'видно, из какого требования взялась потребность');
  assert.match(out, /Закупка: «Праздник»/);
  assert.match(out, /Закупки: «Праздник», «Выставка»/);
  assert.match(out, /по желанию или за баллы/);
  assert.match(out, /ничего не подставляет/, 'подсказка к статусу «нет доказательства» говорит, что значение не придумывается');
  // Кнопка «Добавить в базу» — у «нет доказательства» по лицензии; у «решает человек» и у реквизитов её нет.
  assert.equal((out.match(/Добавить в базу/g) ?? []).length, 1);
  assert.match(evidence({ gaps: [gap({ status: 'ok' })] }), /По закупкам в работе всё подтверждено: 1 требование/);
  assert.match(evidence({ gaps: [] }), /Закупок в работе, которым нужны доказательства, пока нет/);
});

test('база доказательств: результат поиска и ошибки — role=status и role=alert, текст без разметки', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const warn = evidence({ notice: { tone: 'warn', text: evil } });
  assert.match(warn, /role="alert"/);
  assert.doesNotMatch(warn, /<img/i);
  assert.match(warn, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(evidence({ notice: { tone: 'ok', text: 'Нашёл 3 факта' } }), /role="status"[^>]*>.*Нашёл 3 факта/s);
  assert.doesNotMatch(evidence(), /role="alert"|role="status"/);
});

test('факт базы: вредная разметка и очень длинные слова — только текст, перенос по словам; удаление и правка с именем для диктора', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const f = fact({ kind: 'employee', title: evil + 'Д'.repeat(300), origin: 'ai', fields: { position: evil }, source: { type: 'document', docId: 'd', docName: evil, quote: evil } }, 'x');
  const out = html(h(mods.evidence.FactRow, { fact: f, on: ON, showKind: true, onEdit: () => {}, onDelete: () => {}, onConfirm: () => {} }));
  assert.doesNotMatch(out, /<img/i);
  assert.match(out, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(out, /Д{300}/);
  assert.match(out, /break-words/);
  assert.match(out, /aria-label="Изменить"/);
  assert.match(out, /aria-label="Удалить"/);
  assert.doesNotMatch(out, /Удалить факт из базы\?/, 'вопрос об удалении появляется только после нажатия');
});

const docs = [{ id: 'd1', name: 'Лицензия.pdf', text: 'ЛИЦЕНЗИЯ № Л035. Лицензия действительна до 12.05.2027. Выдана 12.05.2022.', kinds: ['license'] }];
const factForm = (draft, props = {}) => html(h(mods.evidence.FactForm, { initial: draft, docs, onSave: () => {}, onCancel: () => {}, ...props }));

test('форма факта: вид выбирается кнопками, у вида свои поля; даты — настоящие поля дат; срок только там, где он бывает', () => {
  const license = factForm(mods.form.emptyDraft('license'));
  assert.match(license, /<form[^>]*aria-label="Новый факт"/);
  assert.match(license, /aria-label="Вид факта"/);
  assert.match(license, /aria-pressed="true"[^>]*>Лицензия или допуск</);
  assert.match(license, /aria-pressed="false"[^>]*>Исполненный договор</);
  assert.match(license, /Кем выдана/);
  assert.match(license, /<input type="date"[^>]*>/);
  assert.match(license, /Срок действия — нужен/);
  assert.match(license, /type="checkbox"[^>]*>\s*Бессрочно/);
  assert.match(license, /Действует до/);
  const contract = factForm(mods.form.emptyDraft('experience'));
  assert.match(contract, /Предмет договора/);
  assert.doesNotMatch(contract, /Срок действия/, 'у договора срока действия нет');
  assert.match(contract, /цена договора, руб\./, 'быстрая кнопка с числом, которое обычно нужно');
  assert.match(factForm(mods.form.emptyDraft('license', { perpetual: true })), /type="checkbox"[^>]*checked=""/);
  assert.doesNotMatch(factForm(mods.form.emptyDraft('license', { perpetual: true })), /Действует до/, 'у бессрочного дат нет');
});

test('форма факта: документ из образцов выбирается из списка; подсказка срока из текста; фразы, которой нет в документе, — предупреждение', () => {
  const draft = mods.form.emptyDraft('license', { title: 'Лицензия', docId: 'd1', quote: 'такой фразы в документе нет' });
  const out = factForm(draft);
  assert.match(out, /<option value="d1"[^>]*>Лицензия\.pdf<\/option>/);
  assert.match(out, /Такой фразы в документе нет/);
  assert.match(out, /В документе есть срок:/);
  assert.match(out, /«действительна до 12\.05\.2027» — подставить/);
  assert.doesNotMatch(factForm({ ...draft, quote: 'Лицензия действительна до 12.05.2027' }), /Такой фразы в документе нет/);
  const manual = factForm(mods.form.emptyDraft('license'));
  assert.match(manual, /Без документа — вписываю сам/);
  assert.match(manual, /Без документа это только ваши слова/);
  assert.doesNotMatch(manual, /В документе есть срок/);
});

test('форма факта: правка — без выбора вида; вредная разметка в имени документа — только текст', () => {
  const f = fact({ kind: 'license', title: 'Лицензия', validity: { until: '2027-05-12' } }, 'a');
  const out = factForm(mods.form.draftOf(f), { editing: f });
  assert.match(out, /aria-label="Правка факта"/);
  assert.doesNotMatch(out, /aria-label="Вид факта"/);
  assert.match(out, /Сохранить/);
  assert.match(out, /value="2027-05-12"/);
  const evil = '<img src=x onerror=alert(1)>';
  const bad = factForm(mods.form.emptyDraft('license'), { docs: [{ ...docs[0], name: evil }] });
  assert.doesNotMatch(bad, /<img/i);
  assert.match(bad, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('форма факта: открытая форма — внутри раздела, над списком', () => {
  const draft = mods.form.emptyDraft('equipment', { title: 'Актовый зал' });
  const out = evidence({ initialForm: { draft } });
  assert.match(out, /aria-label="Новый факт"/);
  assert.ok(out.indexOf('aria-label="Новый факт"') < out.indexOf('Реквизиты компании'));
  assert.doesNotMatch(evidence(), /aria-label="Новый факт"/);
});

test('шаг «Цена»: торг по сумме цен единиц — сумма и цены единиц на выбранном снижении, без нового блока; без режима строк нет', () => {
  const calc = { nmck: 17_000_000, price: 12_750_000, costs: null, extra: null, taxPct: null, guaranteeRatePct: null, days: null, securityPct: 1 };
  const props = { kind: '44-ФЗ · электронный аукцион', calc, set() {}, onPutPrice() {}, notes: [], onNext() {}, onBack() {} };
  // снижение на 25 %: 373 ₽ → 279,75 ₽, цены единиц 173 и 200 — пропорционально, в сумме ровно 279,75
  const on = html(h(mods.pricing.StepPricing, { ...props, unitSum: { start: 373, parts: [173, 200] } }));
  assert.match(on, /Торг: сумма цен единиц/);
  assert.match(on, /279,75 ₽ из 373 ₽/);
  assert.ok(on.includes('129,75 ₽ + 150 ₽'), 'цены единиц: 173 × 0,75 и 200 × 0,75');
  const off = html(h(mods.pricing.StepPricing, props));
  assert.doesNotMatch(off, /Торг: сумма цен единиц|Цены единиц/);
});

test('шаг «Цена»: у единственного поставщика цену называет заказчик — без ползунка, антидемпинга и «поставить цену в заявку»', () => {
  const calc = { nmck: 3_736_000, price: null, costs: 3_000_000, extra: null, taxPct: null, guaranteeRatePct: null, days: null, securityPct: null };
  const props = { kind: '223-ФЗ · закупка у единственного поставщика', calc, set() {}, onPutPrice() {}, notes: [], onNext() {}, onBack() {} };
  const out = html(h(mods.pricing.StepPricing, props));
  assert.match(out, /Цену называет заказчик: торгов и заявки нет./);
  assert.match(out, /3[s ]736[s ]000 ₽/);
  assert.match(out, /названа заказчиком в извещении · торгов нет/);
  assert.match(out, /Что останется вам/);
  assert.match(out, /Дальше →/);
  assert.doesNotMatch(out, /type="range"|Снижение от НМЦК|антидемпинг|Поставить цену в заявку|Вероятность победы|Проверить заявку/i);
  // Обычная закупка — ползунок на месте.
  const usual = html(h(mods.pricing.StepPricing, { ...props, kind: '44-ФЗ · электронный аукцион' }));
  assert.match(usual, /type="range"/);
  assert.match(usual, /Проверить заявку →/);
  // Цены в документах нет — просим вписать, а не рисуем нули.
  const empty = html(h(mods.pricing.StepPricing, { ...props, calc: { ...calc, nmck: null } }));
  assert.match(empty, /Цена в документах не нашлась/);
});

test('шаг «Анализ»: расхождения в цене и «что потребуется после победы» — только когда они найдены, без лишнего', () => {
  const base = { rows: [], requirements: [], kindText: '', platformNote: null, hidden: 0, onNext() {}, onBack() {}, onFix() {} };
  const empty = html(h(mods.analysis.StepAnalysis, base));
  assert.doesNotMatch(empty, /Расхождения в цене|Что потребуется после победы/);

  const out = html(
    h(mods.analysis.StepAnalysis, {
      ...base,
      discrepancies: ['«Расчёт.xls»: строки расчёта дают 2 539 112,20 ₽, а «Итого без НДС» — 2 539 113,20 ₽ (разница 1,00 ₽)'],
      afterWin: {
        duties: [
          { clause: '5.22', term: 'в течение 10 календарных дней с момента заключения договора', text: 'Подрядчик должен предоставить Согласие.', doc: 'Договор.doc' },
          { clause: '5.26', term: 'каждый вторник', text: 'Подрядчик предоставляет информацию о работах.', doc: 'Договор.doc' },
        ],
        more: { count: 7, range: 'п. 5.14–5.20' },
      },
    }),
  );
  assert.match(out, /Расхождения в цене в документах заказчика/);
  assert.match(out, /запросом разъяснений до подачи заявки/);
  assert.match(out, /разница 1,00 ₽/);
  assert.match(out, /Что потребуется после победы/);
  assert.match(out, /п\. 5\.22 · /);
  assert.match(out, /<b[^>]*>каждый вторник<\/b> — Подрядчик предоставляет информацию о работах\./);
  assert.match(out, /Ещё 7 обязанностей предоставить документы без срока — п\. 5\.14–5\.20\./);
  // Одна обязанность без срока — «обязанность», не «обязанностей».
  const one = html(h(mods.analysis.StepAnalysis, { ...base, afterWin: { duties: [], more: { count: 1, range: 'п. 5.1' } } }));
  assert.match(one, /Ещё 1 обязанность предоставить/);
});

test('шаг «Анализ»: карточка «Противоречия в документах заказчика» — кнопка, ход, результат с цитатами, неподтверждённая цитата, устаревание; в примере карточки нет', () => {
  const base = { rows: [], requirements: [], kindText: '', platformNote: null, hidden: 0, onNext() {}, onBack() {}, onFix() {} };
  const card = (over = {}) => ({ result: null, stale: false, running: false, error: '', onRun() {}, ...over });
  const finding = (over = {}) => ({
    kind: 'conflict',
    what: 'п. 10.2 запрещает передачу прав, п. 10.12 разрешает',
    firstQuote: 'Права и обязанности не могут быть переданы третьим лицам',
    firstSource: 'Договор, п. 10.2',
    firstAt: 'Договор.docx — п. 10.2',
    firstVerified: true,
    secondQuote: 'Поставщик вправе уступить права',
    secondSource: 'Договор, п. 10.12',
    secondVerified: false,
    ask: 'Вправе ли поставщик уступить права?',
    ...over,
  });

  assert.doesNotMatch(html(h(mods.analysis.StepAnalysis, base)), /Противоречия в документах заказчика/, 'в примере закупки карточки нет');

  const before = html(h(mods.analysis.StepAnalysis, { ...base, contradictions: card() }));
  assert.match(before, /Противоречия в документах заказчика/);
  assert.match(before, /Платный запрос к ИИ — только по кнопке/);
  assert.match(before, /Найти противоречия/);
  assert.doesNotMatch(before, /Найдено:|Проверить заново/);

  const running = html(h(mods.analysis.StepAnalysis, { ...base, contradictions: card({ running: true }) }));
  assert.match(running, /ИИ читает документы…/);
  assert.match(running, /до двух минут/);
  assert.match(running, /<button[^>]*disabled=""/);

  const failed = html(h(mods.analysis.StepAnalysis, { ...base, contradictions: card({ error: 'На эту заявку потрачен весь бюджет ИИ.' }) }));
  assert.match(failed, /role="alert"[^>]*>[^]*На эту заявку потрачен весь бюджет ИИ\./);

  const done = html(
    h(mods.analysis.StepAnalysis, {
      ...base,
      contradictions: card({ result: { findings: [finding(), finding({ kind: 'unclear', what: 'Срок без даты', secondQuote: '', secondSource: '', firstVerified: true })], docsKey: 'k', checkedAt: '2026-10-19' }, stale: true }),
    }),
  );
  assert.match(done, /Найдено: 1 противоречие, 1 неясность/);
  assert.match(done, />Противоречие</);
  assert.match(done, />Неясность</);
  assert.match(done, /Договор, п\. 10\.2 · Договор\.docx — п\. 10\.2/);
  assert.match(done, /«Права и обязанности не могут быть переданы третьим лицам»/);
  assert.match(done, /Вопрос заказчику:<\/b> Вправе ли поставщик уступить права\?/);
  assert.equal((done.match(/Цитата не найдена в документах дословно/g) ?? []).length, 1, 'помечена только та цитата, которую код не нашёл');
  assert.match(done, /Документы изменились после проверки/);
  assert.match(done, /Проверить заново/);

  const none = html(h(mods.analysis.StepAnalysis, { ...base, contradictions: card({ result: { findings: [], docsKey: 'k', checkedAt: '2026-10-19' } }) }));
  assert.match(none, /Противоречий не найдено/);
});

// ——— Загрузка: главное крупно, бесплатный путь рядом с платным; «Анализ» для закупки без разбора ИИ ———
const plainText = (out) => out.replace(/<[^>]+>/g, ' ').replace(/[  ]/g, ' ').replace(/\s+/g, ' ');

test('шаг «Загрузка»: в распознанной закупке цена и срок — крупно и жирно, закон и заказчик — мелко', () => {
  const out = upload({
    files: [{ name: 'Извещение.docx', meta: 'DOCX' }],
    recognized: { title: 'Поставка угля', facts: [['Закон', '223-ФЗ · аукцион'], ['Начальная цена', '25 930 002 ₽'], ['Подать до', '30 октября 2026'], ['Заказчик', 'МУП «Тепло»']] },
  });
  assert.match(out, /text-lg font-bold[^>]*>Поставка угля/);
  assert.match(out, /text-2xl font-bold[^>]*>25 930 002 ₽/);
  assert.match(out, /text-2xl font-bold[^>]*>30 октября 2026/);
  assert.match(out, /text-\[12px\] text-foreground[^>]*>МУП «Тепло»/);
  assert.match(out, /text-\[12px\] text-foreground[^>]*>223-ФЗ · аукцион/);
});

test('шаг «Загрузка»: рядом с платным ИИ-разбором — бесплатная кнопка «Только аналитика»; недоступна, пока нет файлов и пока идёт работа', () => {
  const none = upload({ alt: { label: 'Только аналитика · бесплатно', onClick: () => {} } });
  assert.match(none, /disabled=""[^>]*>Только аналитика · бесплатно/);
  const ready = upload({ files: [{ name: 'a.docx', meta: 'DOCX' }], alt: { label: 'Только аналитика · бесплатно', onClick: () => {} }, nextLabel: 'Анализировать документы →' });
  assert.doesNotMatch(ready, /disabled=""[^>]*>Только аналитика · бесплатно/);
  assert.match(plainText(ready), /Только аналитика · бесплатно Анализировать документы →/);
  const busy = upload({ files: [{ name: 'a.docx', meta: 'DOCX' }], alt: { label: 'Только аналитика · бесплатно', onClick: () => {} }, busy: 'saving' });
  assert.match(busy, /disabled=""[^>]*>[^<]*<svg[^>]*animate-spin[^>]*>.*Только аналитика · бесплатно/s);
  assert.equal(plainText(upload()).includes('Только аналитика'), false, 'без пути в аналитику кнопки нет');
});

test('шаг «Анализ» без разбора ИИ: карточка «ИИ ещё не разбирал», платная кнопка, пометка «платный запрос ИИ», ошибка объявляется', () => {
  const idle = html(h(mods.analysis.StepNotAnalyzed, { running: false, error: '', onRun: () => {}, onBack: () => {} }));
  const t = plainText(idle);
  assert.match(t, /Анализ документов/);
  assert.match(t, /ИИ ещё не разбирал эту закупку/);
  assert.match(t, /Анализировать документы платный запрос ИИ Назад/);
  assert.doesNotMatch(idle, /role="alert"/);
  const running = html(h(mods.analysis.StepNotAnalyzed, { running: true, error: '', onRun: () => {}, onBack: () => {} }));
  assert.match(running, /disabled=""[^>]*>[^<]*<svg[^>]*animate-spin[^>]*>.*ИИ читает документы…/s);
  const failed = html(h(mods.analysis.StepNotAnalyzed, { running: false, error: 'ИИ не подключён.', onRun: () => {}, onBack: () => {} }));
  assert.match(failed, /<p role="alert"[^>]*>.*ИИ не подключён\./);
});

// ——— Шаг «Цена»: уровни важности ———
const pricingProps = (calcOver = {}, over = {}) => ({
  kind: '44-ФЗ · электронный аукцион',
  calc: { nmck: 1_000_000, price: 800_000, costs: 500_000, extra: 10_000, taxPct: 6, guaranteeRatePct: 3, days: 90, securityPct: 5, ...calcOver },
  set() {},
  onPutPrice() {},
  notes: [],
  onNext() {},
  onBack() {},
  ...over,
});

test('шаг «Цена»: сверху нижняя цена — крупно и зелёным, с прибылью при вашей цене; ваша цена и снижение — ниже, расходы — тише', () => {
  const out = html(h(mods.pricing.StepPricing, pricingProps()));
  const t = plainText(out);
  assert.match(out, /text-3xl font-bold[^"]*text-success[^>]*>[\d\s,]+ ₽/, 'нижняя цена — самая крупная и зелёная');
  assert.match(t, /До какой цены снижаться/);
  assert.match(t, /нижняя цена · −\d+(,\d)?% от НМЦК/);
  assert.match(out, /text-success[^>]*>\s*<svg[^>]*>.*Прибыль при вашей цене:/s);
  assert.match(out, /text-xl font-bold[^>]*>[\d\s,]+ ₽<\/span>/, 'прибыль — крупной цифрой');
  assert.match(t, /Мои расходы/);
  // Нижняя цена стоит раньше ползунка и расходов.
  assert.ok(out.indexOf('До какой цены снижаться') < out.indexOf('type="range"') && out.indexOf('type="range"') < out.indexOf('Мои расходы'));
});

test('шаг «Цена»: убыток при вашей цене — красная плашка и красная цифра; цена выше начальной — отклонят; антидемпинг — коротко, подробности в подсказке', () => {
  const loss = html(h(mods.pricing.StepPricing, pricingProps({ price: 520_000 })));
  assert.match(loss, /border-danger\/40 bg-danger\/5/);
  assert.match(plainText(loss), /Убыток при вашей цене:/);
  assert.match(plainText(loss), /Антидемпинг \(снижение от 25%\): обеспечение исполнения ×1,5, не меньше 10%, или сведения о добросовестности\./);
  assert.match(plainText(loss), /ч\. 1–3 ст\. 37 44-ФЗ/, 'ссылка на закон — в подсказке');
  const above = plainText(html(h(mods.pricing.StepPricing, pricingProps({ price: 1_100_000 }))));
  assert.match(above, /Цена выше начальной — заявку отклонят\./);
  assert.match(above, /Выше начальной цены ставить нельзя/);
});

test('шаг «Цена»: под заголовком одна короткая строка и «расчёт без ИИ»; полный вводный текст и «вероятность победы» — в подсказках', () => {
  const out = html(h(mods.pricing.StepPricing, pricingProps()));
  const t = plainText(out);
  assert.match(t, /Цена расчёт без ИИ/);
  assert.match(t, /Цену подают на торгах — до какой снижаться\./);
  assert.match(t, /На аукционе цену подают во время торгов \(ч\. 2 ст\. 49 44-ФЗ\)\./, 'полный текст — в подсказке');
  assert.match(t, /Вероятность победы не показываем/);
  assert.equal(/<p[^>]*>Вероятность победы не показываем/.test(out), false, 'отдельного абзаца про вероятность победы нет');
  assert.match(plainText(html(h(mods.pricing.StepPricing, pricingProps({}, { kind: '44-ФЗ · запрос котировок' })))), /Цену вы называете в заявке — ниже какой не опускаться\./);
});

test('шаг «Цена»: расходов нет — вместо нижней цены просьба их вписать, плашка нейтральная; расходы открыты', () => {
  const out = html(h(mods.pricing.StepPricing, pricingProps({ costs: null, extra: null, taxPct: null, guaranteeRatePct: null, days: null })));
  assert.match(plainText(out), /Впишите расходы — посчитаем нижнюю цену\./);
  assert.equal(/border-success\/40|border-danger\/40/.test(out), false);
  assert.match(plainText(out), /Себестоимость, ₽/);
});
