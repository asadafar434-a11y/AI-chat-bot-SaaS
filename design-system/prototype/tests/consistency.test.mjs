// Единообразие и адаптивность по гайдлайну (CLAUDE.md, «Читать перед любой работой по UI»): заголовки, высоты, защита от поломок на телефоне — npm test в design-system/prototype.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const src = (rel) => readFileSync(path.resolve(import.meta.dirname, '..', 'src', rel), 'utf8');

test('заголовки экранов — 20 пикселей (text-xl), заголовки шагов закупки — 24: не вперемешку', () => {
  for (const file of ['components/TendersDashboard.tsx', 'components/Tariffs.tsx', 'components/BidHistory.tsx', 'components/Settings.tsx', 'components/TenderSearch.tsx']) {
    const h1 = /<h1 className="([^"]*)"/.exec(src(file));
    assert.ok(h1, `${file}: нет заголовка h1`);
    assert.match(h1[1], /\btext-xl\b/, `${file}: заголовок экрана должен быть text-xl, а не ${h1[1]}`);
    assert.doesNotMatch(h1[1], /text-2xl/, `${file}: text-2xl — размер заголовка шага`);
  }
  for (const file of ['components/StepReview.tsx', 'components/StepPackage.tsx']) {
    assert.match(src(file), /<h1[^>]*text-2xl/, `${file}: заголовок шага — text-2xl`);
  }
});

test('шаги закупки на телефоне: строка шагов прокручивается к текущему; низ страницы свободен от плавающей кнопки ИИ', () => {
  const app = src('App.tsx');
  assert.match(app, /data-step-active=\{state === 'active'\}/);
  assert.match(app, /list\.scrollLeft \+= c\.left - l\.left/);
  assert.match(app, /max-w-6xl pt-2 pb-24 lg:pt-0 lg:pb-4/);
});

test('шаги закупки: пройденные — зелёная галочка, текущий — синяя плашка с белым значком', () => {
  const app = src('App.tsx');
  assert.match(app, /border-success bg-success text-background/, 'пройденный шаг — зелёная галочка');
  assert.match(app, /border-primary-foreground\/30 bg-primary-foreground text-primary/, 'текущий шаг — белый значок с синей иконкой');
  assert.match(app, /bg-primary font-semibold text-primary-foreground shadow-sm/, 'текущий шаг — синяя акцентная плашка');
});

test('переключатели и фильтры — высота 32 из шкалы 28/32/36, а не подбор отступами', () => {
  assert.match(src('components/StepPackage.tsx'), /inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium/);
  assert.match(src('components/TendersDashboard.tsx'), /inline-flex h-8 items-center gap-1\.5 rounded-md border px-3 text-xs font-medium/);
});

test('смысловой текст в свёрнутых пунктах проверки переносится, а не обрезается многоточием («число, не меньше 150»)', () => {
  const review = src('components/StepReview.tsx');
  const rows = review.split('\n').filter((l) => /field\.(label|problem|value)/.test(l) && /className=/.test(l));
  assert.ok(rows.length >= 3);
  for (const l of rows) assert.doesNotMatch(l, /\btruncate\b/, `обрезается: ${l.trim().slice(0, 80)}`);
});

test('меню: блоки не сжимаются при низком окне (кнопка «Новая закупка» не становится 20 пикселей), меню прокручивается', () => {
  const sidebar = src('components/Sidebar.tsx');
  const panels = sidebar.split('\n').filter((l) => /overflow-y-auto/.test(l) && /flex-col/.test(l));
  assert.equal(panels.length, 2, 'две панели: телефонное меню и боковое на компьютере');
  for (const l of panels) assert.match(l, /\[&>\*\]:shrink-0/, 'у панели меню нет запрета на сжатие блоков');
});

