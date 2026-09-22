# Паттерны сборки

Как из компонентов AI Elements собираются экраны. Раскладки взяты со страницы
**Demo** в Figma — там пять эталонных экранов: `chatbot`, `tool`, `artifact`, `IDE`, `canvas`.

---

## 1. Базовый чат (экран `chatbot`)

Самая частая раскладка и отправная точка для чата поддержки.

```
колонка 464–768 px
┌──────────────────────────┐
│  Conversation            │  flex-1, скролл, прилипание к низу
│  └─ ConversationContent  │  padding 16, gap между сообщениями 16
│       Message (user)     │
│       Message (assistant)│
│  └─ ConversationScroll…  │  всплывает, когда лента отскроллена вверх
├──────────────────────────┤
│  зона ввода   padding 16 │
│  └─ PromptInput          │
└──────────────────────────┘
```

Измерения из макета: колонка чата **464** (компактная) или **768** (просторная);
внутренние отступы `ConversationContent` — **16**; шаг между сообщениями — **16**;
зона ввода — обёртка с `padding 16` вокруг `PromptInput`.

```tsx
<div className="flex h-full flex-col">
  <Conversation className="flex-1">
    <ConversationContent>
      {messages.length === 0 && <ConversationEmptyState />}
      {messages.map((m) => (
        <Message from={m.role} key={m.id}>
          <MessageContent>
            <MessageResponse>{m.text}</MessageResponse>
          </MessageContent>
        </Message>
      ))}
    </ConversationContent>
    <ConversationScrollButton />
  </Conversation>

  <div className="p-4">
    <PromptInput onSubmit={handleSubmit}>
      <PromptInputBody><PromptInputTextarea /></PromptInputBody>
      <PromptInputFooter>
        <PromptInputTools>{/* … */}</PromptInputTools>
        <PromptInputSubmit status={status} />
      </PromptInputFooter>
    </PromptInput>
  </div>
</div>
```

---

## 2. Чат с инструментами (экран `tool`)

Колонка **768** по центру области 1280. Ответ ассистента — составной:
внутри одного `Message` идут `Tool`, `Reasoning`, `Sources` и текст.
Справа в подвале ввода — бейдж `Context` (78×32) с расходом токенов.

```tsx
<Message from="assistant">
  <Sources>
    <SourcesTrigger count={sources.length} />
    <SourcesContent>{sources.map(s => <Source href={s.url} title={s.title} key={s.url} />)}</SourcesContent>
  </Sources>

  <Reasoning isStreaming={isReasoning}>
    <ReasoningTrigger />
    <ReasoningContent>{reasoningText}</ReasoningContent>
  </Reasoning>

  <Tool defaultOpen={false}>
    <ToolHeader state={tool.state} type="tool-search_kb" />
    <ToolContent>
      <ToolInput input={tool.input} />
      <ToolOutput errorText={tool.errorText} output={tool.output} />
    </ToolContent>
  </Tool>

  <MessageContent><MessageResponse>{text}</MessageResponse></MessageContent>

  <MessageToolbar>
    <MessageBranchSelector>…</MessageBranchSelector>
    <MessageActions>
      <MessageAction label="Regenerate" tooltip="Regenerate response">…</MessageAction>
    </MessageActions>
  </MessageToolbar>
</Message>
```

**Порядок слоёв в ответе ассистента фиксирован:**
`Sources` → `Reasoning` → `Tool` → `MessageContent` → `MessageToolbar`.

---

## 3. Чат + панель результата (экран `artifact`)

Двухколоночная раскладка 1280: чат **439** слева, `Artifact` **841** справа (внутренний отступ 8).
Применимо, когда ассистент отдаёт документ, отчёт или превью.

---

## 4. Рабочее пространство (экран `IDE`)

Три колонки внутри 1280: `FileTree` **320** | редактор **638** (`CodeBlock` 638 + `Terminal` 256) |
правый рельс **320** (`Plan` → `Queue` → `Conversation` → `PromptInput` 296).
Здесь чат сжат до вспомогательной панели — тот же `Conversation` + `PromptInput`, но уже 296 px.

---

## 5. Холст (экран `canvas`)

`Canvas` 1280×896 из группы Workflow Components — визуальный редактор потоков
(Node, Edge, Connection, Controls, Panel, Toolbar).

---

## Правила системы

**Сообщения**

1. Пользователь — бабл `--secondary`, справа, максимум ~80% ширины.
   Ассистент — без фона, во всю ширину. Не давать ассистенту бабл.
2. Тело сообщения всегда `text-sm` (14/20). `text-base` (16) — только в поле ввода.
3. Аватарок в системе нет: роль читается по выравниванию и наличию фона.

**Цвет**

4. `--primary` (синий `#155dfc`) применяется скупо: кнопка отправки и ссылки на источники.
   Всё остальное — нейтральная шкала.
5. Всё второстепенное — `--muted-foreground`: reasoning, счётчики, подписи кнопок в подвале ввода,
   имена моделей, плейсхолдеры.
6. Разделители и рамки — `--border`; рамка поля ввода — `--input`.
   В тёмной теме оба полупрозрачно-белые, не серые.

**Размеры и ритм**

7. Иконочная кнопка в плотных зонах (тулбар сообщения, подвал ввода) — **28×28**, иконка 16,
   `rounded-md (8)`. Отдельно стоящая — 32×32.
8. Иконка рядом с текстом в подвале ввода — **14**, а не 16.
9. Базовый радиус — 10 (`rounded-lg`): поле ввода, бабл сообщения, плитка вложения.
   Кнопки и чипы — 8 (`rounded-md`). Мелкие превью — 4.
10. Шаг сетки — 4. Реально используемые отступы: 4, 6, 8, 10, 12, 16, 20.

**Состояния**

11. `PromptInputSubmit.status` отражает жизненный цикл запроса:
    `ready` → `submitted` → `streaming` → `error`. Иконка и поведение меняются сами.
12. Сворачиваемые блоки открыты по-разному по умолчанию:
    `Reasoning` — **открыт**, `Task` — **открыт**, `ChainOfThought` — **закрыт**, `Tool` — по `defaultOpen`.
13. Во время стриминга: `Reasoning` раскрывается сам и закрывается по завершении;
    у `Plan` заголовок и описание получают `Shimmer`.
14. Hover-состояния нарисованы для всех интерактивных элементов
    (`MessageAction`, `PromptInputButton`, `ReasoningTrigger`) — не пропускать их при реализации.

**Доступность**

15. `MessageAction` требует `label` для скринридера, даже когда задан `tooltip`.
16. Числа в счётчике веток (`1 of 3`) — табличные цифры, чтобы не прыгала ширина.

---

## Чего в системе нет

Нет аватаров, нет таймстампов сообщений, нет индикатора «печатает…» в виде трёх точек
(вместо него — `Shimmer` и статусы `PromptInputSubmit`), нет непрочитанных и статусов доставки.
Для чата поддержки всё это придётся добавлять поверх — и делать это в той же токен-системе:
`text-xs` + `--muted-foreground` для метаданных, 28px для иконочных кнопок.
