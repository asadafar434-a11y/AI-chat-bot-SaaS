# Проект

Support-chat SaaS (аналог Intercom) с ИИ-агентом. Проработка в
[e2e-razbor-support-chat-mvp.md](e2e-razbor-support-chat-mvp.md).

## Дизайн-система

UI строится на **AI Elements (Vercel)** поверх shadcn/ui.
Справочник выгружен из Figma в [design-system/](design-system/):

- [design-system/README.md](design-system/README.md) — обзор, токены-сводка, установка
- [design-system/tokens.css](design-system/tokens.css) — CSS-переменные, light + dark
- [design-system/components.md](design-system/components.md) — инвентарь компонентов, варианты, пропсы
- [design-system/patterns.md](design-system/patterns.md) — раскладки экранов и правила

**Читать перед любой работой по UI.** Ключевое:

- База — shadcn/ui `neutral`, но `--primary` = синий `#155dfc` (не почти-чёрный, как в стоке).
- Базовый радиус 10px (`rounded-lg`), кнопки 8px (`rounded-md`).
- Шрифт Geist. Текст сообщений — `text-sm` (14/20), поле ввода — `text-base` (16/24).
- Сообщение пользователя — бабл `--secondary` справа, ~80% ширины.
  Сообщение ассистента — без фона, во всю ширину.
- Иконочные кнопки в плотных зонах — 28×28, иконка 16.

Источник: Figma `NDctJTjd4iyzeT9zWg3WwZ` («AI Elements — ▲ Vercel (Community)»),
документация https://elements.ai-sdk.dev.

Компоненты ставятся поштучно, исходник копируется в проект:

```bash
npx ai-elements@latest add message conversation prompt-input
```
