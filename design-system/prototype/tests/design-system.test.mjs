// Дизайн-система (редизайн 04.11.2026): шкала шрифта, слои и тени в токенах, общие компоненты данных — npm test в design-system/prototype.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  mods.data = await server.ssrLoadModule('/src/components/data.tsx');
  mods.ui = await server.ssrLoadModule('/src/components/ui.tsx');
});

after(async () => {
  await server?.close();
});

const html = (element) => renderToStaticMarkup(element);
const text = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const css = readFileSync(path.join(root, 'src/index.css'), 'utf8');

test('токены: шкала шрифта (nano…display), слои (sunken, border-strong, field), тени elev-1…4 и цвета-плашки есть в обеих темах', () => {
  for (const name of ['nano', 'micro', 'caption', 'ui', 'subtitle', 'display']) assert.match(css, new RegExp(`--text-${name}:`), `шкала: text-${name}`);
  const light = css.slice(css.indexOf(':root {'), css.indexOf('.dark {'));
  const dark = css.slice(css.indexOf('.dark {'));
  for (const token of ['surface-sunken', 'border-strong', 'foreground-secondary', 'primary-hover', 'primary-soft', 'field', 'success-surface', 'danger-surface', 'info-surface', 'elev-1', 'elev-2', 'elev-3', 'elev-4', 'float']) {
    assert.match(light, new RegExp(`--${token}:`), `светлая тема: --${token}`);
    assert.match(dark, new RegExp(`--${token}:`), `тёмная тема: --${token}`);
  }
});

test('размеры шрифта не пишутся вручную (text-[13px]): только шкала из токенов', () => {
  const files = ['components/ui.tsx', 'components/data.tsx', 'components/Counterparty.tsx', 'components/Sidebar.tsx', 'App.tsx'];
  for (const file of files) assert.doesNotMatch(readFileSync(path.join(root, 'src', file), 'utf8'), /text-\[\d+px\]/, `${file}: размер шрифта — из шкалы`);
});

test('кнопка: главная с бликом и hover-цветом токена; loading — индикатор, недоступна, aria-busy; «ИИ» с искрой', () => {
  const { Button } = mods.ui;
  const primary = html(h(Button, null, 'Сохранить'));
  assert.match(primary, /hover:bg-primary-hover/);
  assert.match(primary, /inset_0_1px_0/, 'тонкий блик по верхней кромке');
  const loading = html(h(Button, { loading: true }, 'Сохраняю'));
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /disabled/);
  assert.match(loading, /animate-spin/);
  assert.doesNotMatch(html(h(Button, null, 'Ок')), /aria-busy/);
  assert.match(html(h(Button, { variant: 'ai' }, 'Разобрать')), /bg-brand-gradient/);
});

