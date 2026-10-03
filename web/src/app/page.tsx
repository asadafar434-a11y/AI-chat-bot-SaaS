"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/badge";
import { CaretRightIcon, ClockIcon, DocumentIcon, PlusIcon, SearchIcon, TrashIcon, WarningIcon } from "@/components/icons";
import { Note } from "@/components/note";
import { PageBody, PageHeader } from "@/components/page-header";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { dueLine } from "@/lib/deadline";
import { FILTERS, lawText, matches, nextHref, procedureOf, progressOf, STATUS_LABEL, statusOf, type DashStatus } from "@/lib/dashboard";
import { plural } from "@/lib/plural";
import { titleOf, type Purchase } from "@/lib/purchase";
import { deletePurchase, savePurchase } from "@/lib/purchase-store";
import { openSamplePurchase } from "@/lib/sample-purchase";
import { stepsOf } from "@/lib/steps";
import { STORAGE_ERROR, usePurchases } from "@/lib/use-purchases";

type Row = { p: Purchase; title: string; status: DashStatus; progress: number; href: string };

const DUE_TEXT = { soon: "text-[var(--warn)]", calm: "text-[var(--ink-2)]", past: "text-[var(--ink-3)]" };

// «Мои закупки» — главный экран, как в прототипе: сводка, поиск, фильтры и карточки закупок с готовностью заявки.
// Первому пользователю — «Первая закупка» вместо пустого списка.
export default function HomePage() {
  const router = useRouter();
  const { purchases, error } = usePurchases();
  const [filter, setFilter] = useState<DashStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [toDelete, setToDelete] = useState<Row | null>(null);
  const [fail, setFail] = useState<string | null>(null);

  const rows = useMemo<Row[]>(
    () =>
      (purchases ?? []).map((p) => {
        const steps = stepsOf(p);
        return { p, title: titleOf(p), status: statusOf(p, steps), progress: progressOf(steps, p.submitted), href: nextHref(steps) };
      }),
    [purchases]
  );
  const count = (s: DashStatus) => rows.filter((r) => r.status === s).length;
  const shown = rows.filter((r) => (filter === "all" || r.status === filter) && matches(r.p, r.title, query));

  const summary: [string, number, string, string][] = [
    ["Всего", rows.length, "text-foreground", "Все закупки, которые вы добавили."],
    ["В работе", count("progress") + count("draft"), "text-[var(--warn)]", "Черновики и заявки, где осталось что-то заполнить."],
    ["Готовы", count("ready"), "text-[var(--ok)]", "Все шаги пройдены — осталось подписать и подать."],
    ["Поданы", count("submitted"), "text-[var(--ink-3)]", "Заявки, которые вы отметили поданными на площадке."],
  ];

  async function run(job: () => Promise<unknown>) {
    setFail(null);
    try {
      await job();
    } catch {
      setFail(STORAGE_ERROR);
    }
  }

  const fresh = purchases?.length === 0;

  return (
    <>
      <PageHeader
        title="Мои закупки"
        sub="Загрузите документацию — ИИ проведёт до готового пакета."
        actions={
          <Link href="/new" className="btn max-lg:hidden">
            <PlusIcon />
            Новая закупка
          </Link>
        }
      />
      <PageBody>
        <div className="grid max-w-[1040px] gap-4">
          {(error || fail) && (
            <Note tone="warn" icon={WarningIcon}>
              {error ?? fail}
            </Note>
          )}

          <div role="group" aria-label="Сводка по закупкам" className="island grid grid-cols-4 divide-x divide-[var(--line)] p-0">
            {summary.map(([label, n, color, hint]) => (
              <div key={label} title={hint} className="grid cursor-default justify-items-center gap-0.5 px-2 py-3">
                <span className={`[font:600_20px/24px_var(--mono)] tabular-nums ${color}`}>{purchases ? n : "·"}</span>
                <span className="t-over text-[var(--ink-3)]">{label}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-[var(--r-ctl)] border border-[var(--line)] bg-card px-3 focus-within:border-foreground">
              <SearchIcon className="size-4 shrink-0 text-[var(--ink-3)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск по названию, заказчику или способу закупки"
                aria-label="Поиск по закупкам"
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--ink-3)]"
              />
            </label>
            <div role="group" aria-label="Фильтр по статусу" className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className="t-tag rounded-[var(--r-ctl)] border border-[var(--line)] bg-card px-3 py-1.5 text-[var(--ink-3)] hover:bg-[var(--hover)] hover:text-foreground aria-pressed:border-foreground aria-pressed:bg-primary aria-pressed:text-[var(--on-brand)]"
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {fresh && (
            <section className="island grid justify-items-start gap-3 p-[var(--pad)]">
              <h2 className="t-section">Первая закупка</h2>
              <p className="max-w-[60ch] text-[var(--ink-2)]">
                Загрузите извещение, ТЗ и проект контракта — выпишу требования и сроки, составлю заявку и проверю её перед подачей.
              </p>
              <ol className="t-caption grid gap-1 text-[var(--ink-3)]">
                <li>1. Загрузка — PDF, Word, Excel, ZIP, сканы или фото.</li>
                <li>2. Анализ — требования с цитатами из документов.</li>
                <li>3. Цена — до какой суммы можно снижаться.</li>
                <li>4. Проверка — впишите то, что знаете только вы.</li>
                <li>5. Пакет — файлы Word для подачи на площадке.</li>
              </ol>
              <div className="flex flex-wrap items-center gap-3">
                <Link href="/new" className="btn">
                  <PlusIcon />
                  Новая закупка
                </Link>
                <button type="button" className="link" onClick={() => void run(async () => router.push(`/p/${await openSamplePurchase()}`))}>
                  или посмотреть на примере
                </button>
              </div>
            </section>
          )}

          <ul className="grid gap-2.5">
            {shown.map(({ p, title, status, progress, href }) => {
              const st = STATUS_LABEL[status];
              const due = dueLine(p.deadline, false);
              const docs = p.files.length;
              const procedure = procedureOf(p);
              return (
                <li key={p.id} className="island group relative p-0 hover:border-foreground/25">
                  <Link href={href} className="grid gap-2 px-4 pb-2 pt-4 pr-24">
                    <span className="flex flex-wrap items-center gap-2">
                      <span title={st.hint}>
                        <Badge tone={st.tone} text={st.text} />
                      </span>
                      {procedure && <span className="t-tag rounded-[var(--r-pill)] border border-[var(--line)] bg-[var(--paper-2)] px-2 py-0.5">{procedure}</span>}
                      {p.sample && <Badge tone="calm" text="пример" />}
                      {lawText(p) && <span className="font-mono text-[11px] text-[var(--ink-3)]">{lawText(p)}</span>}
                    </span>
                    <span className="t-strong text-pretty">{title}</span>
                    {p.customer && <span className="text-[var(--ink-3)]">{p.customer}</span>}
                    <span className="t-caption flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[var(--ink-3)]">
                      {p.price && <span className="font-mono tabular-nums text-foreground">{p.price}</span>}
                      {due && (
                        <span className={`inline-flex items-center gap-1 ${DUE_TEXT[due.tone]}`}>
                          <ClockIcon className="size-3.5" />
                          {due.text.replace(/ /g, " ")}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <DocumentIcon className="size-3.5" />
                        {docs} {plural(docs, "документ", "документа", "документов")}
                      </span>
                    </span>
                    <span className="flex items-center gap-3" title="Готовность заявки: доля пройденных шагов из пяти.">
                      <span aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-[var(--r-pill)] bg-[var(--paper-3)]">
                        <span className="block h-full rounded-[inherit] bg-primary transition-all" style={{ width: `${progress}%` }} />
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-[var(--ink-3)]">{progress}%</span>
                    </span>
                  </Link>

                  <div className="absolute right-3 top-3 flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Удалить закупку"
                      title="Удалить закупку"
                      onClick={() => setToDelete({ p, title, status, progress, href })}
                      className="icon-btn opacity-0 focus-visible:opacity-100 group-hover:opacity-100 max-lg:opacity-100"
                    >
                      <TrashIcon className="size-4" />
                    </button>
                    <CaretRightIcon aria-hidden className="size-5 text-[var(--ink-3)]" />
                  </div>
                  <div className="flex justify-end px-4 pb-3 pt-0">
                    <button
                      type="button"
                      className="link t-caption"
                      onClick={() => void run(() => savePurchase({ ...p, submitted: !p.submitted }))}
                    >
                      {p.submitted ? "Снять отметку «Подана»" : "Отметить поданной"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          {purchases && !fresh && shown.length === 0 && (
            <section className="island grid justify-items-center gap-3 p-10 text-center">
              <p className="text-[var(--ink-2)]">По вашему запросу ничего не найдено.</p>
              <Link href="/new" className="btn btn-line">
                <PlusIcon />
                Добавить закупку
              </Link>
            </section>
          )}
        </div>

        <p className="t-caption mt-3 max-w-[90ch] text-[var(--ink-3)]">
          Закупки хранятся на сервере, в вашей организации. Ответы ИИ не являются юридической консультацией — проверяйте нормы по первоисточнику.
        </p>
      </PageBody>

      <Dialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить закупку?</DialogTitle>
            <DialogDescription>
              «{toDelete?.title}» будет удалена вместе с документами и заявкой. Это действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" className="btn btn-line" onClick={() => setToDelete(null)}>
              Отмена
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                const id = toDelete?.p.id;
                setToDelete(null);
                if (id) void run(() => deletePurchase(id));
              }}
            >
              <TrashIcon />
              Удалить
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
