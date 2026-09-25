"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { FileTextIcon, PaperclipIcon, XIcon } from "lucide-react";
import { SUGGESTIONS } from "@/components/ask-box";
import { BackLink } from "@/components/back-link";
import { ChatFeed, fmtChars } from "@/components/chat-feed";
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
import { MAX_CONTEXT_CHARS, type ChatMessage } from "@/lib/chat-types";
import { takePendingQuestion } from "@/lib/pending-question";
import { ACCEPTED_FILES, readDocuments, type FailedFile, type SentDocument } from "@/lib/read-documents";

const transport = new DefaultChatTransport<ChatMessage>({ api: "/api/chat" });

const today = () => new Date().toLocaleDateString("ru-RU");

const failedNotice = (failed: FailedFile[]) =>
  failed.length ? `Не прочитаны: ${failed.map((f) => `${f.name} — ${f.reason}`).join("; ")}.` : null;

async function toFile(part: { url: string; filename?: string; mediaType: string }) {
  const blob = await (await fetch(part.url)).blob();
  return new File([blob], part.filename ?? "file", { type: part.mediaType });
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
    <PromptInputButton onClick={openFileDialog} tooltip="Приложить документ">
      <PaperclipIcon className="size-3.5" />
      Документ
    </PromptInputButton>
  );
}

// Общий чат: вопросы не об одной закупке. Сюда же попадает вопрос, заданный на главной.
// Документы живут только в этом разговоре: вернулись на главную — разговор начнётся заново.
export default function GeneralChatPage() {
  const { messages, sendMessage, status, stop, error, regenerate } = useChat<ChatMessage>({ transport });
  const [documents, setDocuments] = useState<SentDocument[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [draft, setDraft] = useState("");

  const busy = status === "submitted" || status === "streaming";
  const requestBody = (docs: SentDocument[]) => ({ documents: docs, general: true });

  // Вопрос с главной уходит сразу, документы к нему главная уже прочитала.
  const receivePending = useEffectEvent(() => {
    const pending = takePendingQuestion();
    if (!pending) return;
    setDocuments(pending.documents);
    setNotice(failedNotice(pending.failed));
    if (!pending.text) return;
    void sendMessage(
      { text: pending.text, metadata: { files: pending.documents.map((d) => d.name), date: today() } },
      { body: requestBody(pending.documents) }
    );
  });
  // Отправка — в следующем такте. В режиме разработки React монтирует страницу дважды,
  // и чат при первом размонтировании молча отменил бы уже начатую отправку.
  useEffect(() => {
    const timer = setTimeout(() => receivePending(), 0);
    return () => clearTimeout(timer);
  }, []);

  async function ask(question: string, files: File[]) {
    if (busy) throw new Error("Дождитесь ответа");
    let docs = documents;
    let attached: string[] = [];
    setNotice(null);

    if (files.length > 0) {
      setUploading(true);
      try {
        const result = await readDocuments(files);
        attached = result.documents.map((d) => d.name);
        const replaced = new Set(attached);
        docs = [...documents.filter((d) => !replaced.has(d.name)), ...result.documents];
        setDocuments(docs);
        setNotice(failedNotice(result.failed));
      } catch (e) {
        setNotice((e as Error).message);
        throw e;
      } finally {
        setUploading(false);
      }
    }

    const text = question.trim();
    if (!text) return;

    const total = docs.reduce((sum, d) => sum + d.text.length, 0);
    if (total > MAX_CONTEXT_CHARS) {
      setNotice(
        `Документы слишком большие: ${fmtChars(total)} при лимите ${fmtChars(MAX_CONTEXT_CHARS)} — уберите лишние файлы.`
      );
      return;
    }

    setDraft("");
    void sendMessage({ text, metadata: { files: attached, date: today() } }, { body: requestBody(docs) });
  }

  return (
    <div className="flex h-[calc(100dvh-var(--shell-top))] flex-col">
      <div className="mx-auto w-full max-w-3xl px-4">
        <BackLink href="/">Главная</BackLink>
      </div>

      <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
        <ChatFeed
          messages={messages}
          status={status}
          error={error}
          onRetry={() => regenerate({ body: requestBody(documents) })}
          empty={
            <>
              <div className="space-y-2">
                <h1 className="font-heading text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
                  Спросите про тендер
                </h1>
                <p className="mx-auto max-w-md text-sm text-muted-foreground">
                  Отвечу по 44-ФЗ и 223-ФЗ со ссылкой на статью. Приложите документ — отвечу и по нему.
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
          {(documents.length > 0 || uploading) && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">В разговоре:</span>
              {documents.map((d) => (
                <span
                  key={d.name}
                  className="inline-flex h-7 max-w-72 items-center gap-1.5 rounded-[var(--r-pill)] bg-card pl-2.5 pr-1 text-xs font-medium shadow-[var(--lift)]"
                >
                  <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{d.name}</span>
                  <span className="shrink-0 font-normal text-muted-foreground">{fmtChars(d.text.length)}</span>
                  <button
                    type="button"
                    aria-label={`Убрать ${d.name} из разговора`}
                    onClick={() => setDocuments((ds) => ds.filter((x) => x.name !== d.name))}
                    className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <XIcon className="size-3" />
                  </button>
                </span>
              ))}
              {uploading && <span className="animate-pulse text-xs text-muted-foreground">Читаю файлы…</span>}
            </div>
          )}
          {notice && <p className="mb-2 text-xs text-[var(--warn)]">{notice}</p>}
          <PromptInput
            onSubmit={async ({ text, files }: PromptInputMessage) => ask(text, await Promise.all(files.map(toFile)))}
            multiple
            globalDrop
            accept={ACCEPTED_FILES}
            className="[&_[data-slot=input-group]]:rounded-[var(--r-surface)] [&_[data-slot=input-group]]:bg-card"
          >
            <AttachmentChips />
            <PromptInputBody>
              <PromptInputTextarea
                value={draft}
                onChange={(e) => setDraft(e.currentTarget.value)}
                placeholder={documents.length > 0 ? "Спросите про приложенные документы…" : "Задайте вопрос по закупкам…"}
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
