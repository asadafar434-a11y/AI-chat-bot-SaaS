// Блок «Реестровые номера товаров», отрисованный на сервере в строку, — npm test в design-system/prototype.
// Смотрим на разметку: что написано словами, что заблокировано, и что чужой текст не становится кодом страницы.
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
let server;
let registry;

before(async () => {
  server = await createServer({
    root,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, fs: { allow: [path.resolve(root, '../..')] } },
    resolve: { alias: [{ find: '@', replacement: path.resolve(root, '../../web/src') }] },
  });
  registry = await server.ssrLoadModule('/src/components/RegistryNumbers.tsx');
});

after(async () => {
  await server?.close();
});

const html = (element) => renderToStaticMarkup(element);

const dataset = { id: 'ds', fileSha256: 'x', formatVersion: 'gisp-rpp-v1', exportedAt: '2026-10-10T22:00:10.000Z', importedAt: '2026-10-12T09:00:00.000Z' };
const demandFound = {
  status: 'found',
  registry: 'gisp_rpp_719',
  unsupported: null,
  mentions: [{ kind: 'rpp_719', role: 'requirement', quote: 'Участник указывает номер реестровой записи', document: 'Извещение.docx', place: '«Извещение.docx» — стр. 2' }],
  appliesTo: [],
  notes: [],
};
const demandNone = { status: 'none', registry: null, unsupported: null, mentions: [], appliesTo: [], notes: [] };

const card = (name = 'Кресло офисное') => ({
  key: '1:k',
  name,
  quantity: '5 шт',
  source: 'ТЗ',
  quote: name,
  offeredName: null,
  fields: { okpd2: { value: '31.01.12.160', origin: 'tz', source: 'ТЗ' } },
});

const view = (over = {}) => ({
  recordId: 'r1',
  registryNumber: '00000001',
  enterpriseName: 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ',
  inn: '9900000001',
  productName: 'Кресло офисное тестовое КО-1',
  okpd2: '31.01.12.160',
  tnved: null,
  madeBy: null,
  addedAt: '2026-09-01',
  validUntil: '2029-09-01',
  validUntilMin: '2029-09-01',
  basisCount: 1,
  recordStatus: 'active',
  activity: { active: true, reasons: [], warnings: [] },
  tiers: [],
  identity: ['inn'],
  proven: false,
  hasIdentity: true,
  blocked: false,
  rank: 1,
  signals: [
    { field: 'inn', verdict: 'confirm', identifying: true, critical: false, text: 'ИНН производителя совпадает' },
    { field: 'model', verdict: 'neutral', identifying: false, critical: false, text: 'Модель не указана' },
  ],
  ...over,
});

const decision = (status, over = {}) => ({
  status,
  scenario: 2,
  proposed: null,
  candidates: [view()],
  matchedTotal: 1,
  truncated: false,
  missing: [],
  differences: [],
  reasons: ['Причина решения'],
  assumptions: ['Допущение один'],
  similarElsewhere: null,
  dismissed: 0,
  search: { registry: 'gisp_rpp_719', filters: ['Реестр: РПП (ПП 719)', 'ИНН производителя 9900000001'], dataset, datasetAgeDays: 2, asOf: '2026-11-20', searchedAt: '2026-10-12T09:00:00.000Z' },
  ...over,
});

const position = (over = {}) => ({
  card: card(),
  status: 'pending',
  decision: null,
  error: null,
  choice: undefined,
  autofill: { ok: false, reason: 'Номер не выбран и не подтверждён участником' },
  cardChanged: false,
  ...over,
});

const baseProps = (over = {}) => ({
  demand: demandFound,
  required: 'gisp_rpp_719',
  chosenRegistry: undefined,
  onChooseRegistry() {},
  dataset,
  datasetError: null,
  positions: [position()],
  onSearch() {},
  onSaveAndSearch() {},
  searching: false,
  onSelect() {},
  onCancel() {},
  log: [],
  now: Date.parse('2026-10-12T09:00:00Z'),
  ...over,
});

const render = (over) => html(h(registry.RegistryNumbers, baseProps(over)));

