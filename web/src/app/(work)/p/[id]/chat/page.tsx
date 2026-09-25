"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ChatFeed, ComposerDock, fmtChars, PROMPT_CLASS, PROMPT_TEXTAREA_CLASS } from "@/components/chat-feed";
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
    <section aria-label="Вопросы по закупке" className="island flex min-h-0 flex-1 flex-col overflow-hidden">
      <ChatFeed
        messages={messages}
        status={status}
        error={error}
        onRetry={() => regenerate({ body })}
        empty={
          <>
            <div className="grid gap-1">
              <h3 className="t-title">Вопросы по закупке</h3>
              <p className="max-w-[62ch] text-[var(--ink-2)]">
                Спросите о чём угодно в этой закупке — отвечу по её документам со ссылкой на пункт и статью закона.
              </p>
              <p className="t-caption text-[var(--ink-3)]">Документы: {purchase.files.join(", ")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => setDraft(s)} className="chip">
                  {s}
                </button>
              ))}
            </div>
          </>
        }
      />

      <ComposerDock>
        {notice && <p className="t-caption text-[var(--warn)]">{notice}</p>}
        <PromptInput onSubmit={send} className={PROMPT_CLASS}>
          <PromptInputBody>
            <PromptInputTextarea
              value={draft}
              onChange={(e) => setDraft(e.currentTarget.value)}
              placeholder="Спросите про документы закупки…"
              className={PROMPT_TEXTAREA_CLASS}
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools />
            <PromptInputSubmit status={status} onStop={stop} className="rounded-full" />
          </PromptInputFooter>
        </PromptInput>
      </ComposerDock>
    </section>
  );
}
