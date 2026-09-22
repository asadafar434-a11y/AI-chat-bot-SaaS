# AI Elements — дизайн-система

Источник: Figma **«AI Elements — ▲ Vercel (Community)»**
`https://www.figma.com/design/NDctJTjd4iyzeT9zWg3WwZ/` · file key `NDctJTjd4iyzeT9zWg3WwZ`
Код и документация: **https://elements.ai-sdk.dev**

## Что это

Библиотека UI-компонентов для AI-приложений от Vercel, построенная **поверх shadcn/ui**.
Figma-файл — зеркало кодовой библиотеки: имена слоёв = имена React-компонентов,
варианты в Figma = пропсы в коде. Поэтому дизайн переносится в код почти 1:1.

Стек, на который рассчитана система: **React 19 + Next.js 14+ (App Router) + Tailwind CSS 4 + shadcn/ui + AI SDK**.

## Файлы

| Файл | Содержимое |
|---|---|
| [tokens.css](tokens.css) | Все токены как CSS-переменные, light + dark. Готово к копированию в `globals.css` |
| [components.md](components.md) | Инвентарь компонентов: анатомия, размеры, варианты Figma, пропсы React |
| [patterns.md](patterns.md) | Как из компонентов собирается экран чата; правила и антипаттерны |

## Установка компонентов

Ставятся поштучно, как в shadcn — исходник копируется в проект (`@/components/ai-elements/`):

```bash
npx ai-elements@latest add message conversation prompt-input response
```

Через shadcn CLI — то же самое:

```bash
npx shadcn@latest add @ai-elements/message
```

Если shadcn/ui ещё не инициализирован, первая же установка настроит его сама.

## Ключевые факты о токенах

- **База — shadcn/ui `neutral`**, но `--primary` переопределён на **синий `#155dfc`** (blue-600),
  `--primary-foreground` — `#eff6ff` (blue-50). Это отличие от стокового shadcn, где primary почти чёрный.
- **Базовый радиус — 10px** (`--radius`, он же `rounded-lg`). Отсюда `rounded-md` = 8px, `rounded-sm` = 6px.
- **Шрифт — Geist** (+ Geist Mono для кода).
- Рабочий диапазон кеглей в интерфейсе узкий: **12 / 14 / 16 px**.
  `text-sm` (14/20) — основной текст сообщений; `text-base` (16/24) — только поле ввода; `text-xs` (12/16) — метаданные.
- В тёмной теме `--border` и `--input` — **полупрозрачный белый** (10% и 15%), а не плотный серый.
  Поле ввода дополнительно получает заливку `rgba(255,255,255,0.043)`.

### Цвета — сводка

| Токен | Light | Dark | Где применяется |
|---|---|---|---|
| `--background` | `#ffffff` | `#0a0a0a` | фон страницы |
| `--foreground` | `#0a0a0a` | `#fafafa` | основной текст |
| `--muted-foreground` | `#737373` | `#a1a1a1` | reasoning, лейблы, счётчики, плейсхолдеры |
| `--secondary` | `#f5f5f5` | `#262626` | фон бабла сообщения пользователя |
| `--muted` | `#f5f5f5` | `#262626` | подложка превью вложений |
| `--primary` | `#155dfc` | `#155dfc` | кнопка Submit, ссылки на источники |
| `--primary-foreground` | `#eff6ff` | `#eff6ff` | иконка внутри Submit |
| `--border` | `#e5e5e5` | `rgba(255,255,255,.10)` | разделители, рамки вложений |
| `--input` | `#e5e5e5` | `rgba(255,255,255,.15)` | рамка PromptInput |
| `--focus` | `#a1a1a1` | `#737373` | focus-ring |

## Оговорка по числам из Figma

В экспортированном коде некоторых инстансов попадаются дробные значения
(`11.4px`, `12.8px`, `7px`) — это артефакт масштабирования вложенных компонентов на канвасе.
Канонические значения всегда берутся из переменных: `text-xs` = 12, `spacing/1_5` = 6.
В [components.md](components.md) указаны канонические.
