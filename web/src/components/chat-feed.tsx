"use client";

import type { ReactNode } from "react";
import type { ChatStatus } from "ai";
import { FileTextIcon, RotateCcwIcon } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import type { ChatMessage } from "@/lib/chat-types";

const STREAMDOWN_RU = {
  close: "Закрыть",
  copied: "Скопировано",
  copyCode: "Копировать код",
  copyLink: "Копировать ссылку",
  copyTable: "Копировать таблицу",
  openExternalLink: "Открыть внешнюю ссылку?",
  externalLinkWarning: "Ссылку написала модель. Проверьте адрес, прежде чем переходить.",
  openLink: "Открыть",
};

const textOf = (message: ChatMessage) =>
  message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");

export const fmtChars = (n: number) =>
  n >= 1000 ? `${Math.round(n / 1000).toLocaleString("ru-RU")} тыс. симв.` : `${n} симв.`;

type ChatFeedProps = {
  messages: ChatMessage[];
  status: ChatStatus;
  error?: Error;
  onRetry: () => void;
  // Что видно, пока вопросов нет: заголовок и подсказки.
  empty: ReactNode;
};

// Поле ввода прижато к низу панели, лента над ним прокручивается сама.
export function ComposerDock({ children }: { children: ReactNode }) {
  return (
    <div className="flex-none border-t border-[var(--line)] bg-card px-[var(--gutter)] pb-[calc(8px+env(safe-area-inset-bottom,0px))] pt-3">
      <div className="mx-auto grid w-full max-w-[728px] gap-1.5">
        {children}
        <p className="t-caption text-center text-[var(--ink-3)]">
          Ответы ИИ не являются юридической консультацией. Проверяйте нормы по первоисточнику.
        </p>
      </div>
    </div>
  );
}

// Рамка поля ввода AI Elements — в скруглении панели, с тонкой тенью.
export const PROMPT_CLASS =
  "[&_[data-slot=input-group]]:rounded-[var(--r-card)] [&_[data-slot=input-group]]:bg-card [&_[data-slot=input-group]]:shadow-[var(--hairline)]";

// Поле вопроса: 14 px и в две строки высотой; на телефоне 16 px, иначе браузер увеличивает страницу.
export const PROMPT_TEXTAREA_CLASS = "min-h-10 text-sm pointer-coarse:text-base";

// Лента вопросов и ответов — общая для чата закупки и общего чата с главной.
export function ChatFeed({ messages, status, error, onRetry, empty }: ChatFeedProps) {
  const last = messages.at(-1);
  const waiting =
    status === "submitted" || (status === "streaming" && last?.role === "assistant" && !textOf(last));

  return (
    <Conversation className="min-h-0">
      {/* Место под полосу прокрутки — только справа, иначе лента съезжает с края текста вкладок */}
      <ConversationContent
        scrollClassName="[scrollbar-gutter:stable]!"
        className="mx-auto w-full max-w-[760px] gap-4 px-[var(--gutter)] pb-3 pt-4"
      >
        {messages.length === 0 ? (
          <ConversationEmptyState className="size-auto items-start justify-start gap-4 p-0 text-left">{empty}</ConversationEmptyState>
        ) : (
          messages.map((m) => {
            const text = textOf(m);
            const files = m.metadata?.files ?? [];
            if (!text && files.length === 0) return null;
            return (
              <Message from={m.role} key={m.id} className={m.role === "assistant" ? "max-w-full" : undefined}>
                {files.length > 0 && (
                  <div className="flex flex-wrap justify-end gap-2">
                    {files.map((name) => (
                      <span key={name} className="file-chip px-3">
                        <FileTextIcon className="size-3.5" />
                        <span className="truncate">{name}</span>
                      </span>
                    ))}
                  </div>
                )}
                {text && (
                  <MessageContent className="group-[.is-user]:max-w-[80%] group-[.is-user]:rounded-[var(--r-bubble)] group-[.is-user]:py-2.5">
                    {m.role === "assistant" ? (
                      <MessageResponse
                        isAnimating={status === "streaming" && m.id === last?.id}
                        linkSafety={{ enabled: true }}
                        translations={STREAMDOWN_RU}
                      >
                        {text}
                      </MessageResponse>
                    ) : (
                      text
                    )}
                  </MessageContent>
                )}
              </Message>
            );
          })
        )}
        {waiting && <p className="animate-pulse text-[var(--ink-3)]">Изучаю документы и закон…</p>}
        {status === "error" && (
          <div className="flex flex-wrap items-center gap-3 text-destructive">
            <span>{error?.message || "Не удалось получить ответ."}</span>
            <button type="button" onClick={onRetry} className="btn btn-line btn-xs">
              <RotateCcwIcon />
              Повторить
            </button>
          </div>
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