const choiceOf = (basis) => ({
  positionKey: '1:k',
  registryKind: 'gisp_rpp_719',
  registryNumber: '00000001',
  basis,
  confirmedAt: '2026-10-12T09:00:00.000Z',
  note: basis === 'user_selected' ? 'наша модель' : '',
  cardHash: 'h',
  decisionStatus: 'confirmed',
  record: { registryNumber: '00000001', enterpriseName: 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ', inn: '9900000001', productName: 'Кресло', okpd2: '31.01.12.160', madeBy: null, validUntil: '2029-09-01', validUntilMin: '2029-09-01', basisCount: 1 },
  dataset,
  datasetAgeDays: 2,
  asOf: '2026-11-20',
  searchedAt: '',
  considered: [],
  reasons: [],
  assumptions: [],
  warnings: [],
});

test('требование найдено: показано, откуда оно, и данные выгрузки; состояние позиции написано словами', () => {
  const out = render();
  assert.match(out, /Реестровые номера товаров/);
  assert.match(out, /Требование обнаружено/);
  assert.match(out, /Где в документах об этом сказано/);
  assert.match(out, /выгрузка от <b[^>]*>11\.10\.2026/);
  assert.match(out, /Требование о реестровом номере обнаружено — поиск не выполнен/);
});

test('требования нет: об этом сказано, и участник сам может указать реестр', () => {
  const out = render({ demand: demandNone, required: null, positions: [position({ status: 'no_requirement' })] });
  assert.match(out, /Требование не обнаружено/);
  assert.match(out, /В каком реестре искать\?/);
  assert.match(out, /Реестр российской промышленной продукции/);
});

test('данные не загружены, выгрузка устарела, сервер недоступен — три разных сообщения', () => {
  assert.match(render({ dataset: null }), /ещё не загружена на сервер/);
  assert.match(render({ dataset: { ...dataset, exportedAt: '2026-08-01T00:00:00.000Z' } }), /Данные требуют обновления/);
  assert.match(render({ datasetError: 'База реестра сейчас недоступна — попробуйте позже.' }), /сейчас недоступна/);
});

test('позиция с выбором: номер, основание выбора и что попадёт в заявку', () => {
  const out = render({
    positions: [
      position({
        status: 'confirmed',
        decision: decision('confirmed', { proposed: '00000001', scenario: 1 }),
        choice: choiceOf('auto_proven'),
        autofill: { ok: true, registryNumber: '00000001', line: 'Номер реестровой записи в реестре российской промышленной продукции: 00000001' },
      }),
    ],
  });
  assert.match(out, /№ 00000001/);
  assert.match(out, /подтверждена совпадением/);
  assert.match(out, /Найдена подтверждённая запись/);
  assert.match(out, /В заявку будет вписано: Номер реестровой записи в реестре российской промышленной продукции: 00000001/);
  assert.match(out, /в заявку попадёт номеров: 1 из 1/);
});

test('выбор вручную назван решением участника; данные о товаре изменились — номер в заявку не идёт, причина сказана', () => {
  const out = render({
    positions: [
      position({
        status: 'choose',
        decision: decision('choose'),
        choice: choiceOf('user_selected'),
        cardChanged: true,
        autofill: { ok: false, reason: 'Сведения о товаре изменились после выбора — найдите запись заново' },
      }),
    ],
  });
  assert.match(out, /выбор участника: объективных подтверждений недостаточно/);
  assert.match(out, /Данные о товаре изменились/);
  assert.match(out, /Номер в заявку не вписывается: Сведения о товаре изменились после выбора/);
});

test('кандидат с расхождением: статус «обнаружено противоречие», кнопка выбора заблокирована, причина написана', () => {
  const bad = view({
    registryNumber: '00000002',
    blocked: true,
    signals: [{ field: 'model', verdict: 'contradict', identifying: false, critical: true, text: 'Модель в записи отличается: в реестре «КО-9», у вас «КО-1»' }],
  });
  const out = render({ positions: [position({ status: 'contradiction', decision: decision('contradiction', { scenario: 4, candidates: [bad] }) })] });
  assert.match(out, /Обнаружено противоречие/);
  assert.match(out, /<button[^>]*disabled[^>]*>Выбрать<\/button>|disabled=""[^>]*>Выбрать/);
  assert.match(out, /Есть расхождение с данными о товаре\. Выбрать эту запись нельзя/);
});

test('неактуальная запись: сказано, почему, выбрать нельзя', () => {
  const old = view({ registryNumber: '00000003', activity: { active: false, reasons: ['срок действия истёк 2026-01-01'], warnings: [] } });
  const out = render({ positions: [position({ status: 'inactive', decision: decision('inactive', { scenario: 6, candidates: [old] }) })] });
  assert.match(out, /Запись неактуальна/);
  assert.match(out, /срок действия истёк 2026-01-01/);
});

test('текст из документов и из реестра выводится как текст, а не как разметка', () => {
  const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>';
  const out = render({
    positions: [position({ card: card(evil), status: 'choose', decision: decision('choose', { candidates: [view({ productName: evil, enterpriseName: evil })], reasons: [evil], missing: [evil] }) })],
    log: [{ at: '2026-10-12T09:00:00.000Z', positionKey: 'k', event: 'search', text: evil }],
  });
  assert.equal(out.includes('<script>'), false);
  assert.equal(out.includes('<img'), false);
  assert.match(out, /&lt;script&gt;/);
});

test('нет перечня товаров — подсказка, куда идти', () => {
  assert.match(render({ positions: [] }), /Составьте ТП на шаге «Проверка»/);
});

test('журнал решений показывает последние события', () => {
  const out = render({ log: [{ at: '2026-10-12T09:15:00.000Z', positionKey: 'k', event: 'select', text: 'Подтверждена запись 00000001.', registryNumber: '00000001' }] });
  assert.match(out, /История решений \(1\)/);
  assert.match(out, /Подтверждена запись 00000001/);
});

test('баллы и процентный показатель записи показаны, а если их нет — так и написано; ОКПД2 в форме и в списке нет', () => {
  const withScore = view({ registryNumber: '00000010', points: 135, percent: 0.81, conformity: 'Соответствует требованиям (тест)' });
  const out = render({ positions: [position({ status: 'choose', decision: decision('choose', { candidates: [withScore, view({ registryNumber: '00000011' })] }) })] });
  assert.match(out, /баллы: 135 · процентный показатель: 81 %/);
  assert.match(out, /в записи не указаны/);
  assert.equal(/Код ОКПД2/.test(out), false, 'поля ОКПД2 в карточке товара нет');
  assert.equal(/<dt[^>]*>ОКПД2<\/dt>/.test(out), false, 'ОКПД2 записи в списке не показывается');
});

test('записи с одинаковым названием у одного производителя помечены: выбирать нужно свой номер', () => {
  const a = view({ registryNumber: '00000020', productName: 'Бейсболка' });
  const b = view({ registryNumber: '00000021', productName: 'Бейсболка' });
  const other = view({ registryNumber: '00000022', productName: 'Бейсболка', inn: '9900000002' });
  const out = render({ positions: [position({ status: 'choose', decision: decision('choose', { candidates: [a, b, other] }) })] });
  assert.match(out, /Такое же название ещё у 1 записи — выберите свой номер/);
  assert.equal((out.match(/Такое же название ещё у/g) ?? []).length, 2, 'помечены две записи одного производителя, чужая — нет');
});
