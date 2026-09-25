"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, ChevronRightIcon, FolderIcon, PlusIcon, UserRoundIcon, type LucideIcon } from "lucide-react";
import { AskBox } from "@/components/ask-box";
import { Note } from "@/components/note";
import { PageBody, PageHeader } from "@/components/page-header";
import { daysText, LawBadge, TpTag } from "@/components/purchase-bits";
import { onDataChanged } from "@/lib/db";
import { dueLine } from "@/lib/deadline";
import { countMyDocuments, getProfile } from "@/lib/me-store";
import { plural } from "@/lib/plural";
import { filledCount, PROFILE_KEYS } from "@/lib/profile";
import { titleOf, type Purchase } from "@/lib/purchase";
import { scanNames } from "@/lib/purchase-store";
import { openSamplePurchase } from "@/lib/sample-purchase";
import { fillCount } from "@/lib/tp";
import { STORAGE_ERROR, usePurchases } from "@/lib/use-purchases";

type Task = { key: string; href: string; text: string; sub: string; tone: "warn" | "brand" | "calm" };

// Что осталось сделать по закупкам, где ещё идёт приём, и по реквизитам. Порядок — по сроку подачи.
function tasksOf(purchases: Purchase[], scans: Record<string, string[]>, missing: number): Task[] {
  const tasks: Task[] = [];
  for (const p of purchases) {
    const due = dueLine(p.deadline, false);
    if (!due || due.days < 0) continue;
    const sub = `${titleOf(p)} · ${due.days === 0 ? "подать сегодня" : `${daysText(due.days)} до подачи`}`;
    const tone = due.tone === "soon" ? "warn" : "brand";
    const fill = p.tp ? fillCount(p.tp) : 0;
    if (!p.tp) tasks.push({ key: `${p.id}:tp`, href: `/p/${p.id}/tp`, text: "Составить техническое предложение", sub, tone });
    else if (fill) {
      const text = `Вписать свои данные в ТП — ${fill} ${plural(fill, "пункт", "пункта", "пунктов")}`;
      tasks.push({ key: `${p.id}:tp`, href: `/p/${p.id}/tp`, text, sub, tone });
    }
    const scanned = scans[p.id] ?? [];
    if (scanned.length) {
      const text = `Сверить цифры в ${scanned.length === 1 ? "файле" : "файлах"} со скана`;
      tasks.push({ key: `${p.id}:scan`, href: `/p/${p.id}`, text, sub, tone: "warn" });
    }
    for (const f of p.unreadable) {
      tasks.push({ key: `${p.id}:${f.name}`, href: `/p/${p.id}`, text: `Пересохранить «${f.name}» — файл не прочитан`, sub, tone: "warn" });
    }
  }
  if (missing) {
    const text = `${missing === PROFILE_KEYS.length ? "Заполнить" : "Дозаполнить"} реквизиты — ${missing} ${plural(missing, "поле", "поля", "полей")}`;
    tasks.push({ key: "profile", href: "/me/profile", text, sub: "для анкеты и декларации", tone: "calm" });
  }
  return tasks;
}

const DOT = {
  warn: "bg-[var(--warn)] shadow-[0_0_0_4px_var(--warn-tint)]",
  brand: "bg-primary shadow-[0_0_0_4px_var(--brand-tint)]",
  calm: "bg-[var(--edge-2)] shadow-[0_0_0_4px_var(--paper-2)]",
};

const ROW = "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-[var(--pad)] py-3 hover:bg-[var(--hover)]";

