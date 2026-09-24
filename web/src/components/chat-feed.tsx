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

// Лента вопросов и ответов — общая для чата закупки и общего чата с главной.
export function ChatFeed({ messages, status, error, onRetry, empty }: ChatFeedProps) {
  const last = messages.at(-1);
  const waiting =
    status === "submitted" || (status === "streaming" && last?.role === "assistant" && !textOf(last));

  return (
    <Conversation className="min-h-0">
      <ConversationContent className="gap-4">
        {messages.length === 0 ? (
          <ConversationEmptyState className="gap-6">{empty}</ConversationEmptyState>
        ) : (
          messages.map((m) => {
            const text = textOf(m);
            const files = m.metadata?.files ?? [];
            if (!text && files.length === 0) return null;
            return (
              <Message from={m.role} key={m.id}>
                {files.length > 0 && (
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {files.map((name) => (
                      <span
                        key={name}
                        className="inline-flex items-center gap-1.5 rounded-[var(--r-pill)] bg-card px-2.5 py-1 text-xs text-muted-foreground"
                      >
                        <FileTextIcon className="size-3.5" />
                        {name}
                      </span>
                    ))}
                  </div>
                )}
                {text && (
                  <MessageContent className="group-[.is-user]:max-w-[80%] group-[.is-user]:rounded-[var(--r-bubble)]">
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
        {waiting && <p className="animate-pulse text-sm text-muted-foreground">Изучаю документы и закон…</p>}
        {status === "error" && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-destructive">
            <span>{error?.message || "Не удалось получить ответ."}</span>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 rounded-[var(--r-pill)] bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-[var(--lift)] hover:bg-accent"
            >
              <RotateCcwIcon className="size-3.5" />
              Повторить
            </button>
          </div>
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
