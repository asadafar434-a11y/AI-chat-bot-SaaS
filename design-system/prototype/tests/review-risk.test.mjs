// «Риск отклонения» на шаге «Проверка» и заглушка «Поиска закупок», отрисованные в разметку, — npm test в design-system/prototype.
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
let server;
let review;
let search;

before(async () => {
  server = await createServer({
    root,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, fs: { allow: [path.resolve(root, '../..')] } },
    resolve: { alias: [{ find: '@', replacement: path.resolve(root, '../../web/src') }] },
  });
  review = await server.ssrLoadModule('/src/components/StepReview.tsx');
  search = await server.ssrLoadModule('/src/components/TenderSearch.tsx');
});

after(async () => {
  await server?.close();
});

const html = (element) => renderToStaticMarkup(element);
const text = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const finding = (id, severity, what) => ({ id, severity, what, requirement: 'Требование', source: 'Техническое предложение', evidence: null, fix: 'Впишите значение' });
const report = (findings, risk) => ({
  critical: findings.filter((f) => f.severity === 'CRITICAL').length,
  warnings: findings.filter((f) => f.severity === 'WARNING').length,
  info: findings.filter((f) => f.severity === 'INFO').length,
  findings,
  risk,
});

test('риск: уровень и причины по замечаниям проверки, без процента', () => {
  const high = text(html(h(review.RiskBlock, { audit: report([finding('a', 'CRITICAL', 'Не заполнено: марка'), finding('b', 'CRITICAL', 'Нет сертификата'), finding('c', 'WARNING', 'Цена')], 'high') })));
  assert.match(high, /Риск отклонения/);
  assert.match(high, /Высокий/);
  assert.match(high, /2 критичных замечания и 1 предупреждение — заявку могут отклонить/);
  assert.equal(/\d\s*%/.test(high), false, 'процента нет');

  const one = text(html(h(review.RiskBlock, { audit: report([finding('a', 'CRITICAL', 'Не заполнено')], 'high') })));
  assert.match(one, /1 критичное замечание — заявку могут отклонить/);

  const medium = text(html(h(review.RiskBlock, { audit: report([finding('a', 'WARNING', 'Подтвердите цену'), finding('b', 'WARNING', 'Подтвердите срок')], 'medium') })));
  assert.match(medium, /Средний/);
  assert.match(medium, /2 предупреждения — нужна ваша проверка/);

  const low = text(html(h(review.RiskBlock, { audit: report([], 'low') })));
  assert.match(low, /Низкий/);
  assert.match(low, /замечаний нет/);
});

test('риск: «Почему такой риск?» — кнопка, а «Пересчитать с ИИ» остаётся недоступной и помечена «скоро»', () => {
  const out = html(h(review.RiskBlock, { audit: report([finding('a', 'CRITICAL', 'x')], 'high') }));
  assert.match(out, /<button[^>]*aria-expanded="false"[^>]*>.*Почему такой риск\?<\/button>/s);
  assert.match(out, /<button[^>]*disabled=""[^>]*>.*Пересчитать с ИИ/s);
  assert.match(out, /скоро/i);
});

test('причины риска: что сделать и источник у каждого замечания, первые 12, остальное — на «Пакете»; честная оговорка про процент', () => {
  const many = Array.from({ length: 15 }, (_, i) => finding(`f${i}`, i < 10 ? 'CRITICAL' : 'WARNING', `Замечание номер ${i + 1}`));
  const out = text(html(h(review.RiskReasons, { audit: report(many, 'high') })));
  assert.match(out, /Замечание номер 1 /);
  assert.match(out, /Замечание номер 12 /);
  assert.equal(/Замечание номер 13 /.test(out), false, 'тринадцатое не показано');
  assert.match(out, /Что сделать: Впишите значение · Источник: Техническое предложение/);
  assert.match(out, /Критично/);
  assert.match(out, /Предупреждение/);
  assert.match(out, /…и ещё 3: полный список — на шаге «Пакет»/);
  assert.match(out, /Это не вероятность, а вывод по правилам/);
  assert.match(out, /Процент не показываем/);

  const none = text(html(h(review.RiskReasons, { audit: report([], 'low') })));
  assert.match(none, /Замечаний нет/);
});

test('«Поиск закупок» — заглушка: честно «в разработке», кнопка «Новая закупка», никаких выдуманных закупок', () => {
  const out = html(h(search.TenderSearch, { onNew: () => {} }));
  const plain = text(out);
  assert.match(plain, /Поиск закупок/);
  assert.match(out, /скоро/i);
  assert.match(plain, /Поиск по площадкам — в разработке/);
  assert.match(plain, /Новая закупка/);
  for (const fake of ['Почта России', 'РЖД', 'Сбербанк', 'Аэрофлот', 'Газпром', 'ГБОУ', 'совпадение', 'В работу']) {
    assert.equal(plain.includes(fake), false, `в заглушке не должно быть «${fake}»`);
  }
  assert.equal(/\d{11,}/.test(plain), false, 'номеров закупок нет');
});

// ——— Шаг «Проверка»: уровни важности ———
test('риск: уровень — самым крупным и цветом (красный, янтарный, зелёный), плашка подкрашена; причина — жирным рядом', () => {
  const high = html(h(review.RiskBlock, { audit: report([finding('a', 'CRITICAL', 'x')], 'high') }));
  assert.match(high, /text-2xl font-bold[^"]*text-danger[^>]*>Высокий/);
  assert.match(high, /bg-danger\/5/);
  const medium = html(h(review.RiskBlock, { audit: report([finding('a', 'WARNING', 'x')], 'medium') }));
  assert.match(medium, /text-2xl font-bold[^"]*text-warn-foreground[^>]*>Средний/);
  const low = html(h(review.RiskBlock, { audit: report([], 'low') }));
  assert.match(low, /text-2xl font-bold[^"]*text-success[^>]*>Низкий/);
  assert.match(low, /bg-success\/5/);
});

test('причины риска: оговорка про «не вероятность» — в подсказке, на виду только «ИИ не вызывается»', () => {
  const out = html(h(review.RiskReasons, { audit: report([finding('a', 'WARNING', 'x')], 'medium') }));
  assert.match(text(out), /ИИ не вызывается\./);
  assert.match(out, /role="tooltip"[^>]*>Это не вероятность, а вывод по правилам/);
});

test('итоговая проверка: сверху вывод словами и цветом, под ним тихие цифры по видам; готово — зелёная плашка, нет — янтарная', () => {
  const final = (ready, text) => ({ ready, text, fields: { required: 10, filled: 10, empty: 0, invalid: 0 }, documents: { required: 3, ready: 3 }, confirmations: { required: 2, done: 2 }, signatures: { required: 1, done: 0 } });
  const ok = html(h(review.FinalCheck, { final: final(true, 'Всё готово к подаче.') }));
  assert.match(ok, /bg-success\/10 text-success[^"]*"[^>]*>.*Всё готово к подаче\./s);
  assert.ok(ok.indexOf('Всё готово к подаче.') < ok.indexOf('Итоговая проверка'), 'вывод — раньше подписи «Итоговая проверка»');
  assert.match(text(ok), /Обязательные поля.*10 из 10 · пустых 0/);
  const bad = html(h(review.FinalCheck, { final: final(false, 'Не хватает двух пунктов.') }));
  assert.match(bad, /bg-warn-surface\/50 text-warn-foreground/);
  assert.match(bad, /border-warn\/40/);
});
