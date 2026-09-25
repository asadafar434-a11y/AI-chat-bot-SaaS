"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpIcon, FileTextIcon, PaperclipIcon, XIcon } from "lucide-react";
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
    <section
      aria-labelledby="ask-title"
      className="mt-5 grid gap-3.5 rounded-[var(--r-surface)] bg-card px-[22px] py-[22px] max-[480px]:px-4 max-[480px]:py-[18px]"
    >
      <h2
        id="ask-title"
        className="font-heading text-[clamp(21px,4.4vw,26px)] font-bold leading-[1.2] tracking-[-0.02em] text-balance"
      >
        Спросите про тендер
      </h2>
      <p className="max-w-[50ch] text-base leading-6 text-[var(--ink-2)]">
        Отвечу по 44-ФЗ, 223-ФЗ и вашим документам — со ссылкой на статью и пункт.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(text);
        }}
        className="flex items-end gap-1.5 rounded-[var(--r-surface)] p-2 ring-[1.5px] ring-[var(--edge-2)] ring-inset focus-within:ring-2 focus-within:ring-primary"
      >
        <button
          type="button"
          onClick={() => input.current?.click()}
          aria-label="Приложить документ"
          className="grid size-[38px] shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <PaperclipIcon className="size-[19px]" />
        </button>
        <textarea
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Ваш вопрос…"
          aria-label="Вопрос"
          className="field-sizing-content max-h-[120px] min-h-[38px] min-w-0 flex-1 resize-none bg-transparent py-[7px] text-base leading-6 outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          disabled={reading || (!text.trim() && files.length === 0)}
          aria-label="Спросить"
          className="grid size-[38px] shrink-0 place-items-center rounded-full bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          <ArrowUpIcon className="size-[18px]" />
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
        <div className="flex flex-wrap gap-1.5">
          {files.map((f) => (
            <span
              key={f.name}
              className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-[var(--r-pill)] bg-muted pl-3 pr-1 text-[13px] font-medium"
            >
              <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{f.name}</span>
              <button
                type="button"
                aria-label={`Убрать ${f.name}`}
                onClick={() => setFiles((current) => current.filter((x) => x !== f))}
                className="grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      {reading && <p className="animate-pulse text-sm text-muted-foreground">Читаю файлы…</p>}
      {error && <p className="text-sm font-medium text-[var(--warn)]">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => void ask(s)}
            className="rounded-[var(--r-pill)] bg-muted px-[15px] py-[9px] text-left text-[15px] font-medium leading-5 hover:bg-accent"
          >
            {s}
          </button>
        ))}
      </div>
    </section>
  );
}
