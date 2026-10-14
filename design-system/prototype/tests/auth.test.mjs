// Экраны входа и блок «Выйти» в меню, отрисованные в разметку, — npm test в design-system/prototype.
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
let server;
let screens;
let sidebar;
let account;
let passwordInput;

before(async () => {
  server = await createServer({
    root,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, fs: { allow: [path.resolve(root, '../..')] } },
    resolve: { alias: [{ find: '@', replacement: path.resolve(root, '../../web/src') }] },
  });
  screens = await server.ssrLoadModule('/src/components/AuthScreens.tsx');
  sidebar = await server.ssrLoadModule('/src/components/Sidebar.tsx');
  account = await server.ssrLoadModule('/src/lib/account.ts');
  passwordInput = await server.ssrLoadModule('/src/components/PasswordInput.tsx');
});

after(async () => {
  await server?.close();
});

const html = (element) => renderToStaticMarkup(element);
const noop = () => {};

test('вход: поля «Почта» и «Пароль» с подписями, кнопка «Войти»; пароль скрыт; без почты и пароля кнопка закрыта', () => {
  const out = html(h(screens.LoginScreen, { onSubmit: noop, busy: false, error: null }));
  assert.match(out, /<h1[^>]*>Вход<\/h1>/);
  assert.match(out, /<label for="auth-email"[^>]*>Почта<\/label>/);
  assert.match(out, /<input id="auth-email" type="email" autoComplete="username"/);
  assert.match(out, /<label for="auth-password"[^>]*>Пароль<\/label>/);
  assert.match(out, /<input id="auth-password"[^>]*type="password"/, 'пароль по умолчанию скрыт');
  assert.match(out, /<input id="auth-password"[^>]*autoComplete="current-password"/);
  assert.match(out, /<button[^>]*disabled=""[^>]*>Войти<\/button>/, 'пока ничего не введено — «Войти» недоступна');
});

test('вход: у поля пароля глазик («Показать пароль», не нажат), под ним — «Забыли пароль?»', () => {
  const out = html(h(screens.LoginScreen, { onSubmit: noop, onForgot: noop, busy: false, error: null }));
  assert.match(out, /<button[^>]*aria-label="Показать пароль"[^>]*aria-pressed="false"/);
  assert.match(out, /<button type="button"[^>]*>Забыли пароль\?<\/button>/);
  assert.equal(/попросите владельца/.test(out), false, 'старой отсылки к владельцу больше нет');
});

test('пароль-поле с глазиком: тот же input, подпись и autoComplete на месте; глазик не отправляет форму (type="button")', () => {
  const out = html(h(passwordInput.PasswordInput, { id: 'x', autoComplete: 'new-password', className: 'base', value: 'секрет', onChange: noop }));
  assert.match(out, /<input id="x"[^>]*autoComplete="new-password"[^>]*type="password"[^>]*class="base pr-11"/);
  assert.match(out, /<button type="button" aria-label="Показать пароль"[^>]*aria-pressed="false"/);
});

test('«забыли пароль»: ввод почты → «Отправить ссылку»; ответ «письмо ушло» — «Проверьте почту»; почта не настроена — прямо об этом', () => {
  const form = html(h(screens.ForgotScreen, { onSubmit: noop, onBack: noop, onAgain: noop, busy: false, error: null, result: null }));
  assert.match(form, /<h1[^>]*>Забыли пароль\?<\/h1>/);
  assert.match(form, /<input id="auth-forgot-email" type="email"/);
  assert.match(form, /<button[^>]*disabled=""[^>]*>Отправить ссылку<\/button>/, 'без почты кнопка закрыта');
  assert.match(form, />К входу<\/button>/);
  const failed = html(h(screens.ForgotScreen, { onSubmit: noop, onBack: noop, onAgain: noop, busy: false, error: 'Слишком много запросов — попробуйте через 7 мин.', result: null }));
  assert.match(failed, /<p role="alert"[^>]*>Слишком много запросов/);

  const sent = html(h(screens.ForgotScreen, { onSubmit: noop, onBack: noop, onAgain: noop, busy: false, error: null, result: { mail: true } }));
  assert.match(sent, /<h1[^>]*>Проверьте почту<\/h1>/);
  assert.match(sent, /Если аккаунт с адресом/, 'не утверждает, что аккаунт есть');
  assert.match(sent, />Другая почта<\/button>/);
  assert.match(sent, />К входу<\/button>/);

  const off = html(h(screens.ForgotScreen, { onSubmit: noop, onBack: noop, onAgain: noop, busy: false, error: null, result: { mail: false } }));
  assert.match(off, /<h1[^>]*>Письмо не уйдёт<\/h1>/);
  assert.match(off, /role="alert"/, 'предупреждение читается диктором');
  assert.match(off, /Новую ссылку для входа может выдать владелец сервиса/);
  assert.equal(/Другая почта/.test(off), false, 'повторять бессмысленно, пока почта не настроена');
});

test('вход: ошибка сервера показана как предупреждение (role="alert"), сообщение о задании пароля — спокойным текстом', () => {
  const failed = html(h(screens.LoginScreen, { onSubmit: noop, busy: false, error: 'Неверный email или пароль' }));
  assert.match(failed, /<p role="alert"[^>]*>Неверный email или пароль<\/p>/);
  const ok = html(h(screens.LoginScreen, { onSubmit: noop, busy: false, error: null, notice: 'Пароль задан. Войдите по почте и этому паролю.' }));
  assert.match(ok, /Пароль задан\. Войдите по почте и этому паролю\./);
  assert.equal(/role="alert"/.test(ok), false);
});