test('поля ввода: стиль берётся из общего fieldClass (36/14 и компактное 32/13), своих копий в экранах нет', async () => {
  const { readdirSync } = await import('node:fs');
  const dir = path.resolve(import.meta.dirname, '..', 'src', 'components');
  const copies = readdirSync(dir)
    .filter((f) => f.endsWith('.tsx') && f !== 'ui.tsx')
    .filter((f) => /const inputClass =\s*'/.test(readFileSync(path.join(dir, f), 'utf8')));
  assert.deepEqual(copies, [], `свои копии стиля поля: ${copies.join(', ')} — используйте fieldClass из ui.tsx`);
  const ui = src('components/ui.tsx');
  assert.match(ui, /'h-9 w-full px-3 text-sm'/);
  assert.match(ui, /'h-8 w-full px-2\.5 text-\[13px\]'/);
});

test('«Состав исполнителей» свёрнут по умолчанию; в заголовке — что осталось; кнопка на «Проверке» раскрывает его', () => {
  const cast = src('components/CastCard.tsx');
  assert.match(cast, /useState\(false\)/, 'карточка свёрнута до нажатия');
  assert.match(cast, /осталось: \$\{pending\.length\}/);
  assert.match(cast, /addEventListener\(CAST_OPEN_EVENT/);
  const review = src('components/StepReview.tsx');
  assert.match(review, /dispatchEvent\(new Event\('tl:open-cast'\)\)/);
  assert.match(cast, /CAST_OPEN_EVENT = 'tl:open-cast'/);
});

test('«Калькулятор»: кнопка «Подставить значения с ИИ» платная — не работает при выключенном «ИИ», проверка стоит до запроса, цена написана рядом', () => {
  const calc = src('components/Calculator.tsx');
  const guard = calc.indexOf('assertAiEnabled();');
  const request = calc.indexOf("fetch('/api/calculator-ai-fill'");
  assert.ok(guard > 0 && request > guard, 'проверка переключателя — до запроса к серверу');
  assert.match(calc, /disabled=\{aiBusy \|\| !aiOn\}/);
  assert.match(calc, /Платно: /);
  assert.match(calc, /Режим «Вручную» бесплатный/);
  assert.match(calc, /ИИ выключен: включите переключатель «ИИ» в шапке меню/);
});

test('карточки экрана закупки в «Аналитике» выглядят одинаково: заголовок 15 пикселей жирным, внутренний отступ p-4', () => {
  const cards = ['PositionPrices', 'ExecutionCost', 'CustomerQuotes', 'CrewCost', 'ServiceVolume'];
  for (const name of cards) {
    const src = readFileSync(new URL('../src/components/' + name + '.tsx', import.meta.url), 'utf8');
    assert.ok(src.includes('<p className="text-[15px] font-bold">'), name + ': заголовок карточки — 15 пикселей жирным');
    assert.equal(src.includes('<p className="text-[14px] font-bold">'), false, name + ': заголовок карточки не 14 пикселей');
    assert.match(src, /<Card className="space-y-\d p-4">/, name + ': карточка с отступом p-4');
  }
});

test('одно скругление для карточек, полей и кнопок: все размеры радиуса равны --radius (решение владельца 30.10.2026)', () => {
  const css = src('index.css');
  assert.match(css, /--radius: 12px;/);
  for (const size of ['md', 'lg', 'xl', '2xl']) assert.ok(css.includes(`--radius-${size}: var(--radius);`), size);
});

test('кнопки, которые вызывают ИИ, — вариант ai: значок ИИ и градиент от голубого к фиолетовому', () => {
  const ui = src('components/ui.tsx');
  assert.match(ui, /ai: 'bg-brand-gradient text-white/);
  assert.match(ui, /variant === 'ai' &&/);
  assert.match(src('index.css'), /\.bg-brand-gradient \{\s*background-image: linear-gradient\(135deg, #2f5bff[^;]*#7a4dff/);
  for (const file of ['components/HiddenRequirements.tsx', 'components/StepAnalysis.tsx', 'components/Profile.tsx', 'components/Calculator.tsx', 'components/EvidenceBase.tsx', 'components/AnalyticsSummary.tsx', 'real/review.tsx', 'components/StepPackage.tsx']) {
    assert.match(src(file), /variant="ai"/, file);
  }
});

test('карточка закупки: цена в строке заголовка, прогресс зелёный на 100 %, «Отметить поданной» и «Удалить» внизу', () => {
  const card = src('components/TendersDashboard.tsx');
  assert.match(card, /justify-between[^"]*"[^>]*>\s*<p className="min-w-0 flex-1 text-sm font-medium leading-snug">\{t\.title\}<\/p>/);
  assert.match(card, /progress >= 100 \? 'bg-success' : 'bg-foreground'/);
  assert.ok(card.lastIndexOf('Отметить поданной') > card.indexOf('{progress}%'), 'кнопка внизу, рядом с прогрессом');
  for (const file of ['components/Analytics.tsx', 'components/TenderSearch.tsx']) assert.match(src(file), /justify-between gap-x-4/, file);
});
