// Карточка «Скрытые требования и неоднозначности», отрисованная на сервере в строку, — npm test в design-system/prototype.
// Смотрим на разметку: кнопку платной проверки, сводку, фильтры, источник цитаты, раскрытое объяснение и вопрос заказчику.
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
let server;
let mod;

before(async () => {
  server = await createServer({
    root,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, fs: { allow: [path.resolve(root, '../..')] } },
    resolve: { alias: [{ find: '@', replacement: path.resolve(root, '../../web/src') }] },
  });
  mod = await server.ssrLoadModule('/src/components/HiddenRequirements.tsx');
});

after(async () => {
  await server?.close();
});

const none = () => {};
const text = (out) => out.replace(/<[^>]+>/g, ' ').replace(/[  ]/g, ' ').replace(/\s+/g, ' ');

const finding = (over = {}) => ({
  kind: 'ambiguity',
  criticality: 'high',
  title: 'Собственность или аренда техники',
  what: 'Требование о наличии техники не уточняет право владения',
  quote: 'Участник должен иметь специальную технику',
  source: 'ТЗ, п. 5.2',
  why: 'Неясно, можно ли подтвердить технику договором аренды',
  interpretations: 'Собственная техника или аренда — от этого зависит допуск',
  risk: 'Потенциально: заявку отклонят, если аренда не устроит комиссию',
  check: 'Полный текст ТЗ и требования к участникам',
  action: 'Подготовить договор аренды и задать вопрос заказчику',
  ask: 'Просим уточнить, допускается ли подтверждение права пользования арендованной техникой',
  verified: true,
  at: '«ТЗ.docx» — п. 5.2',
  ...over,
});

const result = (findings) => ({ findings, docsKey: 'k', checkedAt: '2026-10-28T10:00:00.000Z' });
const card = (over = {}) => ({ result: null, stale: false, running: false, error: '', onRun: none, ...over });

test('без результата: заголовок, пояснение и кнопка платной проверки, сводки нет', () => {
  const out = text(renderToStaticMarkup(h(mod.HiddenRequirementsBlock, { card: card() })));
  assert.match(out, /Скрытые требования и неоднозначности/);
  assert.match(out, /Платный запрос к ИИ — только по кнопке/);
  assert.match(out, /Найти скрытые требования/);
  assert.equal(out.includes('Найдено:'), false);
});

test('результат: сводка, фильтры по важности и типу, источник, раскрытое объяснение и вопрос заказчику', () => {
  const findings = [
    finding({ criticality: 'critical', title: 'Нет допуска к работам' }),
    finding(),
    finding({ kind: 'financial', criticality: 'high', title: 'Монтаж за свой счёт', verified: false, at: undefined }),
  ];
  const out = text(renderToStaticMarkup(h(mod.HiddenRequirementsBlock, { card: card({ result: result(findings) }) })));
  assert.match(out, /Найдено: 3 момента, из них критических — 1, высоких — 2/);
  assert.match(out, /Все · 3/);
  assert.match(out, /Критические · 1/);
  assert.match(out, /Высокие · 2/);
  assert.match(out, /Любой тип/);
  assert.match(out, /Неоднозначности/);
  assert.match(out, /Деньги и расходы/);
  assert.match(out, /Критический/);
  assert.match(out, /ТЗ, п\. 5\.2/);
  assert.match(out, /Участник должен иметь специальную технику/);
  assert.match(out, /Цитата не найдена в документах дословно/);
  // Первая (самая важная) находка раскрыта сразу: «почему это риск» и готовый вопрос.
  assert.match(out, /Почему это важно/);
  assert.match(out, /Возможные трактовки/);
  assert.match(out, /Риск для участника/);
  assert.match(out, /Что проверить/);
  assert.match(out, /Что сделать/);
  assert.match(out, /Вопрос заказчику/);
  assert.match(out, /Скопировать/);
  assert.match(out, /Проверить заново/);
});

test('устаревший результат и пустой список: предупреждение и честный итог без выдуманных находок', () => {
  const stale = text(renderToStaticMarkup(h(mod.HiddenRequirementsBlock, { card: card({ result: result([finding()]), stale: true }) })));
  assert.match(stale, /Документы изменились после проверки/);
  assert.match(stale, /1 из 1 — с готовым вопросом заказчику/);

  const empty = text(renderToStaticMarkup(h(mod.HiddenRequirementsBlock, { card: card({ result: result([]) }) })));
  assert.match(empty, /Скрытых требований и неоднозначностей не найдено/);
  assert.match(empty, /ИИ не нашёл обоснованных проблем/);
  assert.equal(empty.includes('Вопрос заказчику'), false);
});

test('ошибка проверки: сообщение с ролью alert, кнопка остаётся', () => {
  const out = renderToStaticMarkup(
    h(mod.HiddenRequirementsBlock, { card: card({ error: 'Не удалось проверить документы на скрытые требования.' }) }),
  );
  assert.match(out, /role="alert"/);
  assert.match(text(out), /Не удалось проверить документы на скрытые требования/);
  assert.match(text(out), /Найти скрытые требования/);
});
