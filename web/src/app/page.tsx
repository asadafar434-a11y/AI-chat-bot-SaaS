"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, ChevronRightIcon, FolderIcon, PlusIcon, UserRoundIcon, type LucideIcon } from "lucide-react";
import { AskBox } from "@/components/ask-box";
import { Island } from "@/components/island";
import { Note } from "@/components/note";
import { PageBody, PageHeader } from "@/components/page-header";
import { daysText, LawBadge } from "@/components/purchase-bits";
import { checkCounts } from "@/lib/check";
import { onDataChanged } from "@/lib/db";
import { dueLine } from "@/lib/deadline";
import { countMyDocuments, getProfile } from "@/lib/me-store";
import { plural } from "@/lib/plural";
import { filledCount, PROFILE_KEYS } from "@/lib/profile";
import { titleOf, type Purchase } from "@/lib/purchase";
import { scanNames } from "@/lib/purchase-store";
import { openSamplePurchase } from "@/lib/sample-purchase";
import { stageOf, stepsOf, TONE_TEXT } from "@/lib/steps";
import { STORAGE_ERROR, usePurchases } from "@/lib/use-purchases";

type Task = { key: string; href: string; text: string; sub: string; tone: "warn" | "bad" | "brand" | "calm" };

// Что сделать сейчас по закупкам, где ещё идёт приём, — по шагам подготовки заявки; потом реквизиты.
// Порядок — по сроку подачи.
function tasksOf(purchases: Purchase[], scans: Record<string, string[]>, missing: number): Task[] {
  const tasks: Task[] = [];
  for (const p of purchases) {
    const due = dueLine(p.deadline, false);
    if (!due || due.days < 0) continue;
    const sub = `${titleOf(p)} · ${due.days === 0 ? "подать сегодня" : `${daysText(due.days)} до подачи`}`;
    const urgent = due.tone === "soon" ? "warn" : "brand";
    const [, tp, check] = stepsOf(p);
    const bad = p.check ? checkCounts(p.check).bad : 0;
    if (bad) {
      const text = bad === 1 ? "Исправить ошибку в заявке" : `Исправить ошибки в заявке — ${bad}`;
      tasks.push({ key: `${p.id}:check`, href: check.href, text, sub, tone: "bad" });
    } else if (!p.check) {
      if (tp.state === "todo") tasks.push({ key: `${p.id}:tp`, href: tp.href, text: "Составить техническое предложение", sub, tone: urgent });
      else if (tp.state === "fix") tasks.push({ key: `${p.id}:tp`, href: tp.href, text: `Вписать свои данные в ТП — ${tp.status.replace(/^впишите /, "")}`, sub, tone: urgent });
      else tasks.push({ key: `${p.id}:check`, href: check.href, text: "Проверить заявку перед подачей", sub, tone: urgent });
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
    tasks.push({ key: "profile", href: "/me/profile", text, sub: "подставятся в анкету, декларацию и цену", tone: "calm" });
  }
  return tasks;
}

const DOT = {
  bad: "bg-destructive shadow-[0_0_0_3px_color-mix(in_srgb,var(--danger)_14%,transparent)]",
  warn: "bg-[var(--warn)] shadow-[0_0_0_3px_var(--warn-tint)]",
  brand: "bg-primary shadow-[0_0_0_3px_var(--brand-tint)]",
  calm: "bg-[var(--edge-2)] shadow-[0_0_0_3px_var(--paper-2)]",
};

// Строка-пункт в острове, как в карточке меню: значок, текст, стрелка; без разделителей.
const ROW = "item grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-2.5 py-2";
const ROWS = "grid gap-0.5 px-2 pb-2";

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
          <Icon className="size-4" />
        </span>
        <span className="grid min-w-0 gap-0.5">
          <span className="t-strong">{title}</span>
          <span className="t-caption truncate text-[var(--ink-3)]">{sub}</span>
          {children}
        </span>
        <ChevronRightIcon className="my-auto size-4 text-[var(--ink-3)]" />
      </Link>
    </li>
  );
}

// Первый запуск: весь путь в трёх шагах и одна главная кнопка — одним островом.
function Start({ onSample }: { onSample: () => void }) {
  const steps = [
    { n: "1", title: "Загрузите документы закупки", text: "Извещение, ТЗ и проект контракта — PDF, Word, сканы или фото." },
    { n: "2", title: "Пройдите три шага", text: "Требования, техническое предложение, проверка заявки. Каждый шаг подскажет, что делать дальше." },
    { n: "3", title: "Подайте заявку на площадке", text: "Срок подачи и сколько дней осталось — всегда в шапке закупки." },
  ];
  return (
    <Island
      id="start-title"
      title="С чего начать"
      action={
        <Link href="/help" className="link link-quiet t-caption">
          Как это работает
        </Link>
      }
    >
      <ol className="grid gap-x-6 gap-y-4 px-[var(--pad)] pb-4 pt-2 md:grid-cols-3">
        {steps.map((s) => (
          <li key={s.n} className="grid content-start gap-1">
            <span aria-hidden className="mb-1 grid size-6 place-items-center rounded-full bg-[var(--brand-tint)] font-mono text-xs font-bold text-primary">
              {s.n}
            </span>
            <p className="t-strong">{s.title}</p>
            <p className="text-[var(--ink-2)]">{s.text}</p>
          </li>
        ))}
      </ol>
      <div className="mx-[var(--pad)] flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--line)] py-3">
        <Link href="/new" className="btn">
          <PlusIcon />
          Загрузить документы закупки
        </Link>
        <span className="text-[var(--ink-3)]">
          или{" "}
          <button type="button" onClick={onSample} className="link">
            посмотреть на примере
          </button>
        </span>
      </div>
    </Island>
  );
}

