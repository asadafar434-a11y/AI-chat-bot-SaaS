"use client";

import { useState } from "react";
import type { ChatStatus } from "ai";
import { FileTextIcon, PaperclipIcon, ScaleIcon, XIcon } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  files?: string[];
};

const SUGGESTIONS = [
  "Какой срок подачи жалобы в ФАС по 44-ФЗ?",
  "Можно ли требовать опыт работы у участника?",
  "Что проверить в проекте контракта перед подачей заявки?",
];

function AttachmentChips() {
  const { files, remove } = usePromptInputAttachments();
  if (files.length === 0) return null;
  return (
    <PromptInputHeader>
      {files.map((f) => (
        <span
          key={f.id}
          className="inline-flex h-8 max-w-60 items-center gap-1.5 rounded-[var(--r-pill)] bg-muted pl-2.5 pr-1 text-xs font-medium"
        >
          <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{f.filename}</span>
          <button
            type="button"
            aria-label={`Убрать ${f.filename}`}
            onClick={() => remove(f.id)}
            className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </button>
        </span>
      ))}
    </PromptInputHeader>
  );
}

function AttachButton() {
  const { openFileDialog } = usePromptInputAttachments();
  return (
    <PromptInputButton onClick={openFileDialog} tooltip="Загрузить документ">
      <PaperclipIcon className="size-3.5" />
      Документ
    </PromptInputButton>
  );
}

async function toFile(part: { url: string; filename?: string; mediaType: string }) {
  const blob = await (await fetch(part.url)).blob();
  return new File([blob], part.filename ?? "file", { type: part.mediaType });
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("ready");
  const [draft, setDraft] = useState("");

  async function send({ text, files }: PromptInputMessage) {
    const question = text.trim();
    if (!question && files.length === 0) return;

    setMessages((m) => [
      ...m,
      {
        id: crypto.randomUUID(),
        role: "user",
        text: question,
        files: files.map((f) => f.filename ?? "file"),
      },
    ]);
    setDraft("");
    setStatus("submitted");

    try {
      const body = new FormData();
      body.set("question", question);
      for (const f of await Promise.all(files.map(toFile))) body.append("files", f);

      const res = await fetch("/api/ask", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка запроса");

      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "assistant", text: data.answer },
      ]);
      setStatus("ready");
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: `Не получилось ответить: ${(e as Error).message}`,
        },
      ]);
      setStatus("error");
    }
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-2.5 px-4 py-3">
        <span className="grid size-8 place-items-center rounded-[11px] bg-primary text-primary-foreground">
          <ScaleIcon className="size-4" />
        </span>
        <span className="font-heading text-[17px] font-bold tracking-[-0.03em]">
          Тендерный юрист
        </span>
        <span className="rounded-[var(--r-pill)] bg-[var(--ground-2)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
          44-ФЗ · 223-ФЗ
        </span>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
        <Conversation className="min-h-0">
          <ConversationContent className="gap-4">
            {messages.length === 0 ? (
              <ConversationEmptyState className="gap-6">
                <div className="space-y-2">
                  <h1 className="font-heading text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">
                    Спросите про тендер
                  </h1>
                  <p className="mx-auto max-w-md text-sm text-muted-foreground">
                    Загрузите документацию закупки, проект контракта или протокол —
                    отвечу со ссылкой на норму закона и пункт вашего документа.
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
              </ConversationEmptyState>
            ) : (
              messages.map((m) => (
                <Message from={m.role} key={m.id}>
                  {m.files && m.files.length > 0 && (
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {m.files.map((name) => (
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
                  {m.text && (
                    <MessageContent className="group-[.is-user]:max-w-[80%] group-[.is-user]:rounded-[var(--r-bubble)]">
                      {m.role === "assistant" ? (
                        <MessageResponse>{m.text}</MessageResponse>
                      ) : (
                        m.text
                      )}
                    </MessageContent>
                  )}
                </Message>
              ))
            )}
            {status === "submitted" && (
              <p className="animate-pulse text-sm text-muted-foreground">
                Изучаю документы и закон…
              </p>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="p-4 pt-2">
          <PromptInput
            onSubmit={send}
            multiple
            globalDrop
            className="[&_[data-slot=input-group]]:rounded-[var(--r-surface)] [&_[data-slot=input-group]]:bg-card"
          >
            <AttachmentChips />
            <PromptInputBody>
              <PromptInputTextarea
                value={draft}
                onChange={(e) => setDraft(e.currentTarget.value)}
                placeholder="Задайте вопрос по закупке…"
                className="text-base"
              />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                <AttachButton />
              </PromptInputTools>
              <PromptInputSubmit
                status={status}
                className="rounded-full"
                disabled={status === "submitted"}
              />
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
