# Инвентарь компонентов AI Elements

Для каждого компонента: **варианты в Figma** (= состояния, которые нарисованы) и
**React API** (= пропсы из `elements.ai-sdk.dev`). Размеры в px, взяты из экспорта Figma.

Страницы Figma-файла: Demo, Attachments, Context, Conversation, Checkpoint, Message,
Message Actions, Message Response, Model Selector, Plan, Prompt Input, Queue, Reasoning,
Sources, Suggestion, Task, Tool, Workflow Components, Artifact, File Tree, Terminal,
Code Block, Assets, @shadcn/ui.

---

## Conversation

Скроллируемый контейнер ленты сообщений, прилипающий к низу (`use-stick-to-bottom`).

**Figma:** `state = empty | initial | scrolled`

**API**

| Компонент | Пропсы |
|---|---|
| `Conversation` | `contextRef?: React.Ref<StickToBottomContext>`, `instance?: StickToBottomInstance`, `children` (ReactNode или render-prop) |
| `ConversationContent` | `children`, + div-атрибуты |
| `ConversationEmptyState` | `title?` (по умолч. `"No messages yet"`), `description?` (`"Start a conversation to see messages here"`), `icon?: ReactNode`, `children?` |
| `ConversationScrollButton` | пропсы `Button` |
| `ConversationDownload` | `messages: UIMessage[]` (обяз.), `filename?` (`"conversation.md"`), `formatMessage?`, пропсы `Button` без `onClick` |
| `messagesToMarkdown()` | утилита: массив сообщений в Markdown |

```tsx
<Conversation>
  <ConversationContent>{messages.map(...)}</ConversationContent>
  <ConversationScrollButton />
</Conversation>
```

---

## Message

**Figma:** `from = user | assistant`
Слоты внутри (включаются независимо): `attachments`, `sources`, `reasoning`,
`MessageContent`, `MessageToolbar`.

### Анатомия

**Сообщение пользователя** — бабл, прижатый вправо:

- обёртка `flex-col items-end`
- `MessageContent` — grid `2fr / 8fr`, бабл в правой колонке, то есть **максимум ~80% ширины**
- бабл: `bg: --secondary`, `px: 16`, `py: 12`, `rounded-lg (10)`
- текст: `text-sm` 14/20, `--foreground`
- вложения — сверху над баблом, `flex-wrap`, `gap 8`, `justify-end`, `pb 8`

**Сообщение ассистента** — **без бабла**, во всю ширину:

- обёртка `flex-col items-start`
- порядок слоёв сверху вниз: `Sources`, `Reasoning`, `MessageContent`, `MessageToolbar`
- текст: `text-sm` 14/20, `--foreground`, фона нет

> Ключевое различие системы: у пользователя — плашка, у ассистента — «голый» текст.

### MessageContent

**Figma:** `from = user | assistant` × `content = 1 line | 2+ lines | custom`
**API:** `React.HTMLAttributes<HTMLDivElement>`

### MessageResponse

Рендер Markdown-потока (через Streamdown), корректно переживает обрыв разметки при стриминге.

| Проп | Тип | По умолчанию |
|---|---|---|
| `children` | `string` (markdown) | — |
| `parseIncompleteMarkdown` | `boolean` | `true` |
| `components` | объект кастомных рендереров | — |
| `allowedImagePrefixes` | `string[]` | `["*"]` |
| `allowedLinkPrefixes` | `string[]` | `["*"]` |
| `defaultOrigin` | `string` | — |
| `remarkPlugins` | массив | `[remarkGfm, remarkMath]` |
| `rehypePlugins` | массив | `[rehypeKatex]` |

> `allowedLinkPrefixes` и `allowedImagePrefixes` по умолчанию `*`. Для чата,
> где текст генерирует модель на пользовательских данных, это стоит сузить.

### MessageToolbar

**Figma:** `Branch = true | false` × `Actions = true | false`
Строка под сообщением: `pt 16`, слева селектор веток (`flex-1`), справа действия.
**API:** `React.ComponentProps<"div">` — раскладка row + space-between.

### MessageActions / MessageAction

**Figma:** `Message Actions: actions = 2 | 4 | 6`; `MessageAction: state = default | hover`

