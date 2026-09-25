"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { BackLink } from "@/components/back-link";
import { ChatFeed, fmtChars } from "@/components/chat-feed";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { usePurchase } from "@/components/purchase-provider";
import { MAX_CONTEXT_CHARS, type ChatMessage } from "@/lib/chat-types";
import { titleOf } from "@/lib/purchase";

const transport = new DefaultChatTransport<ChatMessage>({ api: "/api/chat" });

const SUGGESTIONS = [
  "Какие документы нужны для заявки?",
  "Какое обеспечение нужно и как его внести?",
  "Что проверить в проекте контракта перед подачей?",
];

export default function ChatPage() {
  const { purchase, documents, update } = usePurchase();
  // История вопросов хранится в закупке: вернулись через неделю — диалог на месте.
  const { messages, sendMessage, status, stop, error, regenerate } = useChat<ChatMessage>({
    id: purchase.id,
    messages: purchase.chat ?? [],
    transport,
    onFinish: ({ messages: all }) => update({ chat: all }),
  });
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const busy = status === "submitted" || status === "streaming";
  const total = documents.reduce((sum, d) => sum + d.text.length, 0);
  const body = { documents };

  function send({ text }: PromptInputMessage) {
    const question = text.trim();
    if (!question || busy) return;
    if (total > MAX_CONTEXT_CHARS) {
      setNotice(
        `Документы закупки слишком большие: ${fmtChars(total)} при лимите ${fmtChars(MAX_CONTEXT_CHARS)}. Уберите из закупки лишние файлы.`
      );
      return;
    }
    setNotice(null);
    setDraft("");
    void sendMessage({ text: question, metadata: { date: new Date().toLocaleDateString("ru-RU") } }, { body });
  }

  return (
    <div className="flex h-[calc(100dvh-var(--shell-top))] flex-col">
      <div className="mx-auto w-full max-w-3xl px-4">
        <BackLink href={`/p/${purchase.id}`}>{titleOf(purchase)}</BackLink>
      </div>

      <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
        <ChatFeed
          messages={messages}
          status={status}
          error={error}
          onRetry={() => regenerate({ body })}
          empty={
            <>
              <div className="space-y-2">
                <h1 className="font-heading text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
                  Спросите про эту закупку
                </h1>
                <p className="mx-auto max-w-md text-sm text-muted-foreground">
                  Отвечу по документам закупки со ссылкой на пункт и статью закона.
                </p>
                <p className="mx-auto max-w-md text-xs text-muted-foreground">
                  Документы: {purchase.files.join(", ")}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setDraft(s)}
                    className="rounded-[var(--r-pill)] bg-card px-3.5 py-2.5 text-[12.5px] font-medium shadow-[var(--lift)] hover:bg-accent"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </>
          }
        />

        <div className="p-4 pt-2">
          {notice && <p className="mb-2 text-xs text-[var(--warn)]">{notice}</p>}
          <PromptInput
            onSubmit={send}
            className="[&_[data-slot=input-group]]:rounded-[var(--r-surface)] [&_[data-slot=input-group]]:bg-card"
          >
            <PromptInputBody>
              <PromptInputTextarea
                value={draft}
                onChange={(e) => setDraft(e.currentTarget.value)}
                placeholder="Спросите про документы закупки…"
                className="text-base"
              />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools />
              <PromptInputSubmit status={status} onStop={stop} className="rounded-full" />
            </PromptInputFooter>
          </PromptInput>
          <p className="pt-2.5 text-center text-[11px] text-muted-foreground">
            Ответы ИИ не являются юридической консультацией. Проверяйте нормы по первоисточнику.
          </p>
        </div>
      </main>
    </div>
  );
}
