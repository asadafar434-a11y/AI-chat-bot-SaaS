"use client";

import { useState } from "react";
import { AlertTriangleIcon, CheckIcon, PencilIcon } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { FileDrop } from "@/components/file-drop";
import { WorkingSteps } from "@/components/working-steps";
import { plural } from "@/lib/plural";
import { readDocuments, type SentDocument } from "@/lib/read-documents";
import type { TpItem, TpResponse } from "@/lib/tp";

type Stage =
  | { kind: "upload"; error?: string }
  | { kind: "working" }
  | { kind: "draft"; files: string[]; subject: string; notice?: string };

const WORKING_STEPS = [
  "Читаю ТЗ…",
  "Разбираю требования по пунктам…",
  "Пишу предложение по каждому пункту…",
  "Сверяю цитаты с ТЗ…",
];

const needsFill = (text: string) => /\[[^\]]+\]/.test(text);

function OfferText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[[^\]]+\])/).filter(Boolean).map((part, i) =>
        /^\[[^\]]+\]$/.test(part) ? (
          <mark key={i} className="rounded-md bg-[var(--warn-tint)] px-1 font-semibold text-[var(--warn)]">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

export default function TpPage() {
  const [stage, setStage] = useState<Stage>({ kind: "upload" });
  const [items, setItems] = useState<TpItem[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [quoteOpen, setQuoteOpen] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function compose(files: File[] | null) {
    setStage({ kind: "working" });
    try {
      const documents: SentDocument[] = files ? (await readDocuments(files)).documents : [];

      const res = await fetch("/api/tp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(files ? { documents } : { sample: true }),
      });
      if (!res.ok) throw new Error((await res.text()) || "Не удалось составить черновик.");
      const data: TpResponse = await res.json();

      setItems(data.items);
      setEditing(null);
      setQuoteOpen(null);
      setStage({ kind: "draft", files: documents.map((d) => d.name), subject: data.subject, notice: data.notice });
      window.scrollTo(0, 0);
    } catch (e) {
      setStage({ kind: "upload", error: (e as Error).message });
    }
  }

  async function download(subject: string) {
    setDownloading(true);
    setDownloadError(null);
    try {
      const res = await fetch("/api/tp/docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          items: items.map(({ clause, requirement, offer }) => ({ clause, requirement, offer })),
        }),
      });
      if (!res.ok) throw new Error((await res.text()) || "Не удалось собрать файл.");
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "Техническое предложение.docx";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setDownloadError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  const updateOffer = (index: number, offer: string) =>
    setItems((list) => list.map((item, i) => (i === index ? { ...item, offer } : item)));

  const fill = items.filter((it) => needsFill(it.offer)).length;
  const unverified = items.filter((it) => !it.verified).length;

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-[680px] px-4 pb-10">
        {stage.kind === "upload" && (
          <>
            <h1 className="mt-6 font-heading text-[clamp(24px,5vw,32px)] font-bold leading-[1.15] tracking-[-0.04em] text-balance">
              Техническое предложение по ТЗ
            </h1>
            <p className="mt-3 max-w-[46ch] text-[17px] leading-[26px] text-[var(--ink-2)]">
              Загрузите техническое задание — пройду его пункт за пунктом и напишу черновик предложения. Вам останется вписать свои данные.
            </p>
            {stage.error && (
              <p className="mt-5 rounded-[var(--r-card)] bg-[var(--warn-tint)] px-4 py-3 font-medium text-[var(--warn)]">
                {stage.error}
              </p>
            )}
            <FileDrop
              hint="Перетащите файл ТЗ сюда — PDF или Word"
              button="Загрузить ТЗ"
              onFiles={(files) => void compose(files)}
              onSample={() => void compose(null)}
            />
          </>
        )}

        {stage.kind === "working" && <WorkingSteps steps={WORKING_STEPS} />}

        {stage.kind === "draft" && (
          <>
            <p className="mt-5 text-sm text-muted-foreground">
              {stage.files.length ? `Файл: ${stage.files.join(", ")}` : "Пример на тестовом ТЗ"}
            </p>
            <h1 className="mt-2 font-heading text-[clamp(24px,5vw,32px)] font-bold leading-[1.15] tracking-[-0.04em] text-balance">
              Техническое предложение
            </h1>
            {stage.subject && <p className="mt-2 text-[17px] leading-[26px] text-[var(--ink-2)]">{stage.subject}</p>}

            {stage.notice && (
              <p className="mt-5 rounded-[var(--r-card)] bg-card px-4 py-3 text-[15px] text-[var(--ink-2)]">{stage.notice}</p>
            )}
            <div
              className={`mt-5 flex items-center gap-3 rounded-[var(--r-card)] px-4 py-3.5 font-semibold ${
                fill ? "bg-[var(--warn-tint)] text-[var(--warn)]" : "bg-[var(--ok-tint)] text-[var(--ok)]"
              }`}
            >
              {fill ? <PencilIcon className="size-5 shrink-0" /> : <CheckIcon className="size-5 shrink-0" />}
              {fill
                ? `Впишите свои данные в ${fill} ${plural(fill, "пункт", "пункта", "пунктов")} — они выделены жёлтым. Нажмите на текст, чтобы исправить.`
                : "Всё заполнено — можно скачивать."}
            </div>
            {unverified > 0 && (
              <div className="mt-2 flex items-center gap-3 rounded-[var(--r-card)] bg-[var(--warn-tint)] px-4 py-3.5 font-semibold text-[var(--warn)]">
                <AlertTriangleIcon className="size-5 shrink-0" />
                {`В ${unverified} ${plural(unverified, "пункте", "пунктах", "пунктах")} цитата не найдена в ТЗ дословно — сверьте их вручную.`}
              </div>
            )}

            <ol className="mt-4 overflow-hidden rounded-[var(--r-surface)] bg-card">
              {items.map((it, i) => (
                <li key={i} className="grid gap-1.5 border-t border-border px-5 py-[18px] first:border-t-0">
                  <div className="flex flex-wrap items-baseline gap-x-2.5">
                    <h2 className="text-base font-bold">{i + 1}. {it.topic}</h2>
                    {needsFill(it.offer) && <span className="text-[13px] font-semibold text-[var(--warn)]">впишите данные</span>}
                  </div>
                  <p className="text-[14.5px] leading-[21px] text-muted-foreground">
                    В ТЗ{it.clause ? `, п. ${it.clause}` : ""}: {it.requirement} ·{" "}
                    <button
                      type="button"
                      onClick={() => setQuoteOpen(quoteOpen === i ? null : i)}
                      className="font-medium text-primary underline underline-offset-4"
                    >
                      {quoteOpen === i ? "скрыть цитату" : "цитата"}
                    </button>
                  </p>
                  {quoteOpen === i && (
                    <blockquote className="rounded-[14px] bg-muted px-4 py-3 text-[14.5px] leading-[22px]">
                      {it.quote}
                    </blockquote>
                  )}
                  {!it.verified && (
                    <p className="flex items-center gap-2 text-[13.5px] font-medium text-[var(--warn)]">
                      <AlertTriangleIcon className="size-4 shrink-0" />
                      Не нашёл эту цитату в ТЗ дословно — сверьте пункт вручную.
                    </p>
                  )}
                  {editing === i ? (
                    <textarea
                      autoFocus
                      value={it.offer}
                      onChange={(e) => updateOffer(i, e.target.value)}
                      onBlur={() => setEditing(null)}
                      aria-label={`Предложение: ${it.topic}`}
                      className="field-sizing-content -mx-2 min-h-12 resize-none rounded-[10px] bg-muted px-2 py-1.5 text-base leading-6 outline-none ring-2 ring-primary"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditing(i)}
                      aria-label={`Изменить предложение: ${it.topic}`}
                      className="-mx-2 rounded-[10px] px-2 py-1.5 text-left text-base leading-6 whitespace-pre-wrap hover:bg-muted"
                    >
                      <OfferText text={it.offer} />
                    </button>
                  )}
                </li>
              ))}
            </ol>

            <p className="mt-5 text-[15px] text-muted-foreground">
              Не то ТЗ?{" "}
              <button
                type="button"
                onClick={() => { setStage({ kind: "upload" }); setItems([]); }}
                className="font-semibold text-primary underline underline-offset-4"
              >
                Загрузить другое
              </button>
            </p>

            <div className="sticky bottom-0 mt-2 grid gap-2 bg-gradient-to-b from-transparent to-background to-30% pb-[calc(16px+env(safe-area-inset-bottom,0px))] pt-4">
              <button
                type="button"
                onClick={() => void download(stage.subject)}
                disabled={downloading}
                className="min-h-[52px] justify-self-start rounded-[var(--r-ctl)] bg-primary px-6 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60 max-[480px]:justify-self-stretch"
              >
                {downloading ? "Собираю файл…" : "Скачать в Word"}
              </button>
              {downloadError && <p className="text-sm font-medium text-destructive">{downloadError}</p>}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