// Главная — что сделать сейчас: дела по шагам, закупки по срочности, вопрос и данные компании.
// Новому пользователю — «С чего начать» вместо пустых списков.
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
  const fresh = purchases?.length === 0;
  const tasks = purchases && me && !fresh ? tasksOf(purchases, scans, total - me.filled) : null;
  const next = purchases?.map((p) => ({ p, due: dueLine(p.deadline, false) })).find(({ due }) => due && due.days >= 0);
  const sub = !purchases
    ? ""
    : next
      ? `Ближайший срок подачи ${next.due!.days === 0 ? "сегодня" : `через ${daysText(next.due!.days)}`}: ${titleOf(next.p)}`
      : fresh
        ? "Начните с документов первой закупки"
        : "Сроков подачи впереди нет";

  return (
    <>
      <PageHeader
        title="Главная"
        sub={sub}
        actions={
          <Link href="/new" aria-label="Новая закупка" className="btn max-sm:w-8 max-sm:px-0">
            <PlusIcon />
            <span className="max-sm:hidden">Новая закупка</span>
          </Link>
        }
      />
      <PageBody>
        <div className="grid items-start gap-2 split:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
          <div className="grid min-w-0 gap-2">
            {(error || sampleError) && (
              <Note tone="warn" icon={AlertTriangleIcon}>
                {STORAGE_ERROR}
              </Note>
            )}

            {fresh && <Start onSample={() => void sample()} />}

            {tasks && (
              <Island id="todo-title" title="Что сделать сейчас" count={tasks.length}>
                {tasks.length === 0 ? (
                  <p className="px-[var(--pad)] pb-3 pt-1 text-[var(--ink-3)]">Всё сделано: по открытым закупкам делать нечего.</p>
                ) : (
                  <ul className={ROWS}>
                    {tasks.map((t) => (
                      <li key={t.key}>
                        <Link href={t.href} className={ROW}>
                          <span aria-hidden className={`mx-[11px] my-auto size-2.5 rounded-full ${DOT[t.tone]}`} />
                          <span className="grid min-w-0">
                            <span className="t-strong line-clamp-2">{t.text}</span>
                            <span className="t-caption truncate text-[var(--ink-3)]">{t.sub}</span>
                          </span>
                          <ChevronRightIcon className="my-auto size-4 text-[var(--ink-3)]" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Island>
            )}

            {purchases && purchases.length > 0 && (
              <Island
                id="deals-title"
                title="Мои закупки"
                count={purchases.length}
                action={
                  <Link href="/purchases" className="link t-caption">
                    Все закупки
                  </Link>
                }
              >
                <ul className={ROWS}>
                  {purchases.map((p) => {
                    const stage = stageOf(p);
                    return (
                      <li key={p.id}>
                        <Link href={`/p/${p.id}`} className={ROW}>
                          <LawBadge purchase={p} />
                          <span className="grid min-w-0">
                            <span className="t-strong line-clamp-2">
                              {titleOf(p)}
                              {p.sample && <span className="t-tag ml-2 text-[var(--ink-3)]">пример</span>}
                            </span>
                            <span className="t-caption truncate text-[var(--ink-3)]">
                              <DueText purchase={p} />
                            </span>
                            <span className={`t-tag mt-0.5 ${TONE_TEXT[stage.tone]}`}>{stage.text}</span>
                          </span>
                          <ChevronRightIcon className="my-auto size-4 text-[var(--ink-3)]" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Island>
            )}
          </div>

          <div className="grid min-w-0 gap-2">
            <AskBox />
            <Island
              id="mine-title"
              title="Данные компании"
              action={fresh ? <span className="t-caption text-[var(--ink-3)]">можно заполнить заранее</span> : undefined}
            >
              <ul className={ROWS}>
                <DataRow
                  href="/me/profile"
                  icon={UserRoundIcon}
                  title="Реквизиты"
                  sub={me ? `Заполнено ${me.filled} из ${total} · для анкеты и декларации` : "…"}
                >
                  <span aria-hidden className="mt-1 h-1 overflow-hidden rounded-[var(--r-pill)] bg-[var(--paper-3)]">
                    <span className="block h-full rounded-[inherit] bg-primary" style={{ width: `${me ? Math.round((me.filled / total) * 100) : 0}%` }} />
                  </span>
                </DataRow>
                <DataRow
                  href="/me/documents"
                  icon={FolderIcon}
                  title="Документы компании"
                  sub={
                    !me
                      ? "…"
                      : me.docs
                        ? `${me.docs} ${plural(me.docs, "документ", "документа", "документов")} · по ним пишутся новые`
                        : "Прошлые заявки — чтобы писать в вашем стиле"
                  }
                />
              </ul>
            </Island>
          </div>
        </div>

        <p className="t-caption mt-3 max-w-[90ch] px-[var(--pad)] text-[var(--ink-3)]">
          Закупки хранятся в этом браузере. Ответы ИИ не являются юридической консультацией — проверяйте нормы по первоисточнику.
        </p>
      </PageBody>
    </>
  );
}
