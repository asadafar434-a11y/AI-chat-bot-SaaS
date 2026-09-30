"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { BotMark } from "@/components/bot-mark";
import { AttachIcon, CrossIcon, DocumentIcon } from "@/components/icons";
import { ChatFeed, ComposerDock, fmtChars, PROMPT_CLASS, PROMPT_TEXTAREA_CLASS } from "@/components/chat-feed";
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
import { ACCEPTED_FILES, readDocuments, type FailedFile, type SentDocument } from "@/lib/read-documents";

const transport = new DefaultChatTransport<ChatMessage>({ api: "/api/chat" });

const SUGGESTIONS = ["Заказчик не подписывает акт — что делать?", "Как вернуть обеспечение заявки?"];

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
        <span key={f.id} className="file-chip max-w-60">
          <DocumentIcon className="size-3.5" />
          <span className="truncate">{f.filename}</span>
          <button
            type="button"
            aria-label={`Убрать ${f.filename}`}
            onClick={() => remove(f.id)}
            className="grid size-6 shrink-0 place-items-center rounded-full text-[var(--ink-3)] hover:bg-[var(--paper-3)] hover:text-foreground"
          >
            <CrossIcon className="size-3.5" />
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
      <AttachIcon className="size-3.5" />
      Документ
    </PromptInputButton>
  );
}

// Общий разговор: вопросы не об одной закупке. Живёт и на странице «Спросить ИИ», и во всплывающем окне с роботом.
// Документы — только в этом разговоре: закрыли вкладку — разговор начнётся заново. globalDrop — принимать файлы,
// брошенные в любое место окна: у скрытого всплывающего окна он выключен, чтобы не перехватывать чужие перетаскивания.
export function GeneralChat({ globalDrop = true }: { globalDrop?: boolean }) {
  const { messages, sendMessage, status, stop, error, regenerate } = useChat<ChatMessage>({ transport });
  const [documents, setDocuments] = useState<SentDocument[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [draft, setDraft] = useState("");

  const busy = status === "submitted" || status === "streaming";
  const requestBody = (docs: SentDocument[]) => ({ documents: docs, general: true });

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
    <section aria-label="Разговор" className="island flex min-h-0 flex-1 flex-col overflow-hidden">
        <ChatFeed
          messages={messages}
          status={status}
          error={error}
          onRetry={() => regenerate({ body: requestBody(documents) })}
          empty={
            <>
              <div className="grid gap-1">
                <BotMark className="mb-2 size-12" />
                <h2 className="t-title">Общий вопрос по 44-ФЗ и 223-ФЗ</h2>
                <p className="max-w-[62ch] text-[var(--ink-2)]">
                  Отвечу со ссылкой на статью закона. Приложите документ — отвечу и по нему.
                </p>
                <p className="t-caption max-w-[62ch] text-[var(--ink-3)]">
                  Вопрос про конкретную закупку задайте внутри неё, в «Вопросах» — отвечу по её документам.
                </p>
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
          {(documents.length > 0 || uploading) && (
            <div className="t-caption flex flex-wrap items-center gap-2 text-[var(--ink-3)]">
              <span>В разговоре:</span>
              {documents.map((d) => (
                <span key={d.name} className="file-chip max-w-72 text-foreground">
                  <DocumentIcon className="size-3.5" />
                  <span className="truncate">{d.name}</span>
                  <span className="shrink-0 text-[var(--ink-3)]">{fmtChars(d.text.length)}</span>
                  <button
                    type="button"
                    aria-label={`Убрать ${d.name} из разговора`}
                    onClick={() => setDocuments((ds) => ds.filter((x) => x.name !== d.name))}
                    className="grid size-6 shrink-0 place-items-center rounded-full text-[var(--ink-3)] hover:bg-[var(--paper-3)] hover:text-foreground"
                  >
                    <CrossIcon className="size-3.5" />
                  </button>
                </span>
              ))}
              {uploading && <span className="animate-pulse">Читаю файлы…</span>}
            </div>
          )}
          {notice && <p className="t-caption text-[var(--warn)]">{notice}</p>}
          <PromptInput
            onSubmit={async ({ text, files }: PromptInputMessage) => ask(text, await Promise.all(files.map(toFile)))}
            multiple
            globalDrop={globalDrop}
            accept={ACCEPTED_FILES}
            className={PROMPT_CLASS}
          >
            <AttachmentChips />
            <PromptInputBody>
              <PromptInputTextarea
                value={draft}
                onChange={(e) => setDraft(e.currentTarget.value)}
                placeholder={documents.length > 0 ? "Спросите про приложенные документы…" : "Задайте вопрос по закупкам…"}
                className={PROMPT_TEXTAREA_CLASS}
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
        </ComposerDock>
      </section>
  );
}
