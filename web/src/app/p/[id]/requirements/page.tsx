"use client";

import { useState } from "react";
import { AlertTriangleIcon, ClockIcon } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { FileDrop } from "@/components/file-drop";
import { WorkingSteps } from "@/components/working-steps";
import { plural } from "@/lib/plural";
import { readDocuments, type FailedFile, type SentDocument } from "@/lib/read-documents";
import type { Deadline, ReqGroupKey, RequirementsResponse } from "@/lib/requirements";

type Stage =
  | { kind: "upload"; error?: string }
  | { kind: "working" }
  | { kind: "result"; files: string[]; failed: FailedFile[]; data: RequirementsResponse };

const WORKING_STEPS = [
  "Читаю документы…",
  "Смотрю, кто может участвовать…",
  "Выписываю, что подать в заявке…",
  "Разбираю требования ТЗ…",
  "Проверяю сроки и суммы…",
  "Сверяю цитаты с документами…",
];

const GROUPS: { key: ReqGroupKey; title: string; empty: string }[] = [
  {
    key: "who",
    title: "Кто может участвовать",
    empty: "Ограничений и особых требований к участникам не нашёл. Обычно они в извещении — проверьте, что оно загружено.",
  },
  {
    key: "submit",
    title: "Что подать в заявке",
    empty: "Не нашёл, что подать в заявке. Это обычно в извещении или в требованиях к содержанию заявки.",
  },
  {
    key: "scope",
    title: "Что требует ТЗ",
    empty: "Не нашёл требований к товару, работе или услуге — загрузите ТЗ.",
  },
  {
    key: "terms",
    title: "Сроки и деньги",
    empty: "Не нашёл сроков и сумм. Они обычно в извещении и проекте контракта.",
  },
];

const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

// Срок подачи — самое важное в закупке, поэтому он отдельной плашкой с обратным отсчётом.
function dueLine({ date, time, zone }: Deadline): { text: string; tone: "soon" | "calm" | "past" } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const due = new Date(y, mo - 1, d);
  if (due.getMonth() !== mo - 1 || due.getDate() !== d) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  const day = `${d} ${MONTHS[mo - 1]}${y !== today.getFullYear() ? ` ${y}` : ""}`;
  const at = time.trim() ? [time.trim(), zone.trim()].filter(Boolean).join(" ") : "";

  if (days < 0) return { text: `Приём заявок закончился ${day}`, tone: "past" };
  if (days === 0) return { text: `Подать сегодня${at ? `, до ${at}` : ""}`, tone: "soon" };
  return {
    text: `Подать до ${day}${at ? `, ${at}` : ""} · осталось\u00a0${days}\u00a0${plural(days, "день", "дня", "дней")}`,
    tone: days <= 7 ? "soon" : "calm",
  };
}

const TONES = {
  soon: "bg-[var(--warn-tint)] text-[var(--warn)]",
  calm: "bg-card text-[var(--ink-2)]",
  past: "bg-card text-muted-foreground",
};

type ResultProps = { files: string[]; failed: FailedFile[]; data: RequirementsResponse; onReset: () => void };

