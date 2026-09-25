"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { AlertTriangleIcon, CheckIcon, FileTextIcon, XIcon } from "lucide-react";
import { FileDrop } from "@/components/file-drop";
import { Island } from "@/components/island";
import { Note, Warnings } from "@/components/note";
import { scrollToTop } from "@/components/page-header";
import { usePurchase } from "@/components/purchase-provider";
import { NextStep, StepIntro, TabBody } from "@/components/purchase-view";
import { WorkingSteps } from "@/components/working-steps";
import { checkCounts, docsKeyOf, type CheckFinding, type CheckResponse, type CheckResult } from "@/lib/check";
import { sampleCheck } from "@/lib/check-sample";
import { plural } from "@/lib/plural";
import { ACCEPTED_FILES, readDocuments } from "@/lib/read-documents";

const WORKING_STEPS = [
  "Читаю заявку…",
  "Сверяю с ТЗ по пунктам…",
  "Проверяю состав заявки…",
  "Ищу незаполненные места…",
  "Сверяю цитаты с документами…",
];

const Warning = ({ children }: { children: string }) => (
  <p className="t-caption flex items-center gap-2 text-[var(--warn)]">
    <AlertTriangleIcon className="size-4 shrink-0" />
    {children}
  </p>
);

const ICON = "grid size-6 place-items-center rounded-full";

function Finding({ finding: f, open, onToggle }: { finding: CheckFinding; open: boolean; onToggle: () => void }) {
  const bad = f.kind === "bad";
  return (
    <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-2.5 py-3">
      <span
        aria-hidden
        className={`${ICON} ${
          bad ? "bg-[color-mix(in_srgb,var(--danger)_12%,var(--card))] text-destructive" : "t-strong bg-[var(--warn-tint)] text-[var(--warn)]"
        }`}
      >
        {bad ? <XIcon className="size-3.5" /> : "!"}
      </span>
      <div className="grid min-w-0 gap-1">
        <p className="t-section">
          <span className="sr-only">{bad ? "Ошибка: " : "Замечание: "}</span>
          {f.what}
        </p>
        <p className="t-read text-[var(--ink-2)]">{f.todo}</p>
        {(f.quote || f.inApplication) && (
          <button type="button" aria-expanded={open} onClick={onToggle} className="src">
            <FileTextIcon className="size-3" />
            {f.source || "цитаты"}
          </button>
        )}
        {open && (
          <div className="t-read mt-0.5 grid gap-1.5">
            {f.quote && (
              <blockquote className="rounded-[var(--r-card)] bg-[var(--paper-2)] px-3 py-2">
                <span className="text-[var(--ink-3)]">В документах закупки: </span>«{f.quote}»
              </blockquote>
            )}
            {f.inApplication && (
              <blockquote className="rounded-[var(--r-card)] bg-[var(--paper-2)] px-3 py-2">
                <span className="text-[var(--ink-3)]">В заявке: </span>«{f.inApplication}»
              </blockquote>
            )}
          </div>
        )}
        {f.quote && !f.verified && <Warning>Не нашёл требование в документах закупки дословно — сверьте вручную.</Warning>}
        {f.inApplication && !f.appVerified && <Warning>Не нашёл этот текст в заявке дословно — сверьте вручную.</Warning>}
      </div>
    </li>
  );
}