- кнопка **28×28** (`size-7`), `rounded-md (8)`, фон прозрачный, иконка **16**
- вариант `MessageAction (Detached)` — **32×32** (для действий вне тулбара)
- расстояние между действиями `gap 4`
- при наведении — Tooltip сверху: `bg --foreground`, текст `--background` `text-xs`,
  `px 12`, `py 6`, `rounded-md (8)`, тень `shadow-md`

Готовые подписи из макета: ассистент — Regenerate response / Like this response / Dislike /
Copy to clipboard; пользователь — Copy / Report response / Edit.

**API:** `MessageAction`: `tooltip?: string`, `label: string` (для screen reader), пропсы `Button`.

### MessageBranch

Переключатель альтернативных ответов вида `1 of 3` со стрелками.

- кнопки-стрелки 28×28, текст `text-xs medium`, `--muted-foreground`, `px 16`, табличные цифры
- `MessageBranch`: `defaultBranch?: number` (0), `onBranchChange?: (i) => void`
- `MessageBranchContent`, `MessageBranchSelector` (ButtonGroup), `MessageBranchPrevious`,
  `MessageBranchNext`, `MessageBranchPage`

---

## PromptInput

Самый сложный компонент системы: форма ввода с вложениями, инструментами и отправкой.

**Figma:** `state = placeholder | filled | filled + attachments | focused`

### Анатомия

```
PromptInput            border 1px --input · rounded-lg (10) · bg --components-input-bg · p 1
├─ PromptInputHeader   px 10 · pt 8 · pb 6 · gap 4        (опционален)
│   ├─ ряд HoverCard-триггеров   gap 4
│   └─ Attachments (inline)      flex-wrap · gap 8
├─ PromptInputBody
│   └─ Textarea        p 12 · min-h 64 · max-h 192 · text-base 16/24
└─ PromptInputFooter   px 10 · pt 6 · pb 8 · gap 8 · items-center
    ├─ PromptInputTools  flex-1 · gap 4
    └─ PromptInputSubmit
```

**Размеры элементов подвала**

| Элемент | Размер |
|---|---|
| `PromptInputActionMenu` (иконка) | 28×28, `rounded-md`, фон прозрачный, иконка 16 |
| `PromptInputSpeechButton` | 28×28, иконка 16 |
| `PromptInputButton` с подписью | h 28, `pl 6` / `pr 10`, `gap 6`, иконка 14, текст `text-xs medium` `--muted-foreground` |
| `ModelSelectorTrigger` | h 28, `pl 6` / `pr 10`, `gap 4`, иконка 14 |
| `PromptInputSubmit` | 28×28, `bg --primary`, `rounded-md`, иконка 16 |
| `PromptInputHoverCardTrigger` | 32×32 (иконка) или h 32 `pl 8`/`pr 10`; рамка + фон, `rounded-lg (10)` |

**Вложение inline** (в шапке ввода): h 32, рамка `--border`, `rounded-md (8)`, `gap 6`;
превью 20×20 `rounded (4)`; имя файла `text-sm medium` с многоточием; кнопка удаления 20×20
поверх превью, `opacity 0` до наведения.

### Варианты подвала

**Figma `PromptInputFooter: layout = basic | ChatGPT | Claude | Grok | Cursor`** —
пять эталонных раскладок панели инструментов, скопированных с реальных продуктов.

### Состояния кнопок

- `PromptInputSubmit`: `size = icon-sm | sm` × `status = ready | submitted | submitted + <Loader> | streaming | error`
- `PromptInputButton`: `size = icon-sm | sm` × `state = default | hover | toggled`
- `PromptInputActionMenu`: `size` × `state = default | hover` × `open = true | false`
- `PromptInputSpeechButton`: `size` × `state = default | hover | isListening | isListening - pulse`
- `PromptInputHoverCardTrigger`: `size = icon-sm | sm` × `open`
- `PromptInputHoverCardContent`: `children = Command | Rules | TabsList | custom | custom (no padding)`
- `PromptInputCommand`: `empty = true | false`
- `PromptInputTabsList`: `composition = AI Elements | DropdownMenu | Command`

### API

