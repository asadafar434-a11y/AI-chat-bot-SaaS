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

const dataset = { id: 'ds', fileSha256: 'x', formatVersion: 'gisp-v2', exportedAt: '2026-10-10T22:00:10.000Z', importedAt: '2026-10-12T09:00:00.000Z' };
const brief = (registry, over = {}) => ({ registry, exportedAt: dataset.exportedAt, importedAt: dataset.importedAt, ...over });
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
  registryKind: 'gisp_rpp_719',
  registries: ['gisp_rpp_719'],
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
  search: { registry: 'gisp_rpp_719', searched: ['gisp_rpp_719'], filters: ['Реестр: РПП (ПП 719)', 'ИНН производителя 9900000001'], dataset, datasetAgeDays: 2, asOf: '2026-11-20', searchedAt: '2026-10-12T09:00:00.000Z' },
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
  datasets: [brief('gisp_rpp_719')],
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

test('требования нет: об этом сказано, но искать всё равно можно — реестр выбирать не нужно', () => {
  const out = render({ demand: demandNone, required: null, positions: [position({ status: 'no_requirement' })] });
  assert.match(out, /Требование не обнаружено/);
  assert.equal(/В каком реестре искать/.test(out), false, 'вопроса про реестр нет');
  assert.equal(/type="radio"/.test(out), false, 'выбора реестра нет');
  assert.match(out, /поиск идёт сразу в обоих реестрах/);
  assert.match(out, /Найти в реестре/);
});

