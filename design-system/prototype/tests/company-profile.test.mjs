// «Профиль компании» по образцу конкурентов и с нашим: шапка «Сила профиля», шаги-вкладки, плашки выбора, нижняя панель — npm test в design-system/prototype.
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
  mods.company = await server.ssrLoadModule('/src/components/CompanyProfile.tsx');
  mods.card = await server.ssrLoadModule('@/lib/company-card.ts');
  mods.profile = await server.ssrLoadModule('@/lib/profile.ts');
});

after(async () => {
  await server?.close();
});

const html = (element) => renderToStaticMarkup(element);
const noop = () => {};

test('шапка «Сила профиля»: кольцо с процентом, разделы с долями, следующий шаг, подбор тендеров — «скоро»', () => {
  const { EMPTY_CARD, profileStrength } = mods.card;
  const { EMPTY_PROFILE } = mods.profile;
  const empty = html(h(mods.company.ProfileHero, { strength: profileStrength(EMPTY_PROFILE, EMPTY_CARD), facts: 0, onOpen: noop, defaultOpen: true }));
  assert.ok(empty.includes('Сила профиля'));
  assert.ok(empty.includes('>0%<'));
  assert.ok(empty.includes('aria-valuenow="0"'));
  for (const label of ['Реквизиты', 'Опыт и финансы', 'Специализация', 'Лицензии', 'Сертификаты']) assert.ok(empty.includes(label), label);
  assert.ok(empty.includes('до 40%'), 'у раздела видна его доля');
  assert.ok(empty.includes('Дальше: Реквизиты'), 'предложен следующий шаг');
  assert.ok(empty.indexOf('скоро') > empty.indexOf('Подбор тендеров по специализации'), 'то, чего нет, помечено «скоро»');
  assert.ok(empty.includes('не оценка шансов'), 'сказано, что это не шансы на победу');
  assert.equal(empty.includes('bg-success'), false, 'пока ничего не заполнено — ни одна полоса и точка не зелёные');

  const card = { ...EMPTY_CARD, industries: ['Экология'], noLicenses: true, noCertificates: true };
  const some = html(h(mods.company.ProfileHero, { strength: profileStrength(EMPTY_PROFILE, card), facts: 3, onOpen: noop, defaultOpen: true }));
  assert.ok(some.includes('>40%<'));
  assert.ok(some.includes('bg-success'), 'заполненные разделы и проверка по базе доказательств — зелёные');
  assert.ok(some.includes('Дальше: Реквизиты'));
});

test('шапка по умолчанию свёрнута: процент, «Дальше» и кнопка «развернуть», без списка разделов', () => {
  const { EMPTY_CARD, profileStrength } = mods.card;
  const { EMPTY_PROFILE } = mods.profile;
  const out = html(h(mods.company.ProfileHero, { strength: profileStrength(EMPTY_PROFILE, EMPTY_CARD), facts: 0, onOpen: noop }));
  assert.ok(out.includes('>0%<'));
  assert.ok(out.includes('aria-expanded="false"'));
  assert.ok(out.includes('Дальше: Реквизиты'));
  assert.equal(out.includes('до 40%'), false, 'разделы спрятаны');
  assert.doesNotMatch(out, /card-hover|shadow-(sm|md|lg|xl|2xl)/, 'карточка без тени: на неё нельзя нажать');
});

test('шаги: пять карточек с состоянием и две наши вкладки — в одной полосе вкладок', () => {
  const { EMPTY_CARD, profileStrength } = mods.card;
  const { EMPTY_PROFILE } = mods.profile;
  const strength = profileStrength(EMPTY_PROFILE, { ...EMPTY_CARD, industries: ['Экология', 'Энергетика', 'Образование'] });
  const extras = [
    { key: 'evidence', label: 'База доказательств' },
    { key: 'docs', label: 'Образцы и документы' },
  ];
  const out = html(h(mods.company.ProfileSteps, { idPrefix: 'p', active: 'industries', onChange: noop, strength, extras }));
  for (const label of ['Реквизиты', 'Опыт и финансы', 'Специализация', 'Лицензии', 'Сертификаты', 'База доказательств', 'Образцы и документы']) assert.ok(out.includes(label), label);
  assert.equal(out.split('role="tab"').length - 1, 7);
  assert.ok(out.includes('заполнено'), 'у шага есть точка состояния');
  assert.ok(out.includes('id="p-tab-profile"'), 'реквизиты по-прежнему называются profile');
  assert.ok(out.includes('bg-card text-foreground shadow-sm'), 'выбранный шаг — как в общем Tabs');
  assert.ok(out.includes('aria-controls="p-panel-industries"'));
});