`PromptInput`: `onSubmit`, `accept`, `multiple`, `globalDrop`, `syncHiddenInput`,
`maxFiles`, `maxFileSize`, `onError` + атрибуты формы.

Структурные: `PromptInputHeader`, `PromptInputBody`, `PromptInputFooter`, `PromptInputTextarea`
(авторесайз по контенту), `PromptInputTools`.

Кнопки: `PromptInputButton` (`tooltip`: строка либо объект `{content, shortcut, side}`),
`PromptInputSubmit` (`status: ChatStatus`).

Select: `PromptInputSelect`, `PromptInputSelectTrigger`, `PromptInputSelectContent`,
`PromptInputSelectItem`, `PromptInputSelectValue`.

Меню действий: `PromptInputActionMenu`, `PromptInputActionMenuTrigger`,
`PromptInputActionMenuContent`, `PromptInputActionMenuItem`,
`PromptInputActionAddAttachments` (`label`, по умолч. `"Add photos or files"`),
`PromptInputActionAddScreenshot` (`"Take screenshot"`).

Прочее: `PromptInputProvider` (`initialInput`), `PromptInputHoverCard` (`openDelay`, `closeDelay`),
`PromptInputHoverCardContent` (`align`, по умолч. `"start"`), `PromptInputTabsList` / `Tab` /
`TabLabel` / `TabBody` / `TabItem`, семейство `PromptInputCommand*`.

Хуки: `usePromptInputAttachments()`, `usePromptInputController()` (только внутри провайдера),
`useProviderAttachments()`, `usePromptInputReferencedSources()`.

```tsx
<PromptInput onSubmit={handleSubmit}>
  <PromptInputHeader><PromptInputAttachmentsDisplay /></PromptInputHeader>
  <PromptInputBody><PromptInputTextarea /></PromptInputBody>
  <PromptInputFooter>
    <PromptInputTools>
      <PromptInputActionMenu>
        <PromptInputActionMenuTrigger />
        <PromptInputActionMenuContent><PromptInputActionAddAttachments /></PromptInputActionMenuContent>
      </PromptInputActionMenu>
    </PromptInputTools>
    <PromptInputSubmit status={status} />
  </PromptInputFooter>
</PromptInput>
```

---

## Reasoning

Сворачиваемый блок «ход мыслей». Открывается сам при старте стриминга и закрывается по окончании.

**Figma:** `Reasoning: open · isStreaming · hover`; `ReasoningTrigger: open × state = default | hover × isStreaming`

**Анатомия:** `gap 16`, `pb 16`. Триггер: иконка `Brain` 16 + текст «Thought for N seconds»
`text-sm`, цвет `--muted-foreground`, на hover `--foreground`; шеврон 16 поворачивается на 180°.
Контент: `text-sm`, `--muted-foreground`.

**API**

- `Reasoning`: `isStreaming?` (false), `open?`, `defaultOpen?` (**true**), `onOpenChange?`, `duration?: number`
- `ReasoningTrigger`: `getThinkingMessage?: (isStreaming, duration?) => ReactNode`
- `ReasoningContent`: `children: string` (обяз., рендерится через Streamdown)
- `useReasoning()` возвращает `{ isStreaming, isOpen, setIsOpen, duration }`

---

## Sources

Сворачиваемый список источников ответа.

**Figma:** `SourcesTrigger: open`, счётчик `count`

**Анатомия:** контейнер `gap 12`, `pb 16`. Триггер «Used N sources» — `text-xs medium`,
цвет **`--primary`**, рядом шеврон 16. Каждый `Source`: иконка `Book` 16 + заголовок
`text-xs medium` `--primary`, `gap 8`, высота 16.

**API**

- `Sources`: div-атрибуты
- `SourcesTrigger`: `count: number` (обяз.)
- `SourcesContent`: div-атрибуты
- `Source`: атрибуты `<a>` (`href`, `title`)

---

## Suggestion

Горизонтальный ряд кликабельных подсказок (внутри `ScrollArea`).

- `Suggestions`: пропсы `ScrollArea`
- `Suggestion`: `suggestion: string` (обяз.), `onClick?: (suggestion: string) => void`, пропсы `Button` без `onClick`

---

## Tool

Сворачиваемая карточка вызова инструмента.

