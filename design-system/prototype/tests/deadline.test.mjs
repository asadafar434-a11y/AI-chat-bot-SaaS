// Срок подачи в списке «Мои закупки»: красноватый — приём закончился, жёлтый — срок близко, и слова остаются — npm test в design-system/prototype.
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
let server;
let dashboard;
let tenders;

before(async () => {
  server = await createServer({
    root,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, fs: { allow: [path.resolve(root, '../..')] } },
    resolve: { alias: [{ find: '@', replacement: path.resolve(root, '../../web/src') }] },
  });
  dashboard = await server.ssrLoadModule('/src/components/TendersDashboard.tsx');
  tenders = await server.ssrLoadModule('/src/real/tenders.ts');
});

after(async () => {
  await server?.close();
});

// Дата через n дней от сегодня — как её пишет разбор документов.
const inDays = (n) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const purchase = (id, days, extra = {}) => ({
  id,
  createdAt: '2026-10-01T10:00:00.000Z',
  short: `Закупка ${id}`,
  subject: 'Поставка',
  kind: '223-ФЗ · запрос котировок',
  customer: 'Заказчик',
  price: '100 000 ₽',
  files: ['a.docx'],
  unreadable: [],
  requirements: { who: [], submit: [], scope: [], terms: [] },
  deadline: { date: inDays(days), time: '10:00', zone: 'МСК' },
  ...extra,
});

const render = (list) => renderToStaticMarkup(h(dashboard.TendersDashboard, { tenders: list.map((p) => tenders.toTender(p)), onOpen() {}, onNew() {}, onDelete() {}, onToggleSubmitted() {} }));

test('приём закончился — красноватым и словами «приём заявок закончился …»', () => {
  const out = render([purchase('past', -2)]);
  assert.match(out, /text-danger[^"]*"[^>]*>(?:<svg[\s\S]*?<\/svg>)приём заявок закончился \d+ [а-я]+ \d{4}/);
});

test('срок близко (за 3 дня и за неделю) — жёлтым и с отсчётом словами; далеко — обычным цветом', () => {
  const soon = render([purchase('s3', 3)]);
  assert.match(soon, /text-warn-foreground[^"]*"[^>]*>(?:<svg[\s\S]*?<\/svg>)до \d+ [а-я]+ \d{4} · осталось 3 дня/);
  assert.match(render([purchase('s7', 7)]), /text-warn-foreground/);
  const far = render([purchase('far', 30)]);
  assert.equal(/осталось 30/.test(far), true, 'отсчёт виден и у дальнего срока');
  assert.equal(/font-medium text-warn-foreground|font-medium text-danger/.test(far), false, 'далёкий срок не подсвечивается');
});

test('пример и закупка без срока не красятся', () => {
  const sample = render([purchase('sample', -100, { sample: true })]);
  assert.equal(/приём заявок закончился/.test(sample), false);
  const none = render([purchase('none', 5, { deadline: { date: '', time: '', zone: '' } })]);
  assert.match(none, /срок не найден/);
});
