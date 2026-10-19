// Блок «Excel-бланки заказчика», отрисованный на сервере в строку, — npm test в design-system/prototype.
// Смотрим на разметку: что вписано, что остаётся участнику, что нельзя скачать, и что чужой текст не становится кодом страницы.
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
let server;
let block;

before(async () => {
  server = await createServer({
    root,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, fs: { allow: [path.resolve(root, '../..')] } },
    resolve: { alias: [{ find: '@', replacement: path.resolve(root, '../../web/src') }] },
  });
  block = await server.ssrLoadModule('/src/components/ExcelForms.tsx');
});

after(async () => {
  await server?.close();
});

const none = () => {};
const render = (over = {}) => renderToStaticMarkup(h(block.ExcelForms, { forms: [], onAdd: none, onDownload: none, onRemove: none, ...over }));
const item = (ref, label, value) => ({ sheet: 'Лист1', ref, label, value, kind: 'requisite' });

test('бланков нет: сказано, что делает блок, и есть кнопка «Добавить Excel-бланк»; файлы остаются у заказчика', () => {
  const out = render();
  assert.match(out, /Excel-бланки заказчика/);
  assert.match(out, /Добавить Excel-бланк/);
  assert.match(out, /формулы и оформление/);
  assert.match(out, /type="file"[^>]*accept="\.xlsx,\.xls"/);
  assert.equal(/Скачать заполненный/.test(out), false);
});

test('готовый бланк: сколько вписано, сколько остаётся участнику, скачивание и что именно вписано', () => {
  const out = render({
    forms: [
      {
        name: 'Анкета.xlsx',
        state: 'ready',
        filled: [item('C11', 'ИНН Участника', '7701234567'), item('C12', 'КПП Участника', '770101001')],
        left: ['«Фамилия, Имя и Отчество ответственного лица» — в «Реквизитах» этого поля нет'],
      },
    ],
  });
  assert.match(out, /Анкета\.xlsx/);
  assert.match(out, /Впишу: 2/);
  assert.match(out, /Вам остаётся: 1/);
  assert.match(out, /Скачать заполненный/);
  assert.match(out, /C11<\/span> · ИНН Участника/);
  assert.match(out, /7701234567/);
  assert.match(out, /Впишите сами в файле/);
  assert.match(out, /ответственного лица/);
});

test('старый .xls или файл, который не открылся: сказано словами, скачать нельзя', () => {
  const out = render({ forms: [{ name: 'Форма.xlsx', state: 'error', message: 'Файл не открывается как .xlsx', filled: [], left: [] }] });
  assert.match(out, /role="alert"/);
  assert.match(out, /Файл не открывается как \.xlsx/);
  assert.equal(/Скачать заполненный/.test(out), false);
});

test('замечания и ошибки видны; чужой текст в значениях не становится разметкой', () => {
  const out = render({
    note: '«b.xls» — старый формат .xls: сохраните как .xlsx.',
    error: 'Не удалось собрать файл.',
    forms: [{ name: 'КП.xlsx', state: 'ready', filled: [item('H9', 'Наименование', '<img src=x onerror=alert(1)>')], left: [] }],
  });
  assert.match(out, /старый формат \.xls/);
  assert.match(out, /Не удалось собрать файл\./);
  assert.equal(/<img src=x/.test(out), false);
  assert.match(out, /&lt;img src=x/);
});

test('длинный список вписанного обрезается: первые 40 и «…и ещё N»', () => {
  const filled = Array.from({ length: 45 }, (_, i) => item(`H${i + 1}`, `Позиция ${i + 1}`, 'Россия'));
  const out = render({ forms: [{ name: 'КП.xlsx', state: 'ready', filled, left: [] }] });
  assert.match(out, /…и ещё 5/);
  assert.equal(out.includes('Позиция 41'), false);
});
