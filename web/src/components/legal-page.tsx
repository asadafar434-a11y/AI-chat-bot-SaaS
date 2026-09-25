import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangleIcon, ScaleIcon } from "lucide-react";
import { Note } from "@/components/note";
import { LEGAL_EDITION, LEGAL_PAGES, type Operator, type OperatorValue } from "@/lib/legal";

// Значение из реквизитов оператора; не задано на хостинге — жёлтое поле с подсказкой, как в черновиках.
export function Val({ field }: { field: OperatorValue }) {
  if (field.value) return <>{field.value}</>;
  return <mark className="rounded-sm bg-[var(--warn-tint)] px-1 text-[var(--warn)]">[{field.empty}]</mark>;
}

export function Mail({ field }: { field: OperatorValue }) {
  if (!field.value) return <Val field={field} />;
  return (
    <a href={`mailto:${field.value}`} className="link">
      {field.value}
    </a>
  );
}

export function Section({ n, title, children }: { n?: number; title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h2 className="t-title">
        {n !== undefined && `${n}. `}
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Points({ children }: { children: ReactNode }) {
  return <ul className="grid list-disc gap-1.5 pl-5 marker:text-[var(--ink-3)]">{children}</ul>;
}

// Правовой документ: без сайдбара, одним островом по центру — его открывают и те, кто ещё не вошёл.
export function LegalPage({ title, operator, children }: { title: string; operator: Operator; children: ReactNode }) {
  return (
    <main className="h-full overflow-y-auto overscroll-contain">
      <div className="mx-auto grid max-w-[760px] gap-2 p-2 pb-6 sm:pt-6">
        <Link href="/" className="inline-flex w-fit items-center gap-2.5 px-2 py-2">
          <span className="grid size-7 flex-none place-items-center rounded-[var(--r-ctl)] bg-primary text-primary-foreground shadow-[inset_0_-2px_0_rgb(0_0_0/.12)]">
            <ScaleIcon className="size-4" />
          </span>
          <span className="font-heading text-sm leading-5 font-bold tracking-[-0.01em]">Тендерный юрист</span>
        </Link>

        <article className="island grid gap-6 px-[var(--pad)] py-5 sm:px-8 sm:py-7">
          <header className="grid gap-1">
            <h1 className="t-page">{title}</h1>
            <p className="t-caption text-[var(--ink-3)]">Редакция от {LEGAL_EDITION}</p>
          </header>
          {operator.missing.length > 0 && (
            <Note tone="warn" icon={AlertTriangleIcon}>
              Черновик: не заданы реквизиты владельца сервиса — {operator.missing.join(", ")}. Задайте их в настройках хостинга и
              проверьте текст с юристом до того, как открыть сервис другим людям.
            </Note>
          )}
          <div className="t-read grid gap-6 text-[var(--ink-2)] [&_b]:font-semibold [&_b]:text-foreground">{children}</div>
        </article>

        <nav aria-label="Правовые документы" className="t-caption flex flex-wrap gap-x-4 gap-y-1 px-2">
          {LEGAL_PAGES.map((page) => (
            <Link key={page.href} href={page.href} className="link link-quiet">
              {page.short}
            </Link>
          ))}
          <Link href="/" className="link link-quiet">
            В приложение
          </Link>
        </nav>
      </div>
    </main>
  );
}
