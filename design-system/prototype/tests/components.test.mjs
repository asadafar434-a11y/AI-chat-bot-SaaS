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
  mods.requirements = await server.ssrLoadModule('/src/components/RequirementsList.tsx');
});

after(async () => {
  await server?.close();
});

const html = (element) => renderToStaticMarkup(element);

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
