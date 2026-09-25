# Проект

Support-chat SaaS (аналог Intercom) с ИИ-агентом. Проработка в
[e2e-razbor-support-chat-mvp.md](e2e-razbor-support-chat-mvp.md).

## Дизайн-система

Структура компонентов — **AI Elements (Vercel)** поверх shadcn/ui.
Краска, скругления и шрифты — свои, направление **«Индиго + мягкая»**.

- [design-system/brand.css](design-system/brand.css) — **фирменные токены, главный файл**
- [design-system/README.md](design-system/README.md) — обзор AI Elements, установка
- [design-system/tokens.css](design-system/tokens.css) — исходные токены AI Elements (справочно)
- [design-system/components.md](design-system/components.md) — инвентарь компонентов, варианты, пропсы
- [design-system/patterns.md](design-system/patterns.md) — раскладки экранов и правила
- [design-system/mockup/support-chat.html](design-system/mockup/support-chat.html) — макет: виджет и инбокс
- [design-system/mockup/style-directions.html](design-system/mockup/style-directions.html) — конструктор стиля

**Читать перед любой работой по UI.** Ключевое:

- Бренд — живой индиго `#4f46e5` (в тёмной теме светлеет до `#a5b4fc`). Синий и зелёный
  как брендовые не использовать: первый — цвет всей ниши, второй занят статусом.
- Зелёный, янтарь и красный зарезервированы под статусы «закрыл ИИ», «нужен оператор», ошибка.
- Скругления по ролям: 16 рамка / 12 панель / 10 плашка / 8 кнопка и поле / пилюля чип.
  Один радиус на всё не ставить — схлопывает иерархию.
- Шрифты: Montserrat в заголовках и интерфейсе, JetBrains Mono на данных.
  Только с родной кириллицей: Poppins, Geist и Bricolage Grotesque не подходят.
  Заголовки — сжатие -0.02em. Стрелок «← →» в Montserrat нет — только иконками.
- Шкала шрифтов — токены `--t-*` в brand.css, плотная: 12/16 · 13/20 · 14/20 · 16/24 · 20/28. Других кеглей не заводить.
  Интерфейс — 13, текст документов и сообщений — 14, заголовок экрана — 20.
- Текст сообщений — 14/20, поле ввода — 14/20 (на телефоне 16, иначе браузер увеличивает страницу).
- Высоты: кнопка и поле 32, пункт меню 32, шапка экрана и панели 56, строка шагов 48.
- Сообщение пользователя — бабл `--paper-3` справа, ~80% ширины.
  Сообщение ассистента — без фона, во всю ширину.
- Иконочные кнопки в плотных зонах — 28×28, иконка 16.
- Накладки поверх брендовой заливки — от `--on-brand` через `color-mix`, не от белого.

Источник: Figma `NDctJTjd4iyzeT9zWg3WwZ` («AI Elements — ▲ Vercel (Community)»),
документация https://elements.ai-sdk.dev.

Компоненты ставятся поштучно, исходник копируется в проект:

```bash
npx ai-elements@latest add message conversation prompt-input
```
