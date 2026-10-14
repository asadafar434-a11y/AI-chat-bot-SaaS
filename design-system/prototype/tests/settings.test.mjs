// Раздел «Настройки», отрисованный в разметку, — npm test в design-system/prototype.
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
let server;
let settings;
let account;
let profile;

before(async () => {
  server = await createServer({
    root,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, fs: { allow: [path.resolve(root, '../..')] } },
    resolve: { alias: [{ find: '@', replacement: path.resolve(root, '../../web/src') }] },
  });
  settings = await server.ssrLoadModule('/src/components/Settings.tsx');
  account = await server.ssrLoadModule('/src/lib/account.ts');
  profile = await server.ssrLoadModule('/src/components/Profile.tsx');
});

after(async () => {
  await server?.close();
});

const html = (element) => renderToStaticMarkup(element);
const noop = () => {};
const withAccount = (el) => h(account.AccountContext.Provider, { value: { email: 'owner@example.com', logout: noop } }, el);

test('настройки: аккаунт (почта, «Сменить пароль», «Выйти»), внешний вид (две кнопки темы), копия данных и удаление', () => {
  const out = html(withAccount(h(settings.Settings, { dark: false, setDark: noop })));
  assert.match(out, /<h1[^>]*>Настройки<\/h1>/);
  assert.match(out, />Аккаунт</);
  assert.match(out, /owner@example\.com/);
  assert.match(out, /Сменить пароль/);
  assert.match(out, /Выйти/);
  assert.match(out, /role="group" aria-label="Тема"/);
  assert.match(out, /aria-pressed="true"[^>]*>(?:<svg[\s\S]*?<\/svg>)Светлая</, 'светлая тема нажата');
  assert.match(out, /aria-pressed="false"[^>]*>(?:<svg[\s\S]*?<\/svg>)Тёмная</);
  assert.match(out, />Копия данных</);
  assert.match(out, /Сохранить копию/);
  assert.match(out, /Загрузить копию/);
  assert.match(out, />Удалить все данные</);
  assert.match(out, /Удалить все мои данные/);
});

test('настройки: форма смены пароля скрыта, пока не нажали «Сменить пароль»; удаление без подтверждения ничего не делает', () => {
  const out = html(withAccount(h(settings.Settings, { dark: true, setDark: noop })));
  assert.equal(/id="pw-current"/.test(out), false, 'пока форма закрыта — полей пароля нет');
  assert.match(out, /aria-expanded="false"/);
  assert.equal(/Удалить всё\?/.test(out), false, 'вопрос «Удалить всё?» появится только после нажатия');
  assert.match(out, /aria-pressed="true"[^>]*>(?:<svg[\s\S]*?<\/svg>)Тёмная</, 'в тёмной теме нажата «Тёмная»');
});

test('настройки: без входа (закупки только в браузере) карточки «Аккаунт» нет, остальное на месте', () => {
  const out = html(h(settings.Settings, { dark: false, setDark: noop }));
  assert.equal(/>Аккаунт</.test(out), false);
  assert.match(out, /Внешний вид/);
  assert.match(out, /Копия данных/);
});

test('профиль компании: вкладки «Реквизиты», «База доказательств», «Образцы и документы»; вкладки «Данные» больше нет — она в «Настройках»', () => {
  const out = html(h(profile.Profile));
  assert.match(out, /Реквизиты/);
  assert.match(out, /База доказательств/);
  assert.match(out, /Образцы и документы/);
  assert.equal(/role="tab"[^>]*>[^<]*Данные</.test(out), false);
  assert.equal(/Сохранить копию|Удалить все мои данные/.test(out), false, 'копия и удаление ушли из профиля');
});