test('плашки выбора: нажатые отмечены (aria-pressed), свои пункты видны, «нет» недоступно при выборе, подтверждает документ', () => {
  const { EMPTY_CARD } = mods.card;
  const card = { ...EMPTY_CARD, licenses: ['Медицинская лицензия', 'Своя лицензия'], noCertificates: true };
  const out = html(h(mods.company.LicensesPanel, { card, onChange: noop, factCount: 2, onOpenEvidence: noop }));
  assert.ok(out.includes('Своя лицензия'));
  assert.ok(out.includes('заявлено вами'));
  assert.ok(out.includes('Открыть базу доказательств'));
  assert.ok(out.includes('сейчас там 2 '));
  assert.ok(out.split('aria-pressed="true"').length - 1 >= 2, 'выбранные лицензии нажаты');
  assert.ok(out.includes('aria-pressed="false"'), 'невыбранные — нет');
  assert.ok(/role="switch"[^>]*disabled/.test(out), 'при выбранных лицензиях «лицензий нет» недоступно');
  const certs = html(h(mods.company.CertificatesPanel, { card, onChange: noop, factCount: 0, onOpenEvidence: noop }));
  assert.ok(certs.includes('role="switch" aria-checked="true"'));
  assert.ok(certs.includes('ISO 9001'));
  assert.equal(certs.includes('сейчас там'), false, 'пока в базе пусто — число не пишем');
});

test('свой пункт: плашка с крестиком «Удалить», снятый пункт остаётся, готовые варианты крестика не имеют', () => {
  const { EMPTY_CARD } = mods.card;
  const card = { ...EMPTY_CARD, licenses: ['Своя лицензия'], custom: { ...EMPTY_CARD.custom, licenses: ['Своя лицензия', 'Снятая лицензия'] } };
  const out = html(h(mods.company.LicensesPanel, { card, onChange: noop, factCount: 0, onOpenEvidence: noop }));
  assert.ok(out.includes('Удалить «Своя лицензия»'));
  assert.ok(out.includes('Снятая лицензия'), 'снятый пункт остаётся на экране');
  assert.ok(out.includes('Удалить «Снятая лицензия»'));
  assert.equal(out.split('Удалить «').length - 1, 2, 'крестик только у своих');
});

test('специализация: готовый список с нашими отраслями и пометкой «скоро» у подбора тендеров', () => {
  const { EMPTY_CARD } = mods.card;
  const out = html(h(mods.company.IndustriesPanel, { card: { ...EMPTY_CARD, industries: ['Питание и общепит'] }, onChange: noop }));
  for (const label of ['Строительство и ремонт', 'Мебель и оборудование', 'Топливо и энергоресурсы', 'Питание и общепит']) assert.ok(out.includes(label), label);
  assert.ok(out.indexOf('скоро') > out.indexOf('Подбор тендеров по отраслям'));
});

test('опыт и финансы: шесть полей, сумма в рублях под полем', () => {
  const { EMPTY_CARD } = mods.card;
  const card = { ...EMPTY_CARD, experience: { ...EMPTY_CARD.experience, turnover: '10000000' } };
  const out = html(h(mods.company.ExperiencePanel, { card, onChange: noop }));
  for (const label of ['Лет опыта', 'Выиграно контрактов', 'Сотрудников', 'Годовой оборот', 'Максимальный контракт', 'Год основания']) assert.ok(out.includes(label), label);
  assert.ok(out.includes('10 000 000 ₽'));
  assert.equal(out.split('<input').length - 1, 6);
});

test('нижняя панель: только при правке реквизитов или ошибке сохранения; процента в ней нет', () => {
  const idle = html(h(mods.company.ProfileBar, { status: { text: 'Сохранено', failed: false }, editing: false, onCancel: noop, onSave: noop }));
  assert.equal(idle, '', 'всё сохранено и ничего не правится — полосы нет');
  const failed = html(h(mods.company.ProfileBar, { status: { text: 'Не сохранилось', failed: true }, editing: false, onCancel: noop, onSave: noop }));
  assert.ok(failed.includes('Не сохранилось'));
  assert.equal(failed.includes('Отмена'), false);
  const editing = html(h(mods.company.ProfileBar, { status: null, editing: true, onCancel: noop, onSave: noop }));
  assert.ok(editing.includes('Отмена'));
  assert.ok(editing.includes('Сохранить изменения'));
  assert.equal(editing.includes('Профиль заполнен на'), false);
});