function Result({ files, failed, data, onReset }: ResultProps) {
  const [open, setOpen] = useState<string | null>(null);
  const due = dueLine(data.deadline);
  const unverified = GROUPS.reduce((n, g) => n + data.groups[g.key].filter((it) => !it.verified).length, 0);
  return (
    <>
      {data.kind && <p className="mt-5 text-sm text-muted-foreground">{data.kind}</p>}
      <h1 className="mt-2 font-heading text-[clamp(24px,5vw,32px)] font-bold leading-[1.15] tracking-[-0.04em] text-balance">
        Требования
      </h1>
      {data.subject && <p className="mt-2 text-[17px] leading-[26px] text-[var(--ink-2)]">{data.subject}</p>}
      {due && (
        <p className={`mt-4 inline-flex items-center gap-2.5 rounded-[var(--r-card)] px-4 py-2.5 text-[15px] font-semibold ${TONES[due.tone]}`}>
          <ClockIcon className="size-[18px] shrink-0" />
          {due.text}
        </p>
      )}

      {data.notice && (
        <p className="mt-5 rounded-[var(--r-card)] bg-card px-4 py-3 text-[15px] text-[var(--ink-2)]">{data.notice}</p>
      )}
      {failed.length > 0 && (
        <div className="mt-2 flex items-center gap-3 rounded-[var(--r-card)] bg-[var(--warn-tint)] px-4 py-3.5 font-semibold text-[var(--warn)]">
          <AlertTriangleIcon className="size-5 shrink-0" />
          {`Не получилось прочитать: ${failed.map((f) => `${f.name} — ${f.reason}`).join("; ")}.${
            data.mode === "ai" ? " Требования выписаны по остальным файлам." : ""
          }`}
        </div>
      )}
      {unverified > 0 && (
        <div className="mt-2 flex items-center gap-3 rounded-[var(--r-card)] bg-[var(--warn-tint)] px-4 py-3.5 font-semibold text-[var(--warn)]">
          <AlertTriangleIcon className="size-5 shrink-0" />
          {`В ${unverified} ${plural(unverified, "пункте", "пунктах", "пунктах")} цитата не найдена в документах дословно — сверьте их вручную.`}
        </div>
      )}

      {GROUPS.map((group) => {
        const items = data.groups[group.key];
        return (
          <section key={group.key} className="mt-7">
            <h2 className="mb-2.5 text-[13px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
              {group.title}
            </h2>
            {items.length === 0 ? (
              <p className="rounded-[var(--r-card)] bg-card px-[18px] py-3.5 text-[15px] leading-[22px] text-muted-foreground">
                {group.empty}
              </p>
            ) : (
              <ul className="overflow-hidden rounded-[var(--r-card)] bg-card">
                {items.map((it, i) => {
                  const id = `${group.key}-${i}`;
                  return (
                    <li key={id} className="grid gap-1 border-t border-border px-[18px] py-3.5 first:border-t-0">
                      <span className="text-base leading-6">{it.text}</span>
                      <button
                        type="button"
                        aria-expanded={open === id}
                        onClick={() => setOpen(open === id ? null : id)}
                        className="justify-self-start text-left text-sm font-medium text-primary underline underline-offset-4"
                      >
                        {it.source || "цитата"}
                      </button>
                      {open === id && (
                        <blockquote className="mt-1 rounded-[14px] bg-muted px-4 py-3 text-[14.5px] leading-[22px]">
                          {it.quote}
                        </blockquote>
                      )}
                      {!it.verified && (
                        <p className="flex items-center gap-2 text-[13.5px] font-medium text-[var(--warn)]">
                          <AlertTriangleIcon className="size-4 shrink-0" />
                          Не нашёл эту цитату в документах дословно — сверьте пункт вручную.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      <p className="mt-7 text-[15px] leading-[22px] text-muted-foreground">
        {files.length ? `Документы: ${files.join(", ")}` : "Пример на тестовой закупке"} ·{" "}
        <button
          type="button"
          onClick={onReset}
          className="font-semibold text-primary underline underline-offset-4"
        >
          {files.length ? "загрузить другие" : "загрузить свои документы"}
        </button>
      </p>
    </>
  );
}

export default function RequirementsPage() {
  const [stage, setStage] = useState<Stage>({ kind: "upload" });

  async function extract(files: File[] | null) {
    setStage({ kind: "working" });
    try {
      const { documents, failed }: { documents: SentDocument[]; failed: FailedFile[] } = files
        ? await readDocuments(files)
        : { documents: [], failed: [] };

      const res = await fetch("/api/requirements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(files ? { documents } : { sample: true }),
      });
      if (!res.ok) throw new Error((await res.text()) || "Не удалось выписать требования.");
      const data: RequirementsResponse = await res.json();

      setStage({ kind: "result", files: documents.map((d) => d.name), failed, data });
      window.scrollTo(0, 0);
    } catch (e) {
      setStage({ kind: "upload", error: (e as Error).message });
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-[680px] px-4 pb-10">
        {stage.kind === "upload" && (
          <>
            <h1 className="mt-6 font-heading text-[clamp(24px,5vw,32px)] font-bold leading-[1.15] tracking-[-0.04em] text-balance">
              Требования по закупке
            </h1>
            <p className="mt-3 max-w-[46ch] text-[17px] leading-[26px] text-[var(--ink-2)]">
              Загрузите документы закупки — выпишу, кто может участвовать, что подать, что требует ТЗ, сроки и деньги. К каждому пункту — цитата из документа.
            </p>
            {stage.error && (
              <p className="mt-5 rounded-[var(--r-card)] bg-[var(--warn-tint)] px-4 py-3 font-medium text-[var(--warn)]">
                {stage.error}
              </p>
            )}
            <FileDrop
              hint="Перетащите сюда извещение, ТЗ и проект контракта — можно сразу несколько файлов"
              button="Загрузить документы"
              onFiles={(files) => void extract(files)}
              onSample={() => void extract(null)}
            />
          </>
        )}

        {stage.kind === "working" && <WorkingSteps steps={WORKING_STEPS} />}

        {stage.kind === "result" && (
          <Result files={stage.files} failed={stage.failed} data={stage.data} onReset={() => setStage({ kind: "upload" })} />
        )}
      </main>
    </div>
  );
}
