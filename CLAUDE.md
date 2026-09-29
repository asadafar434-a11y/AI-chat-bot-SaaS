# Проект

Support-chat SaaS (аналог Intercom) с ИИ-агентом. Проработка в
[e2e-razbor-support-chat-mvp.md](e2e-razbor-support-chat-mvp.md).

## Дизайн-система

Стиль — **Figma Make**: чёрно-белый интерфейс в духе shadcn/ui, шрифт Geist, иконки с путями Lucide.
Решение владельца 29.09.2026: «Всё как в Figma Make». Чат в приложении — компоненты **AI Elements (Vercel)**.

- [design-system/prototype/](design-system/prototype/) — **прототип, главный образец**: React + Vite + Tailwind v4,
  токены — `src/index.css`. Сборка в одну страницу — `npm run build` → `dist/prototype.html`
- [design-system/brand.css](design-system/brand.css) — фирменные токены стиля Figma Make
- «Улучшение прототипа из GitHub/» — исходник из Figma Make как есть. Новые версии из Make кладутся туда,
  изменения переносятся в `design-system/prototype/`
- [design-system/legacy/brand-indigo.css](design-system/legacy/brand-indigo.css), `design-system/mockup/*`,
  [components.md](design-system/components.md), [patterns.md](design-system/patterns.md) — прежний стиль
  «Индиго + мягкая», справочно. **Приложение `web/` пока в нём** — перевод на новый стиль отдельной задачей;
  до перевода в `web/` действуют прежние правила: иконки Craftwork (`web/src/components/icons.tsx`), lucide запрещён линтером
- [design-system/README.md](design-system/README.md) — обзор AI Elements, установка

**Читать перед любой работой по UI.** Ключевое:

- Логотип — медаль с хрустальными весами (Figma `NDctJTjd4iyzeT9zWg3WwZ`, узел `8064:410`), растр с прозрачным
  фоном — [design-system/logo.png](design-system/logo.png). В прототипе — `BrandMark`, в приложении —
  `web/src/components/brand-mark.tsx`; значки сайта — `web/src/app/favicon.ico`, `icon.png`, `apple-icon.png`.
  Другим значком логотип не заменять.
- Основное действие — почти чёрный `#0a0a0a` (в тёмной теме — светлый `#f4f4f5`). Холст `#f2f3f5`, карточки белые.
- Индиго-градиент `#4f46e5 → #6366f1 → #3b82f6` (класс `bg-brand-gradient`) — только кнопка чата
  и главное платное действие (проверка специалистом). Сплошной индиго `--info` — «ввести вручную» и замечания юриста.
- Статусы: зелёный — готово; янтарь — дописать или подтвердить; красный — ошибка, отклонят.
  Жёлтая подсветка `mark.highlight` — место в тексте заявки, которое дописывает человек.
- Тёмная тема — графитовая (`#17181b` холст, `#212226` карточки), не чёрная: слои должны различаться.
- Скругления: 16 — сайдбар и шапка закупки; 12 — карточки; 8 — кнопки, поля, строки; пилюля — бейджи.
- Шрифты: Geist — интерфейс, Geist Mono — числа, номера, реквизиты.
  Кегли: 24 заголовок шага, 20 заголовок экрана, 14 текст, 13 плотный интерфейс, 12 подписи, 11 бейджи, 10 мелкие метки.
- Высоты: кнопка и поле 36 (компактные 32), иконочная кнопка 28 с иконкой 16.
- Иконки — пути Lucide в `design-system/prototype/src/lib/icons.tsx` (свой набор, без пакета lucide-react), линия 2.
- У каждой иконочной кнопки — подсказка (`IconButton`), у терминов (НМЦК, обеспечение) — `HelpTip`.
  Скрытая подсказка не занимает места (`display: none`), иначе на телефоне раздвигает страницу.
- Чего система ещё не умеет, не прятать и не выдавать за работающее: помечать «скоро» (`Soon`) —
  поиск по площадкам, история с итогами торгов, импорт по ссылке ЕИС, формат ODT.
- Окна (`Modal`) — через портал в `body`: внутри анимированного блока `fixed` считается от блока, а не от экрана.
- Сетки из колонок — `grid-cols-1` / `minmax(0, …)`: иначе длинная строка с `truncate` раздвигает колонку.

Источник: Figma `NDctJTjd4iyzeT9zWg3WwZ` («AI Elements — ▲ Vercel (Community)»),
документация https://elements.ai-sdk.dev.

Компоненты ставятся поштучно, исходник копируется в проект:

```bash
npx ai-elements@latest add message conversation prompt-input
```