function verdict(check: CheckResult) {
  const { bad, warn } = checkCounts(check);
  const bads = `${bad} ${plural(bad, "ошибку", "ошибки", "ошибок")}`;
  const warns = `${warn} ${plural(warn, "замечание", "замечания", "замечаний")}`;
  if (bad) {
    return {
      title: (
        <>
          Нашёл <span className="text-destructive">{bads}</span>
          {warn > 0 && (
            <>
              {" "}и <span className="text-[var(--warn)]">{warns}</span>
            </>
          )}
        </>
      ),
      lead: warn ? "Исправьте ошибки до подачи — замечания тоже лучше поправить." : "Исправьте ошибки до подачи.",
    };
  }
  if (warn) {
    return {
      title: (
        <>
          Нашёл <span className="text-[var(--warn)]">{warns}</span>
        </>
      ),
      lead: "Отклонять не за что, но замечания лучше поправить.",
    };
  }
  return {
    title: <>Ошибок не нашёл</>,
    lead: "Заявка соответствует документам закупки по всем проверенным пунктам. Перед подачей всё равно просмотрите её глазами.",
  };
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

// Шаг 3 «Проверка заявки»: участник загружает свою заявку, ИИ сверяет её с документами закупки.
// Итог и главное действие — в первом острове, найденное по пунктам — во втором.
// В примере вместо загруженного файла проверяется вымышленная заявка — бесплатно и без ИИ.
export default function CheckPage() {
  const { purchase, documents, update } = usePurchase();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const check = purchase.check;
  const docsKey = docsKeyOf(purchase.files);

  async function run(files: File[]) {
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      let result: CheckResult;
      if (purchase.sample) {
        result = sampleCheck();
      } else {
        const { documents: application, failed } = await readDocuments(files);
        const res = await fetch("/api/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documents, application }),
        });
        if (!res.ok) throw new Error((await res.text()) || "Не удалось проверить заявку.");
        const body: CheckResponse = await res.json();
        result = { ...body, files: application.map((d) => d.name), docsKey, checkedAt: new Date().toISOString() };
        if (failed.length) setNotice(`Не прочитаны и не проверены: ${failed.map((f) => `${f.name} — ${f.reason}`).join("; ")}.`);
      }
      setOpen(null);
      update({ check: result });
      scrollToTop();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }

  if (working) {
    return (
      <TabBody>
        <div className="island px-[var(--pad)]">
          <WorkingSteps steps={WORKING_STEPS} />
        </div>
      </TabBody>
    );
  }

  if (!check) {
    return (
      <TabBody>
        <StepIntro>
          Шаг 3 — перед подачей. Загрузите заявку или техническое предложение, которые собираетесь подавать: сверю их с извещением и ТЗ по каждому пункту и скажу, за что могут отклонить.
        </StepIntro>
        {error && (
          <Note tone="warn" icon={AlertTriangleIcon}>
            {error}
          </Note>
        )}
        <div className="island p-2">
          <FileDrop
            hint="Перетащите сюда файлы заявки — можно сразу несколько"
            button="Загрузить заявку"
            onFiles={(files) => void run(files)}
            onSample={purchase.sample ? () => void run([]) : undefined}
          />
        </div>
      </TabBody>
    );
  }

  const { title, lead } = verdict(check);

  return (
    <TabBody>
      <section aria-labelledby="check-verdict" className="island grid gap-1 px-[var(--pad)] pb-4 pt-3">
        <h3 id="check-verdict" className="t-title">
          {title}
        </h3>
        <p className="max-w-[70ch] text-[var(--ink-2)]">{lead}</p>
        <p className="t-caption text-[var(--ink-3)]">
          Проверено: {check.files.join(", ")} · {when(check.checkedAt)}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            onClick={() => (purchase.sample ? void run([]) : input.current?.click())}
            className={`btn ${check.findings.length ? "" : "btn-line"}`}
          >
            {check.findings.length ? "Проверить исправленный файл" : "Проверить другой файл"}
          </button>
          <Link href={`/p/${purchase.id}/chat`} className="link">
            Сомневаетесь — спросите по закупке
          </Link>
        </div>
      </section>

      {purchase.sample && <Note tone="info">Это пример: проверена вымышленная заявка к вымышленной закупке.</Note>}
      <Warnings
        items={[
          !purchase.sample && check.docsKey !== docsKey && "После проверки в закупку добавили документы — проверьте заявку заново.",
          notice,
          error,
        ]}
      />

      <Island
        id="check-findings"
        level={3}
        title={check.findings.length ? "Что исправить" : "Проверенные пункты"}
        count={check.findings.length || undefined}
      >
        <ul className="divide-y divide-[var(--line)] px-[var(--pad)] pb-1">
          {check.findings.map((f, i) => (
            <Finding key={i} finding={f} open={open === i} onToggle={() => setOpen(open === i ? null : i)} />
          ))}
          {check.okCount > 0 && (
            <li className="grid grid-cols-[24px_minmax(0,1fr)] items-center gap-2.5 py-3">
              <span aria-hidden className={`${ICON} bg-[var(--ok-tint)] text-[var(--ok)]`}>
                <CheckIcon className="size-3.5" />
              </span>
              <p className="t-strong text-[var(--ok)]">
                {check.findings.length ? "Остальные" : "Все"} {check.okCount} {plural(check.okCount, "пункт", "пункта", "пунктов")} — в порядке.
              </p>
            </li>
          )}
        </ul>
      </Island>

      <NextStep from="check" />

      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPTED_FILES}
        className="hidden"
        onChange={(e) => {
          const files = e.currentTarget.files ? [...e.currentTarget.files] : [];
          e.currentTarget.value = "";
          if (files.length) void run(files);
        }}
      />
    </TabBody>
  );
}
