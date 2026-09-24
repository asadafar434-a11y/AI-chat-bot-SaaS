"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { FileTextIcon, PaperclipIcon, RotateCcwIcon, ScaleIcon, XIcon } from "lucide-react";
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
import { MAX_CONTEXT_CHARS, type ChatDocument, type ChatMessage } from "@/lib/chat-types";

const transport = new DefaultChatTransport<ChatMessage>({ api: "/api/chat" });

const SUGGESTIONS = [
  "Какой срок подачи жалобы в ФАС по 44-ФЗ?",
  "Можно ли требовать опыт работы у участника?",
  "Что проверить в проекте контракта перед подачей заявки?",
];

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

const fmtChars = (n: number) =>
  n >= 1000 ? `${Math.round(n / 1000).toLocaleString("ru-RU")} тыс. симв.` : `${n} симв.`;

type UploadResult = {
  documents: ChatDocument[];
  failed: { name: string; reason: string }[];
};

async function toFile(part: { url: string; filename?: string; mediaType: string }) {
  const blob = await (await fetch(part.url)).blob();
  return new File([blob], part.filename ?? "file", { type: part.mediaType });
}

async function uploadDocuments(files: PromptInputMessage["files"]): Promise<UploadResult> {
  const body = new FormData();
  for (const file of await Promise.all(files.map(toFile))) body.append("files", file);
  const res = await fetch("/api/documents", { method: "POST", body });
  if (!res.ok) throw new Error("Не удалось загрузить документы — повторите.");
  return res.json();
}

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

export default function Home() {
  const { messages, sendMessage, status, stop, error, regenerate } = useChat<ChatMessage>({ transport });
  const [documents, setDocuments] = useState<ChatDocument[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [draft, setDraft] = useState("");

  const busy = status === "submitted" || status === "streaming";
  const last = messages.at(-1);
  const waiting =
    status === "submitted" || (status === "streaming" && last?.role === "assistant" && !textOf(last));
  const requestBody = (docs: ChatDocument[]) => ({
    documents: docs.map(({ name, text }) => ({ name, text })),
  });

  async function send({ text, files }: PromptInputMessage) {
    if (busy) throw new Error("Дождитесь ответа");
    const question = text.trim();
    let docs = documents;
    let attached: string[] = [];
    setNotice(null);

    if (files.length > 0) {
      setUploading(true);
      try {
        const result = await uploadDocuments(files);
        attached = result.documents.map((d) => d.name);
        const replaced = new Set(attached);
        docs = [...documents.filter((d) => !replaced.has(d.name)), ...result.documents];
        setDocuments(docs);
        if (result.failed.length > 0) {
          setNotice(`Не прочитаны: ${result.failed.map((f) => `${f.name} — ${f.reason}`).join("; ")}.`);
        }
      } catch (e) {
        setNotice((e as Error).message);
        throw e;
      } finally {
        setUploading(false);
      }
    }

    if (!question) return;

    const total = docs.reduce((sum, d) => sum + d.chars, 0);
    if (total > MAX_CONTEXT_CHARS) {
      setNotice(
        `Документы слишком большие: ${fmtChars(total)} при лимите ${fmtChars(MAX_CONTEXT_CHARS)} — уберите лишние файлы.`
      );
      return;
    }

    setDraft("");
    void sendMessage(
      {
        text: question,
        metadata: { files: attached, date: new Date().toLocaleDateString("ru-RU") },
      },
      { body: requestBody(docs) }
    );
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
              messages.map((m) => {
                const text = textOf(m);
                const files = m.metadata?.files ?? [];
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
            {waiting && (
              <p className="animate-pulse text-sm text-muted-foreground">
                Изучаю документы и закон…
              </p>
            )}
            {status === "error" && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-destructive">
                <span>{error?.message || "Не удалось получить ответ."}</span>
                <button
                  type="button"
                  onClick={() => regenerate({ body: requestBody(documents) })}
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

        <div className="p-4 pt-2">
          {(documents.length > 0 || uploading) && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">В диалоге:</span>
              {documents.map((d) => (
                <span
                  key={d.id}
                  className="inline-flex h-7 max-w-72 items-center gap-1.5 rounded-[var(--r-pill)] bg-card pl-2.5 pr-1 text-xs font-medium shadow-[var(--lift)]"
                >
                  <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{d.name}</span>
                  <span className="shrink-0 font-normal text-muted-foreground">{fmtChars(d.chars)}</span>
                  <button
                    type="button"
                    aria-label={`Убрать ${d.name} из диалога`}
                    onClick={() => setDocuments((ds) => ds.filter((x) => x.id !== d.id))}
                    className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <XIcon className="size-3" />
                  </button>
                </span>
              ))}
              {uploading && (
                <span className="animate-pulse text-xs text-muted-foreground">Читаю файлы…</span>
              )}
            </div>
          )}
          {notice && <p className="mb-2 text-xs text-[var(--warn)]">{notice}</p>}
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
                placeholder={
                  documents.length > 0 ? "Спросите про загруженные документы…" : "Задайте вопрос по закупке…"
                }
                className="text-base"
              />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                <AttachButton />
              </PromptInputTools>
              <PromptInputSubmit
                status={uploading ? "submitted" : status}
                onStop={stop}
                disabled={uploading}
                className="rounded-full"
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
