// Двухфакторный вход на экране: второй шаг при входе, настройка в «Настройках», запасные коды — npm test в design-system/prototype.
import assert from 'node:assert/strict';
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
  mods.auth = await server.ssrLoadModule('/src/components/AuthScreens.tsx');
  mods.card = await server.ssrLoadModule('/src/components/TwoFactorCard.tsx');
  mods.settings = await server.ssrLoadModule('/src/components/Settings.tsx');
  mods.account = await server.ssrLoadModule('/src/lib/account.ts');
});

after(async () => {
  await server?.close();
});

const html = (element) => renderToStaticMarkup(element);
const noop = () => {};

test('вход, второй шаг: поле кода из приложения, подсказка про одноразовый код, «запасной код» и «Назад»', () => {
  const out = html(h(mods.auth.CodeScreen, { onSubmit: noop, onBack: noop, busy: false, error: null }));
  assert.ok(out.includes('Код подтверждения'));
  assert.ok(out.includes('autoComplete="one-time-code"') || out.includes('autocomplete="one-time-code"'), 'телефон сам подставит код из СМС и менеджера паролей');
  assert.ok(out.includes('inputMode="numeric"') || out.includes('inputmode="numeric"'), 'на телефоне — цифровая клавиатура');
  assert.ok(out.includes('Нет телефона? Запасной код'));
  assert.ok(out.includes('Назад'));
  assert.ok(/<button[^>]*type="submit"[^>]*disabled/.test(out), 'пока код не введён — «Войти» недоступно');
  const failed = html(h(mods.auth.CodeScreen, { onSubmit: noop, onBack: noop, busy: false, error: 'Код не подошёл.' }));
  assert.ok(failed.includes('role="alert"') && failed.includes('Код не подошёл.'));
});

test('настройка: QR и ключ группами по четыре, поле первого кода, «Подтвердить и включить» недоступно без кода', () => {
  assert.equal(mods.card.spacedSecret('ABCDEFGHIJKL'), 'ABCD EFGH IJKL');
  const out = html(h(mods.card.TwoFactorSetup, { secret: 'ABCDEFGHIJKLMNOP', uri: 'otpauth://totp/x?secret=ABCDEFGHIJKLMNOP', busy: false, error: null, onConfirm: noop, onCancel: noop }));
  assert.ok(out.includes('ABCD EFGH IJKL MNOP'), 'ключ для ручного ввода');
  assert.ok(out.includes('href="otpauth://totp/x?secret=ABCDEFGHIJKLMNOP"'), 'ссылка «открыть в приложении» для телефона');
  assert.ok(out.includes('Шесть цифр из приложения'));
  assert.ok(/<button[^>]*type="submit"[^>]*disabled/.test(out));
  assert.ok(out.includes('Отмена'));
  const failed = html(h(mods.card.TwoFactorSetup, { secret: 'ABCDEFGH', uri: 'otpauth://x', busy: false, error: 'Код не подошёл.', onConfirm: noop, onCancel: noop }));
  assert.ok(failed.includes('Код не подошёл.'));
});

test('запасные коды: все выданные видны, предупреждение «показываются один раз», копировать, скачать, «Коды сохранены»', () => {
  const codes = ['aaaa-bbbb-cccc-dddd', 'eeee-ffff-gggg-hhhh'];
  const out = html(h(mods.card.RecoveryCodes, { codes, onDone: noop }));
  for (const code of codes) assert.ok(out.includes(code), code);
  assert.ok(out.includes('потом они не показываются'));
  for (const label of ['Скопировать', 'Скачать файл', 'Коды сохранены']) assert.ok(out.includes(label), label);
});

test('включено: число запасных кодов, «Новые запасные коды» и «Выключить»; мало кодов — предупреждение', () => {
  const ok = html(h(mods.card.TwoFactorOn, { left: 8, onRenew: noop, onDisable: noop }));
  assert.ok(ok.includes('>8<'));
  assert.ok(ok.includes('Новые запасные коды') && ok.includes('Выключить'));
  assert.equal(ok.includes('осталось мало'), false);
  assert.ok(html(h(mods.card.TwoFactorOn, { left: 2, onRenew: noop, onDisable: noop })).includes('осталось мало'));
});

test('«Настройки» → «Аккаунт»: карточка двухфакторного входа под карточкой аккаунта; без входа её нет', () => {
  const account = { email: 'o@example.com', logout: noop };
  const withLogin = html(h(mods.account.AccountContext.Provider, { value: account }, h(mods.settings.Settings, { dark: false, setDark: noop })));
  assert.ok(withLogin.includes('Двухфакторный вход'));
  assert.ok(withLogin.indexOf('Двухфакторный вход') > withLogin.indexOf('Сменить пароль'), 'под карточкой аккаунта');
  const without = html(h(mods.settings.Settings, { dark: false, setDark: noop }));
  assert.equal(without.includes('Двухфакторный вход'), false);
});