test('данные не загружены, выгрузка устарела, сервер недоступен — три разных сообщения', () => {
  assert.match(render({ datasets: [] }), /ещё не загружены на сервер/);
  assert.match(render({ datasets: [brief('gisp_rpp_719', { exportedAt: '2026-08-01T00:00:00.000Z' })] }), /Данные требуют обновления/);
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

test('реестра два: ищем сразу в обоих без выбора; у записи видно, в каких реестрах она есть, её уровень и выписка на gisp.gov.ru', () => {
  const none = render({ demand: demandNone, required: null, datasets: [brief('gisp_rpp_719'), brief('gisp_rep_878', { exportedAt: '2026-10-11T22:00:10.000Z' })], positions: [position({ status: 'no_requirement' })] });
  assert.equal(/type="radio"/.test(none), false, 'выбирать реестр не нужно');
  assert.match(none, /Ищем сразу в обоих реестрах/);
  assert.match(none, /РПП \(ПП 719\): выгрузка от <b[^>]*>11\.10\.2026/);
  assert.match(none, /РЭП \(ПП 878\): выгрузка от <b[^>]*>12\.10\.2026/);

  const radio = view({
    registryNumber: '00000030',
    registryKind: 'gisp_rpp_719',
    registries: ['gisp_rpp_719', 'gisp_rep_878'],
    radioLevel: 'Уровень 2',
    extractUrl: 'https://gisp.gov.ru/pp719v2/app/1/product/2/writeout/zip_sd',
  });
  const out = render({ positions: [position({ status: 'choose', decision: decision('choose', { candidates: [radio, view({ registryNumber: '00000031' })] }) })] });
  assert.match(out, /№ 00000030[\s\S]*?РПП \(ПП 719\)[\s\S]*?РЭП \(ПП 878\)/, 'запись есть в обоих реестрах — обе пометки');
  assert.match(out, /Уровень радиоэлектронной продукции/);
  assert.match(out, /Уровень 2/);
  assert.match(out, /<a href="https:\/\/gisp\.gov\.ru\/pp719v2[^"]*" target="_blank" rel="noopener noreferrer"[^>]*>открыть на сайте ГИСП<\/a>/);
  assert.equal((out.match(/открыть на сайте ГИСП/g) ?? []).length, 1, 'у записи без выписки ссылки нет');

  const chosen = render({ positions: [position({ status: 'confirmed', decision: decision('confirmed'), choice: { ...choiceOf('auto_proven'), registryKind: 'gisp_rep_878' } })] });
  assert.match(chosen, /Выбрана запись № 00000001 \(РЭП \(ПП 878\)\)/);
});

test('несколько вариантов: номер подобран сам — заметная пометка «Проверьте обязательно», выпадающий список вариантов и кнопка «Всё верно»', () => {
  const a = view({ registryNumber: '00000041', productName: 'Куртка мужская зимняя Север', registries: ['gisp_rpp_719'] });
  const b = view({ registryNumber: '00000042', productName: 'Куртка мужская рабочая', enterpriseName: 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ БЕТА', inn: '9900000002', registries: ['gisp_rpp_719', 'gisp_rep_878'] });
  const auto = {
    ...choiceOf('user_selected'),
    basis: 'auto_picked',
    confirmedAt: '',
    options: 2,
    registryNumber: '00000041',
    record: { ...choiceOf('user_selected').record, registryNumber: '00000041', productName: 'Куртка мужская зимняя Север' },
  };
  const out = render({
    positions: [
      position({
        status: 'need_data',
        decision: decision('need_data', { candidates: [a, b] }),
        choice: auto,
        autofill: { ok: true, registryNumber: '00000041', line: 'Номер реестровой записи в реестре российской промышленной продукции: [ПРОВЕРЬТЕ номер реестровой записи: 00000041 — подобран автоматически, вариантов: 2]', unverified: true, options: 2 },
      }),
    ],
  });
  assert.match(out, /Проверьте обязательно: номер подобран автоматически, вариантов — 2/);
  assert.match(out, /<select[^>]*id="rg-pick-1:k"/);
  assert.match(out, /<option value="00000041" selected="">№ 00000041 — Куртка мужская зимняя Север/);
  assert.match(out, /<option value="00000042">№ 00000042 — Куртка мужская рабочая[^<]*РПП \(ПП 719\), РЭП \(ПП 878\)/, 'у варианта видно, в каких реестрах он есть');
  assert.match(out, /Всё верно/);
  assert.match(out, /№ 00000041 · проверьте обязательно/);
  assert.match(out, /Ждут проверки: 1/);
  assert.match(out, /Номера подобраны автоматически у позиций: 1 из 1/);
  assert.match(out, /выделен жёлтым и помечен «ПРОВЕРЬТЕ»/);
});

test('подтверждённый номер: список вариантов остаётся, но пометки «проверьте» и кнопки «Всё верно» нет', () => {
  const a = view({ registryNumber: '00000001' });
  const b = view({ registryNumber: '00000002', productName: 'Кресло офисное тестовое КО-2' });
  const out = render({
    positions: [
      position({
        status: 'choose',
        decision: decision('choose', { candidates: [a, b] }),
        choice: choiceOf('user_selected'),
        autofill: { ok: true, registryNumber: '00000001', line: 'Номер реестровой записи в реестре российской промышленной продукции: 00000001' },
      }),
    ],
  });
  assert.match(out, /<select[^>]*id="rg-pick-1:k"/);
  assert.equal(/Всё верно/.test(out), false);
  assert.equal(/Проверьте обязательно/.test(out), false);
  assert.equal(/Ждут проверки/.test(out), false);
  assert.match(out, /№ 00000001 · выбрана вами/);
});

test('номер ещё не выбран, варианты найдены — список с подсказкой «выберите номер»; идёт поиск — «Ищем варианты номера»', () => {
  const out = render({ positions: [position({ status: 'choose', decision: decision('choose', { candidates: [view({ registryNumber: '00000051' }), view({ registryNumber: '00000052' })] }) })] });
  assert.match(out, /<option value="" selected="">— выберите номер —<\/option>/);
  const wait = render({ positions: [position({ status: 'searching' })] });
  assert.match(wait, /Ищем варианты номера/);
});

test('«Номер не нужен»: рядом с «Всё верно» есть кнопка отказа; после отказа сказано, что номер не указывается, и список остаётся', () => {
  const a = view({ registryNumber: '00000061', productName: 'Куртка зимняя' });
  const auto = { ...choiceOf('user_selected'), basis: 'auto_picked', confirmedAt: '', options: 1, registryNumber: '00000061', record: { ...choiceOf('user_selected').record, registryNumber: '00000061', productName: 'Куртка зимняя' } };
  const withChoice = render({
    positions: [position({ status: 'need_data', decision: decision('need_data', { candidates: [a] }), choice: auto, autofill: { ok: true, registryNumber: '00000061', line: 'x', unverified: true, options: 1 } })],
  });
  assert.match(withChoice, /Всё верно/);
  assert.match(withChoice, /Номер не нужен/);

  const declined = render({ positions: [position({ status: 'need_data', decision: decision('need_data', { candidates: [a] }), skipped: true })] });
  assert.match(declined, /Вы отказались от номера для этой позиции/);
  assert.match(declined, /<option value="" selected="">— выберите номер —<\/option>/);
  assert.equal(/Номер не нужен/.test(declined), false, 'кнопка отказа есть только у подобранного автоматически номера');
});