test('бейдж: цвета-плашки из токенов; dot добавляет точку; Card tone="sunken" — «колодец» без второй рамки', () => {
  const { Badge, Card } = mods.ui;
  assert.match(html(h(Badge, { tone: 'success' }, 'Подтверждено')), /bg-success-surface text-success/);
  assert.match(html(h(Badge, { tone: 'danger' }, 'Риск')), /bg-danger-surface/);
  assert.equal(html(h(Badge, { tone: 'info' }, 'x')).includes('rounded-full bg-info'), false);
  assert.match(html(h(Badge, { tone: 'warn', dot: true }, 'Внимание')), /bg-warn[^"]*"><\/span>/, 'точка перед словом');
  assert.equal(html(h(Badge, null, 'без точки')).includes('size-1.5'), false);
  assert.match(html(h(Card, { tone: 'sunken' }, 'x')), /bg-surface-sunken border border-transparent/);
  assert.match(html(h(Card, null, 'x')), /bg-card border border-border/);
});

test('таблица данных: подпись для диктора, заголовки столбцов, числа справа с цифрами одной ширины, минус — красным, итог отдельной строкой', () => {
  const { DataTable, THead, TBody, TFoot, Th, Tr, Td } = mods.data;
  const out = html(
    h(DataTable, { caption: 'Отчётность по годам' },
      h(THead, null, h('tr', null, h(Th, null, 'Год'), h(Th, { align: 'right' }, 'Прибыль'))),
      h(TBody, null, h(Tr, null, h(Td, { strong: true }, '2023'), h(Td, { num: true, tone: 'danger' }, '−420 000 ₽'))),
      h(TFoot, null, h('tr', null, h(Td, null, 'Итого'), h(Td, { num: true }, '1 680 000 ₽'))),
    ),
  );
  assert.match(out, /<caption class="sr-only">Отчётность по годам<\/caption>/);
  assert.match(out, /<th scope="col"[^>]*text-left[^>]*>Год<\/th>/, 'заголовок слева, а не по центру браузера');
  assert.match(out, /<th scope="col"[^>]*text-right[^>]*>Прибыль<\/th>/);
  assert.match(out, /tabular-nums[^"]*text-danger[^>]*>−420 000 ₽/, 'число: одной ширины, минус настоящий, цвет вместе со знаком');
  assert.match(out, /<tfoot[^>]*bg-surface-sunken/);
  assert.match(out, /sticky top-0/, 'шапка прилипает при прокрутке');
});

test('сортировка столбца: заголовок — кнопка, на ячейке aria-sort; без onSort кнопки нет', () => {
  const { Th } = mods.data;
  const sorted = html(h('table', null, h('thead', null, h('tr', null, h(Th, { sort: 'desc', onSort() {} }, 'Год')))));
  assert.match(sorted, /aria-sort="descending"/);
  assert.match(sorted, /<button type="button"/);
  assert.match(html(h('table', null, h('thead', null, h('tr', null, h(Th, { sort: 'asc', onSort() {} }, 'Год'))))), /aria-sort="ascending"/);
  assert.match(html(h('table', null, h('thead', null, h('tr', null, h(Th, { onSort() {} }, 'Год'))))), /aria-sort="none"/);
  const plain = html(h('table', null, h('thead', null, h('tr', null, h(Th, null, 'Год')))));
  assert.doesNotMatch(plain, /<button|aria-sort/);
});

test('показатель: подпись, крупное число, цвет по смыслу, изменение со стрелкой и цветом «хорошо / плохо»', () => {
  const { Stat } = mods.data;
  const good = html(h(Stat, { label: 'Выручка', value: '140,9 млрд ₽', delta: { value: '+17 %', direction: 'up', good: true }, hint: 'к 2024' }));
  assert.match(text(good), /Выручка 140,9 млрд ₽ \+17 % к 2024/);
  assert.match(good, /text-success/);
  assert.match(html(h(Stat, { label: 'Долг', value: '−5', tone: 'danger', delta: { value: '+9 %', direction: 'up', good: false } })), /text-danger[^>]*>−5/);
  assert.match(html(h(Stat, { label: 'Дел', value: '3' })), /text-foreground/);
});

test('предупреждение: значок и роль по смыслу (ошибка и «внимание» — alert, остальное — status), заголовок и действие', () => {
  const { Alert } = mods.data;
  assert.match(html(h(Alert, { tone: 'danger', title: 'В реестре' }, 'Запись от 12.03.2026')), /role="alert"[^>]*bg-danger-surface/);
  assert.match(html(h(Alert, { tone: 'warn', title: 'Осталось 2' })), /role="alert"/);
  assert.match(html(h(Alert, { tone: 'success', title: 'Готово' })), /role="status"[^>]*bg-success-surface/);
  assert.match(html(h(Alert, { title: 'Источник' }, 'Данные реестров')), /role="status"[^>]*bg-info-surface/);
  const withAction = html(h(Alert, { tone: 'info', title: 'T', action: h('button', null, 'Открыть') }));
  assert.match(withAction, /<button>Открыть<\/button>/);
});

test('прогресс: ARIA-полоса, значение зажато в 0–100, подпись видна только с showValue', () => {
  const { Progress } = mods.data;
  const bar = html(h(Progress, { value: 130, label: 'Заполнено', showValue: true }));
  assert.match(bar, /role="progressbar"[^>]*aria-label="Заполнено"[^>]*aria-valuenow="100"/);
  assert.match(bar, /width:100%/);
  assert.match(text(bar), /Заполнено 100%/);
  const hidden = html(h(Progress, { value: -5, label: 'Риск', tone: 'danger' }));
  assert.match(hidden, /aria-valuenow="0"/);
  assert.match(hidden, /bg-danger/);
  assert.equal(text(hidden).includes('Риск'), false, 'без showValue подпись только для диктора');
});

test('заглушка загрузки скрыта от диктора и не мигает при «уменьшить движение»; пустое состояние — значок, заголовок, пояснение и действие', () => {
  const { Skeleton, SkeletonText, EmptyState } = mods.data;
  assert.match(html(h(Skeleton, { className: 'h-4' })), /aria-hidden="true"[^>]*motion-reduce:animate-none|motion-reduce:animate-none[^>]*aria-hidden="true"|aria-hidden="true"/);
  assert.match(html(h(Skeleton, null)), /motion-reduce:animate-none/);
  assert.equal((html(h(SkeletonText, { lines: 4 })).match(/animate-pulse/g) ?? []).length, 4);
  const empty = html(h(EmptyState, { title: 'Закупок нет', action: h('button', null, 'Загрузить') }, 'Загрузите документы'));
  assert.match(text(empty), /Закупок нет Загрузите документы Загрузить/);
  assert.match(empty, /border-dashed/);
});

test('выпадающий список: родной select в общем стиле поля, своя стрелка, компактный вариант', () => {
  const { Select } = mods.data;
  const out = html(h(Select, { defaultValue: 'b' }, h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B')));
  assert.match(out, /<select[^>]*h-9[^>]*appearance-none/);
  assert.match(out, /pointer-events-none/, 'стрелка не перехватывает нажатие');
  assert.match(html(h(Select, { dense: true }, h('option', null, 'A'))), /h-8 w-full px-2\.5 text-ui/);
});