function Panel({ id, title, count, action, children }: { id: string; title: string; count?: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="panel overflow-hidden">
      <div className="panel-head">
        <h2 id={id} className="t-section flex items-baseline gap-2">
          {title}
          {count !== undefined && <span className="count">{count}</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function DueText({ purchase }: { purchase: Purchase }) {
  const due = dueLine(purchase.deadline, false);
  if (!due) return <>Срок подачи не найден в документах</>;
  const soon = due.tone === "soon" ? "t-tag text-[var(--warn)]" : "";
  if (!due.left) return <span className={soon}>{due.head}</span>;
  return (
    <>
      {due.head} · <span className={soon}>{due.left}</span>
    </>
  );
}

function DataRow({ href, icon: Icon, title, sub, children }: { href: string; icon: LucideIcon; title: string; sub: string; children?: ReactNode }) {
  return (
    <li>
      <Link href={href} className={ROW}>
        <span aria-hidden className="law law-icon">
          <Icon className="size-[18px]" />
        </span>
        <span className="grid min-w-0 gap-1">
          <span className="t-strong">{title}</span>
          <span className="t-caption truncate text-[var(--ink-3)]">{sub}</span>
          {children}
        </span>
        <ChevronRightIcon className="size-[18px] text-[var(--ink-3)]" />
      </Link>
    </li>
  );
}

// Главная — сводка: что сделать, закупки по срочности, вопрос про тендеры и свои данные.
export default function HomePage() {
  const router = useRouter();
  const { purchases, error } = usePurchases();
  const [me, setMe] = useState<{ filled: number; docs: number } | null>(null);
  const [scans, setScans] = useState<Record<string, string[]>>({});
  const [sampleError, setSampleError] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all([getProfile(), countMyDocuments()]).then(
        ([profile, docs]) => alive && setMe({ filled: filledCount(profile), docs }),
        () => alive && setMe({ filled: 0, docs: 0 })
      );
    void load();
    const off = onDataChanged(() => void load());
    return () => {
      alive = false;
      off();
    };
  }, []);

  // Сканы нужны только у закупок, где ещё идёт приём, — для дела «сверить цифры».
  useEffect(() => {
    if (!purchases) return;
    let alive = true;
    const open = purchases.filter((p) => (dueLine(p.deadline, false)?.days ?? -1) >= 0);
    Promise.all(open.map(async (p) => [p.id, await scanNames(p)] as const)).then(
      (pairs) => alive && setScans(Object.fromEntries(pairs)),
      () => {}
    );
    return () => {
      alive = false;
    };
  }, [purchases]);

  async function sample() {
    setSampleError(false);
    try {
      router.push(`/p/${await openSamplePurchase()}`);
    } catch {
      setSampleError(true);
    }
  }

  const total = PROFILE_KEYS.length;
  const tasks = purchases && me ? tasksOf(purchases, scans, total - me.filled) : null;
  const next = purchases?.map((p) => ({ p, due: dueLine(p.deadline, false) })).find(({ due }) => due && due.days >= 0);
  const sub = !purchases
    ? ""
    : next
      ? `Ближайший срок подачи ${next.due!.days === 0 ? "сегодня" : `через ${daysText(next.due!.days)}`}: ${titleOf(next.p)}`
      : purchases.length
        ? "Сроков подачи впереди нет"
        : "Загрузите документы первой закупки";

  return (
    <>
      <PageHeader
        title="Главная"
        sub={sub}
        actions={
          <Link href="/new" aria-label="Новая закупка" className="btn max-sm:w-10 max-sm:px-0">
            <PlusIcon />
            <span className="max-sm:hidden">Новая закупка</span>
          </Link>
        }
      />
      <PageBody>
        <div className="grid items-start gap-4 split:grid-cols-[minmax(0,1.55fr)_minmax(320px,1fr)]">
          <div className="grid min-w-0 gap-4">
            <Panel id="todo-title" title="Нужно сделать" count={tasks?.length}>
              {tasks && tasks.length === 0 && (
                <p className="t-body p-[var(--pad)] text-[var(--ink-3)]">Всё сделано: по открытым закупкам делать нечего.</p>
              )}
              {tasks && tasks.length > 0 && (
                <ul className="divide-y divide-[var(--line)]">
                  {tasks.map((t) => (
                    <li key={t.key}>
                      <Link href={t.href} className={ROW}>
                        <span aria-hidden className={`mx-[15px] size-2.5 rounded-full ${DOT[t.tone]}`} />
                        <span className="grid min-w-0 gap-1">
                          <span className="t-strong line-clamp-2">{t.text}</span>
                          <span className="t-caption truncate text-[var(--ink-3)]">{t.sub}</span>
                        </span>
                        <ChevronRightIcon className="size-[18px] text-[var(--ink-3)]" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              id="deals-title"
              title="Мои закупки"
              action={
                purchases && purchases.length > 0 ? (
                  <Link href="/purchases" className="link">
                    Все закупки
                  </Link>
                ) : undefined
              }
            >
              {(error || sampleError) && (
                <div className="p-[var(--pad)]">
                  <Note tone="warn" icon={AlertTriangleIcon}>
                    {STORAGE_ERROR}
                  </Note>
                </div>
              )}
              {purchases?.length === 0 && (
                <div className="grid justify-items-start gap-4 p-[var(--pad)]">
                  <p className="max-w-[52ch] text-[var(--ink-2)]">
                    Загрузите документы закупки — выпишу требования и сроки, составлю черновик технического предложения и отвечу на вопросы по документам.
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <Link href="/new" className="btn">
                      <PlusIcon />
                      Новая закупка
                    </Link>
                    <span className="text-[var(--ink-3)]">
                      или{" "}
                      <button type="button" onClick={() => void sample()} className="link">
                        посмотреть на примере
                      </button>
                    </span>
                  </div>
                </div>
              )}
              {purchases && purchases.length > 0 && (
                <ul className="divide-y divide-[var(--line)]">
                  {purchases.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/p/${p.id}`}
                        className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-[var(--pad)] py-3 hover:bg-[var(--hover)] max-sm:grid-cols-[auto_minmax(0,1fr)] max-sm:gap-y-2"
                      >
                        <LawBadge purchase={p} />
                        <span className="grid min-w-0 gap-1">
                          <span className="t-strong line-clamp-2">
                            {titleOf(p)}
                            {p.sample && <span className="t-tag ml-2 text-[var(--ink-3)]">пример</span>}
                          </span>
                          <span className="t-caption text-[var(--ink-3)]">
                            <DueText purchase={p} />
                          </span>
                        </span>
                        <span className="max-sm:col-start-2">
                          <TpTag purchase={p} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <div className="grid min-w-0 gap-4">
            <AskBox />
            <Panel id="mine-title" title="Мои данные">
              <ul className="divide-y divide-[var(--line)]">
                <DataRow href="/me/profile" icon={UserRoundIcon} title="Реквизиты" sub={me ? `Заполнено ${me.filled} из ${total}` : "…"}>
                  <span aria-hidden className="mt-1 h-1 overflow-hidden rounded-[var(--r-pill)] bg-[var(--paper-3)]">
                    <span className="block h-full rounded-[inherit] bg-primary" style={{ width: `${me ? Math.round((me.filled / total) * 100) : 0}%` }} />
                  </span>
                </DataRow>
                <DataRow
                  href="/me/documents"
                  icon={FolderIcon}
                  title="Мои документы"
                  sub={
                    !me
                      ? "…"
                      : me.docs
                        ? `${me.docs} ${plural(me.docs, "документ", "документа", "документов")} · по ним пишутся новые`
                        : "Загрузите то, что подавали раньше"
                  }
                />
              </ul>
            </Panel>
          </div>
        </div>

        <p className="t-caption mt-4 max-w-[90ch] text-[var(--ink-3)]">
          Закупки хранятся в этом браузере. Ответы ИИ не являются юридической консультацией — проверяйте нормы по первоисточнику.
        </p>
      </PageBody>
    </>
  );
}