- `Tool`: пропсы `Collapsible` (`defaultOpen`)
- `ToolHeader`: `type` (обяз.), `state` (обяз.), `title?`, `toolName?` (обяз. для динамических инструментов), `className?`
- `ToolContent`: пропсы `CollapsibleContent`
- `ToolInput`: `input` — параметры, рендерятся как форматированный JSON
- `ToolOutput`: `output: ReactNode`, `errorText?: string`
- `getStatusBadge(state)` — бейдж состояния: pending, running, awaiting approval, responded, completed, error, denied

---

## Task

Список шагов работы с иконками статуса (pending / in-progress / completed / error).

- `Task`: `defaultOpen?` (**true**) + пропсы `Collapsible`
- `TaskTrigger`: `title: string` (обяз.)
- `TaskContent`, `TaskItem`, `TaskItemFile` — div-атрибуты

---

## Context

Индикатор расхода токенов с раскрытием по наведению.

- `Context`: `maxTokens`, `usedTokens`, `usage: LanguageModelUsage`, `modelId` + пропсы `HoverCard`
- `ContextTrigger`, `ContextContent`, `ContextContentHeader` (прогресс), `ContextContentBody`, `ContextContentFooter` (стоимость)
- Разбивка: `ContextInputUsage`, `ContextOutputUsage`, `ContextReasoningUsage`, `ContextCacheUsage`

---

## Attachments

**Figma:** `Attachment: variant = grid | inline` × `preview = image / video | icon` × `state = default`

**Размеры:**

- **grid** — плитка **96×96**, `bg --muted`, `rounded-lg (10)`; кнопка удаления — круг 20×20
  в правом верхнем углу (отступ 8), `backdrop-blur-sm`, фон `--background/80`, иконка `X` 12
- **inline** — чип h 32 с рамкой `--border`, `rounded-md (8)` (см. PromptInput выше)
- контейнер: `flex-wrap`, `gap 8`

**API**

- `Attachments`: `variant?: "grid" | "inline" | "list"` (по умолч. `"grid"`)
- `Attachment`: `data: (FileUIPart | SourceDocumentUIPart) & { id: string }`, `onRemove?: () => void`
- `AttachmentPreview`: `fallbackIcon?: ReactNode`
- `AttachmentInfo`: `showMediaType?` (false)
- `AttachmentRemove`: `label?` (`"Remove"`)
- `AttachmentHoverCard`, `AttachmentHoverCardTrigger`, `AttachmentHoverCardContent` (`align`, по умолч. `"start"`), `AttachmentEmpty`
- утилиты: `getMediaCategory(data)`, `getAttachmentLabel(data)`

---

## Model Selector

Диалог выбора модели на базе Command (поиск как в command palette).

`ModelSelector` (Dialog), `ModelSelectorTrigger`, `ModelSelectorContent` (`title`, по умолч. `"Model Selector"`),
`ModelSelectorDialog`, `ModelSelectorInput`, `ModelSelectorList`, `ModelSelectorEmpty`,
`ModelSelectorGroup` (группировка по провайдеру), `ModelSelectorItem`, `ModelSelectorShortcut`,
`ModelSelectorSeparator`, `ModelSelectorLogo` (`provider: string`, обяз.), `ModelSelectorLogoGroup`, `ModelSelectorName`.

---

## Code Block

`CodeBlock`: `code: string`, `language: BundledLanguage`, `showLineNumbers?` (false)

Части: `CodeBlockHeader`, `CodeBlockTitle`, `CodeBlockFilename`, `CodeBlockActions`,
`CodeBlockCopyButton` (`onCopy`, `onError`, `timeout` = 2000),
`CodeBlockLanguageSelector` (+ `Trigger` / `Value` / `Content` / `Item`),
`CodeBlockContainer`, `CodeBlockContent`.

---

## Artifact

Панель результата (документ, код, превью) сбоку от чата.

`Artifact`, `ArtifactHeader`, `ArtifactTitle`, `ArtifactDescription`, `ArtifactActions`,
`ArtifactAction` (`tooltip`, `label`, `icon: LucideIcon`), `ArtifactClose`, `ArtifactContent`.

---

## Plan

Карточка плана работ с shimmer-анимацией во время стриминга.

