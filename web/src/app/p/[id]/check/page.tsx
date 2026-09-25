"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { AlertTriangleIcon, CheckIcon } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { BackLink } from "@/components/back-link";
import { FileDrop } from "@/components/file-drop";
import { Note } from "@/components/note";
import { PageTitle } from "@/components/page-title";
import { usePurchase } from "@/components/purchase-provider";
import { WorkingSteps } from "@/components/working-steps";
import { checkCounts, docsKeyOf, type CheckFinding, type CheckResponse, type CheckResult } from "@/lib/check";
import { sampleCheck } from "@/lib/check-sample";
import { plural } from "@/lib/plural";
import { titleOf } from "@/lib/purchase";
import { ACCEPTED_FILES, readDocuments } from "@/lib/read-documents";

const WORKING_STEPS = [
  "Читаю заявку…",
  "Сверяю с ТЗ по пунктам…",
  "Проверяю состав заявки…",
  "Ищу незаполненные места…",
  "Сверяю цитаты с документами…",
];

const primaryButton =
  "inline-flex min-h-[52px] items-center justify-center rounded-[var(--r-ctl)] bg-primary px-6 font-semibold text-primary-foreground hover:opacity-90";

const Warning = ({ children }: { children: string }) => (
  <p className="flex items-center gap-2 text-[13.5px] font-medium text-[var(--warn)]">
    <AlertTriangleIcon className="size-4 shrink-0" />
    {children}
  </p>
);

function Finding({ finding: f, open, onToggle }: { finding: CheckFinding; open: boolean; onToggle: () => void }) {
  const bad = f.kind === "bad";
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 rounded-[var(--r-card)] bg-card px-[18px] py-4">
      <span
        aria-hidden
        className={`grid size-7 place-items-center rounded-full text-[15px] font-bold ${
          bad
            ? "bg-[color-mix(in_oklab,var(--destructive)_14%,transparent)] text-destructive"
            : "bg-[var(--warn-tint)] text-[var(--warn)]"
        }`}
      >
        {bad ? "✕" : "!"}
      </span>
      <div className="grid min-w-0 gap-1">
        <p className="font-semibold leading-6">
          <span className="sr-only">{bad ? "Ошибка: " : "Замечание: "}</span>
          {f.what}
        </p>
        <p className="leading-6 text-[var(--ink-2)]">{f.todo}</p>
        {(f.quote || f.inApplication) && (
          <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className="justify-self-start text-left text-sm font-medium text-primary underline underline-offset-4"
          >
            {f.source || "цитаты"}
          </button>
        )}
        {open && (
          <div className="mt-1 grid gap-2 text-[14.5px] leading-[22px]">
            {f.quote && (
              <blockquote className="rounded-[14px] bg-muted px-4 py-3">
                <span className="text-muted-foreground">В документах закупки: </span>«{f.quote}»
              </blockquote>
            )}
            {f.inApplication && (
              <blockquote className="rounded-[14px] bg-muted px-4 py-3">
                <span className="text-muted-foreground">В заявке: </span>«{f.inApplication}»
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

// Проверка заявки перед подачей: участник загружает свою заявку, ИИ сверяет её с документами закупки.
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
      window.scrollTo(0, 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }

  const pick = (list: FileList | null) => {
    const files = list ? [...list] : [];
    if (files.length) void run(files);
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-[680px] px-4 pb-10">
        <BackLink href={`/p/${purchase.id}`}>{titleOf(purchase)}</BackLink>

        {working ? (
          <>
            <PageTitle className="mt-4">Проверка заявки</PageTitle>
            <WorkingSteps steps={WORKING_STEPS} />
          </>
        ) : !check ? (
          <>
            <PageTitle className="mt-4">Проверим заявку перед подачей</PageTitle>
            <p className="mt-3 max-w-[48ch] text-[17px] leading-[26px] text-[var(--ink-2)]">
              Загрузите заявку или техническое предложение, которые собираетесь подавать. Сверю их с извещением и ТЗ по
              каждому пункту и скажу, за что могут отклонить.
            </p>
            {error && (
              <Note tone="warn" icon={AlertTriangleIcon} className="mt-5">
                {error}
              </Note>
            )}
            <FileDrop
              hint="Перетащите сюда файлы заявки — можно сразу несколько"
              button="Загрузить заявку"
              onFiles={(files) => void run(files)}
              onSample={purchase.sample ? () => void run([]) : undefined}
            />
          </>
        ) : (
          <>
            <PageTitle className="mt-4">{verdict(check).title}</PageTitle>
            <p className="mt-3 max-w-[48ch] text-[17px] leading-[26px] text-[var(--ink-2)]">{verdict(check).lead}</p>
            <p className="mt-2 text-[14.5px] leading-[22px] text-muted-foreground">
              Проверено: {check.files.join(", ")} · {when(check.checkedAt)}
            </p>
            {purchase.sample && (
              <Note tone="info" className="mt-5">
                Это пример: проверена вымышленная заявка к вымышленной закупке.
              </Note>
            )}
            {!purchase.sample && check.docsKey !== docsKey && (
              <Note tone="warn" icon={AlertTriangleIcon} className="mt-5">
                После проверки в закупку добавили документы — проверьте заявку заново.
              </Note>
            )}
            {notice && (
              <Note tone="warn" icon={AlertTriangleIcon} className="mt-5">
                {notice}
              </Note>
            )}
            {error && (
              <Note tone="warn" icon={AlertTriangleIcon} className="mt-5">
                {error}
              </Note>
            )}

            <ul className="mt-6 grid gap-2.5">
              {check.findings.map((f, i) => (
                <Finding key={i} finding={f} open={open === i} onToggle={() => setOpen(open === i ? null : i)} />
              ))}
              {check.okCount > 0 && (
                <li className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-3 px-[18px] py-2">
                  <span className="grid size-7 place-items-center rounded-full bg-[var(--ok-tint)] text-[var(--ok)]" aria-hidden>
                    <CheckIcon className="size-4" />
                  </span>
                  <p className="font-semibold text-[var(--ok)]">
                    {check.findings.length ? "Остальные" : "Все"} {check.okCount}{" "}
                    {plural(check.okCount, "пункт", "пункта", "пунктов")} — в порядке.
                  </p>
                </li>
              )}
            </ul>

            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
              <button
                type="button"
                onClick={() => (purchase.sample ? void run([]) : input.current?.click())}
                className={primaryButton}
              >
                Проверить другой файл
              </button>
              <Link
                href={`/p/${purchase.id}/chat`}
                className="text-[15px] font-semibold text-primary underline underline-offset-4"
              >
                Сомневаетесь — спросите по закупке
              </Link>
            </div>
            <input
              ref={input}
              type="file"
              multiple
              accept={ACCEPTED_FILES}
              className="hidden"
              onChange={(e) => {
                pick(e.currentTarget.files);
                e.currentTarget.value = "";
              }}
            />
          </>
        )}
      </main>
    </div>
  );
}
