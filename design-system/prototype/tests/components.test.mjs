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