`Plan` (`isStreaming?` false, `defaultOpen?`), `PlanHeader`, `PlanTitle`, `PlanDescription`,
`PlanTrigger`, `PlanContent`, `PlanFooter`, `PlanAction`.

---

## Queue

Очередь задач с секциями и отметками выполнения.

`Queue`, `QueueSection` (`defaultOpen?` true), `QueueSectionTrigger`,
`QueueSectionLabel` (`label`, `count`, `icon?`), `QueueSectionContent`, `QueueList` (ScrollArea),
`QueueItem`, `QueueItemIndicator` (`completed?` false), `QueueItemContent` (`completed?`),
`QueueItemDescription` (`completed?`), `QueueItemActions`, `QueueItemAction`,
`QueueItemAttachment`, `QueueItemImage`, `QueueItemFile`.

---

## Checkpoint

Метка точки в истории диалога с возможностью откатиться.

`Checkpoint` (контейнер с авторазделителем), `CheckpointIcon` (по умолч. `BookmarkIcon`),
`CheckpointTrigger` (`tooltip?`, `variant` = `"ghost"`, `size` = `"sm"`).

---

## Chain of Thought

Пошаговая цепочка рассуждений — более структурная альтернатива `Reasoning`.

`ChainOfThought` (`open?`, `defaultOpen?` **false**, `onOpenChange?`),
`ChainOfThoughtHeader` (children по умолч. `"Chain of Thought"`),
`ChainOfThoughtStep` (`icon?` = `DotIcon`, `label`, `description?`, `status?: "complete" | "active" | "pending"` = `complete`),
`ChainOfThoughtContent`, `ChainOfThoughtSearchResults`, `ChainOfThoughtSearchResult` (Badge),
`ChainOfThoughtImage` (`caption?`).

---

## Inline Citation

Сноска вида `[1]` внутри текста ответа с карточкой источника по наведению.

`InlineCitation`, `InlineCitationText`, `InlineCitationCard` (HoverCard),
`InlineCitationCardTrigger` (`sources: string[]` — длина задаёт счётчик), `InlineCitationCardBody`,
`InlineCitationCarousel` (+ `Content` / `Item` / `Header` / `Index` / `Prev` / `Next`),
`InlineCitationSource` (`title`, `url`, `description?`), `InlineCitationQuote`.

---

## Confirmation

Запрос подтверждения перед выполнением инструмента (human-in-the-loop).

`Confirmation` (`approval: ToolUIPart["approval"]`, `state: ToolUIPart["state"]`; рендерится как Alert),
`ConfirmationTitle`, `ConfirmationRequest` (виден при `approval-requested`),
`ConfirmationAccepted` / `ConfirmationRejected` (видны при `approval-responded`,
`output-denied`, `output-available`), `ConfirmationActions` (только при `approval-requested`),
`ConfirmationAction` (кнопка `h-8 px-3 text-sm`).

---

## Shimmer

Анимация загрузки — блик, пробегающий по тексту.

`Shimmer`: `children: string`, `as?: ElementType` (`"p"`), `duration?: number` (2),
`spread?: number` (2), `className?`. Мемоизирован, Framer Motion + CSS-градиент.

---

## Terminal / File Tree

Для IDE-сценариев (в Figma — страницы Terminal, File Tree и демо-экран «IDE»).

`Terminal`: `output: string` (с поддержкой ANSI), `isStreaming?` (false), `autoScroll?` (**true**), `onClear?`
Части: `TerminalHeader`, `TerminalTitle`, `TerminalStatus`, `TerminalActions`,
`TerminalCopyButton` (`onCopy`, `onError`, `timeout` = 2000), `TerminalClearButton`, `TerminalContent`.

`FileTree` — дерево с `FileTreeFolder` и `FileTreeFile` (строка 28px, как в макете IDE).

---

## Что есть в библиотеке, но не нарисовано в этом Figma-файле

Voice (Audio Player, Mic Selector, Persona, Speech Input, Transcription, Voice Selector),
Agent, Commit, Environment Variables, JSX Preview, Package Info, Sandbox, Schema Display,
Snippet, Stack Trace, Test Results, Web Preview, Image, Open In Chat.