test('пароль по ссылке: приглашение — «Задайте пароль», сброс — «Новый пароль»; два поля пароля и кнопка «К входу»', () => {
  const invite = html(h(screens.SetPasswordScreen, { mode: 'invite', onSubmit: noop, onCancel: noop, busy: false, error: null }));
  assert.match(invite, /<h1[^>]*>Задайте пароль<\/h1>/);
  assert.match(invite, /<input id="auth-new"[^>]*autoComplete="new-password"[^>]*type="password"/);
  assert.match(invite, /<input id="auth-again"[^>]*autoComplete="new-password"[^>]*type="password"/);
  assert.equal((invite.match(/aria-label="Показать пароль"/g) ?? []).length, 2, 'глазик у каждого из двух полей');
  assert.match(invite, /Не короче 8 знаков/);
  assert.match(invite, />К входу<\/button>/);
  const reset = html(h(screens.SetPasswordScreen, { mode: 'reset', onSubmit: noop, onCancel: noop, busy: false, error: 'срок действия приглашения истёк' }));
  assert.match(reset, /<h1[^>]*>Новый пароль<\/h1>/);
  assert.match(reset, /<p role="alert"[^>]*>срок действия приглашения истёк<\/p>/);
});

test('ожидание: «Проверяем вход…»; если сервер не ответил — причина и кнопка «Повторить»', () => {
  assert.match(html(h(screens.AuthWait, { error: null, onRetry: noop })), /Проверяем вход…/);
  const failed = html(h(screens.AuthWait, { error: 'Нет связи с сервером — проверьте интернет.', onRetry: noop }));
  assert.match(failed, /Нет связи с сервером — проверьте интернет\./);
  assert.match(failed, />Повторить<\/button>/);
});

const sidebarProps = { view: 'tenders', onNavigate: noop, onNewTender: noop, onOpenChat: noop, dark: false, setDark: noop, notices: [], onOpenNotice: noop, credits: 0, company: { name: '', inn: '' } };

test('меню: у вошедшего показаны почта и «Выйти»; без входа (закупки в браузере) этого блока нет', () => {
  const withAccount = html(h(account.AccountContext.Provider, { value: { email: 'owner@example.com', logout: noop } }, h(sidebar.Sidebar, sidebarProps)));
  assert.match(withAccount, /owner@example\.com/);
  assert.match(withAccount, /Выйти/);
  const without = html(h(sidebar.Sidebar, sidebarProps));
  assert.equal(/Выйти/.test(without), false);
});

test('меню: тема — значком в шапке (рядом с будущими уведомлениями), а не строкой внизу; компания и вход — одна карточка', () => {
  const out = html(h(account.AccountContext.Provider, { value: { email: 'owner@example.com', logout: noop } }, h(sidebar.Sidebar, { ...sidebarProps, company: { name: 'ИП Щурова', inn: '' } })));
  // Тема: значок с подписью «Тёмная тема» стоит раньше кнопки «Новая закупка», а строки «Тёмная тема» внизу карточки нет.
  const aside = out.slice(out.indexOf('<aside'));
  assert.match(aside, /aria-label="Тёмная тема"/);
  assert.ok(aside.indexOf('aria-label="Тёмная тема"') < aside.indexOf('Новая закупка'), 'значок темы — в шапке, выше всего остального');
  assert.equal((aside.match(/Тёмная тема/g) ?? []).length, 2, 'только значок и его подсказка, без отдельной строки внизу');
  // Компания, почта и «Выйти» — внутри одной рамки.
  const card = aside.slice(aside.indexOf('overflow-hidden rounded-md border border-border'));
  assert.ok(card.indexOf('ИП Щурова') > 0 && card.indexOf('ИП Щурова') < card.indexOf('owner@example.com') && card.indexOf('owner@example.com') < card.indexOf('Выйти'));
  assert.equal((aside.match(/overflow-hidden rounded-md border border-border/g) ?? []).length, 1, 'одна карточка, а не две');
  const light = html(h(sidebar.Sidebar, { ...sidebarProps, dark: true }));
  assert.match(light.slice(light.indexOf('<aside')), /aria-label="Светлая тема"/);
});

test('меню: пункта «Профиль компании» в списке нет (дублировал карточку компании), есть «Настройки»; карточка компании остаётся входом в профиль', () => {
  const out = html(h(sidebar.Sidebar, { ...sidebarProps, company: { name: 'ИП Щурова', inn: '' } }));
  const aside = out.slice(out.indexOf('<aside'));
  assert.equal((aside.match(/Профиль компании/g) ?? []).length, 0, 'ни пункта, ни подписи «Профиль компании» в меню');
  assert.match(aside, />Настройки</);
  assert.match(aside, />Тарифы</);
  assert.match(aside, /ИП Щурова/);
  const onProfile = html(h(sidebar.Sidebar, { ...sidebarProps, view: 'profile' }));
  assert.match(onProfile.slice(onProfile.indexOf('<aside')), /aria-current="page"[^>]*class="[^"]*bg-secondary/, 'открыт профиль — карточка компании подсвечена');
});
