"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { AttachIcon, CrossIcon, DocumentIcon, SendIcon } from "@/components/icons";
import { setPendingQuestion } from "@/lib/pending-question";
import { ACCEPTED_FILES, readDocuments, type FailedFile, type SentDocument } from "@/lib/read-documents";

export const SUGGESTIONS = ["Заказчик не подписывает акт — что делать?", "Как вернуть обеспечение заявки?"];

// Вопрос с главной. Здесь только поле и примеры — ответ открывается на экране общего чата.
// Приложенные файлы читаются здесь: если не прочитался ни один, пользователь узнает об этом, не уходя с главной.
export function AskBox() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function ask(question: string) {
    const trimmed = question.trim();
    if ((!trimmed && files.length === 0) || reading) return;
    setError(null);
    let documents: SentDocument[] = [];
    let failed: FailedFile[] = [];
    if (files.length > 0) {
      setReading(true);
      try {
        ({ documents, failed } = await readDocuments(files));
      } catch (e) {
        setError((e as Error).message);
        setReading(false);
        return;
      }
    }
    setPendingQuestion({ text: trimmed, documents, failed });
    router.push("/chat");
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void ask(text);
    }
  }

  function attach(list: FileList | null) {
    const added = list ? [...list] : [];
    const names = new Set(added.map((f) => f.name));
    setFiles((current) => [...current.filter((f) => !names.has(f.name)), ...added]);
  }

  return (
    <section aria-labelledby="ask-title" className="island">
      <div className="island-head">
        <h2 id="ask-title" className="t-section">
          Спросить про тендер
        </h2>
      </div>
      <div className="grid gap-3 px-[var(--pad)] pb-[var(--pad)] pt-1">
        <p className="text-[var(--ink-2)]">Отвечу по 44-ФЗ, 223-ФЗ и вашим документам — со ссылкой на статью и пункт.</p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(text);
          }}
          className="flex items-end gap-1 rounded-[var(--r-card)] border border-[var(--edge-2)] bg-card p-1 shadow-[var(--hairline)] focus-within:border-primary focus-within:shadow-[var(--focus-ring)]"
        >
          <button
            type="button"
            onClick={() => input.current?.click()}
            aria-label="Приложить документ"
            title="Приложить документ"
            className="grid size-8 shrink-0 place-items-center rounded-full text-[var(--ink-3)] hover:bg-[var(--hover)] hover:text-foreground"
          >
            <AttachIcon className="size-4" />
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Ваш вопрос…"
            aria-label="Вопрос"
            className="t-doc field-sizing-content max-h-[140px] min-h-8 min-w-0 flex-1 resize-none bg-transparent py-1.5 outline-none pointer-coarse:text-base"
          />
          <button
            type="submit"
            disabled={reading || (!text.trim() && files.length === 0)}
            aria-label="Спросить"
            className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground hover:bg-[var(--brand-press)] disabled:opacity-40"
          >
            <SendIcon className="size-4" />
          </button>
          <input
            ref={input}
            type="file"
            multiple
            accept={ACCEPTED_FILES}
            className="hidden"
            onChange={(e) => {
              attach(e.currentTarget.files);
              e.currentTarget.value = "";
            }}
          />
        </form>

        {files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {files.map((f) => (
              <span key={f.name} className="file-chip">
                <DocumentIcon className="size-3.5" />
                <span className="truncate">{f.name}</span>
                <button
                  type="button"
                  aria-label={`Убрать ${f.name}`}
                  onClick={() => setFiles((current) => current.filter((x) => x !== f))}
                  className="grid size-6 shrink-0 place-items-center rounded-full text-[var(--ink-3)] hover:bg-[var(--paper-3)] hover:text-foreground"
                >
                  <CrossIcon className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        {reading && <p className="animate-pulse text-[var(--ink-3)]">Читаю файлы…</p>}
        {error && <p className="t-strong text-[var(--warn)]">{error}</p>}

        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => void ask(s)} className="chip">
              {s}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
