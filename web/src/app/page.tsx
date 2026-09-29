"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, DOT } from "@/components/badge";
import { CaretRightIcon, FolderIcon, PlusIcon, UserIcon, WarningIcon, type IconComponent } from "@/components/icons";
import { Island } from "@/components/island";
import { Note } from "@/components/note";
import { PageBody, PageHeader } from "@/components/page-header";
import { LawBadge } from "@/components/purchase-bits";
import { onDataChanged } from "@/lib/db";
import { daysText, dueLine } from "@/lib/deadline";
import { dueBadge, GO_LABEL, LANES, laneNote, laneOf, stageBadge, tasksOf, type BadgeInfo, type LaneKey, type Task } from "@/lib/home";
import { countMyDocumentKinds, getProfile } from "@/lib/me-store";
import { plural } from "@/lib/plural";
import { filledCount, PROFILE_KEYS } from "@/lib/profile";
import { titleOf, type Purchase } from "@/lib/purchase";
import { scanNames } from "@/lib/purchase-store";
import { openSamplePurchase } from "@/lib/sample-purchase";
import type { Tone } from "@/lib/steps";
import { STORAGE_ERROR, usePurchases } from "@/lib/use-purchases";

const NOTE: Record<Tone, string> = {
  bad: "text-[var(--danger)]",
  warn: "text-[var(--warn)]",
  brand: "text-primary",
  ok: "text-[var(--ok)]",
  calm: "text-[var(--ink-3)]",
};

// Строка-пункт в острове, как в карточке меню: значок, текст, бейдж, стрелка; без разделителей.
// На узком острове бейдж уходит под название — название не обрезается.
const ROWS = "grid gap-0.5 px-2 pb-2";
const ROW =
  "item grid grid-cols-[auto_minmax(0,1fr)_auto_auto] gap-x-2.5 py-2 @max-[520px]:grid-cols-[auto_minmax(0,1fr)_auto] @max-[520px]:gap-y-1.5";
const ROW_LEAD = "@max-[520px]:row-span-2 @max-[520px]:self-start";
const ROW_BADGE = "justify-self-end @max-[520px]:col-start-2 @max-[520px]:row-start-2 @max-[520px]:justify-self-start";
const ROW_CHEV = "size-4 text-[var(--ink-3)] @max-[520px]:col-start-3 @max-[520px]:row-span-2 @max-[520px]:row-start-1 @max-[520px]:self-center";

function Row({ href, lead, title, sub, badge, children }: { href: string; lead: ReactNode; title: string; sub: string; badge: BadgeInfo; children?: ReactNode }) {
  return (
    <li>
      <Link href={href} className={ROW}>
        {lead}
        <span className="grid min-w-0 gap-0.5">
          <span className="t-strong line-clamp-2">{title}</span>
          <span className="t-caption truncate text-[var(--ink-3)]">{sub}</span>
          {children}
        </span>
        <Badge {...badge} className={ROW_BADGE} />
        <CaretRightIcon className={ROW_CHEV} />
      </Link>
    </li>
  );
}

// «Сейчас важно»: самое срочное дело — крупно, с единственной заливной кнопкой экрана; остальные — строками по сроку.
function Now({ tasks }: { tasks: Task[] }) {
  if (!tasks.length) {
    return (
      <p className="flex flex-wrap items-center gap-2 px-[var(--pad)] pb-3.5 pt-1 text-[var(--ink-2)]">
        <Badge tone="ok" text="всё сделано" icon="check" />
        По открытым закупкам делать нечего.
      </p>
    );
  }
  const [top, ...rest] = tasks;
  const p = top.purchase;
  return (
    <>
      <div className="mx-2 mb-2 mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-[var(--r-surface)] bg-[var(--paper-2)] p-3">
        <div className="grid min-w-0 flex-[1_1_320px] gap-1.5">
          <div className="flex flex-wrap gap-1.5">
            <Badge {...dueBadge(p, true)} onPaper />
            {p.sample && <Badge tone="calm" text="пример" onPaper />}
          </div>
          <p className="t-title text-pretty">{top.text}</p>
          <p className="text-[var(--ink-2)]">{[titleOf(p), p.customer].filter(Boolean).join(" · ")}</p>
        </div>
        <Link href={top.href} className="btn">
          {GO_LABEL[top.go]}
          <CaretRightIcon />
        </Link>
      </div>
      {rest.length > 0 && (
        <ul className={ROWS}>
          {rest.map((t) => (
            <Row
              key={t.key}
              href={t.href}
              lead={<span aria-hidden className={`mx-[11px] my-auto size-2.5 rounded-full ${DOT[t.tone]} ${ROW_LEAD} @max-[520px]:mt-[5px]`} />}
              title={t.text}
              sub={titleOf(t.purchase)}
              badge={dueBadge(t.purchase)}
            />
          ))}
        </ul>
      )}
    </>
  );
}

// «Закупки по этапам»: четыре плашки этапов и таблица. Нажатие на этап оставляет в таблице только его закупки,
// повторное — показывает все. Этап следует из шагов и срока подачи (lib/home.ts), руками его не двигают.
const DEAL_COLS = "grid-cols-[32px_minmax(0,1fr)_184px_120px_16px] @max-[640px]:grid-cols-[32px_minmax(0,1fr)_16px]";

function Deals({ purchases }: { purchases: Purchase[] }) {
  const [picked, setPicked] = useState<LaneKey | null>(null);
  const lane = picked && purchases.some((p) => laneOf(p) === picked) ? picked : null;
  const shown = lane ? purchases.filter((p) => laneOf(p) === lane) : purchases;

  return (
    <>
      <div
        role="group"
        aria-label="Этапы: нажмите, чтобы оставить в таблице только этап"
        className="grid grid-cols-4 gap-2 px-[var(--pad)] pb-3 pt-1 @max-[560px]:grid-cols-1 @max-[560px]:gap-1"
      >
        {LANES.map((l) => {
          const inLane = purchases.filter((p) => laneOf(p) === l.key);
          const note = laneNote(l.key, inLane);
          return (
            <button
              key={l.key}
              type="button"
              aria-pressed={lane === l.key}
              disabled={!inLane.length}
              onClick={() => setPicked(lane === l.key ? null : l.key)}
              className="group grid min-w-0 content-start justify-items-start gap-0.5 rounded-[var(--r-surface)] bg-[var(--paper-2)] px-3 py-2.5 text-left enabled:hover:bg-[var(--paper-3)] disabled:cursor-default aria-pressed:bg-[var(--select)] aria-pressed:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--brand)_35%,transparent)] @max-[560px]:min-h-11 @max-[560px]:grid-cols-[minmax(0,1fr)_auto] @max-[560px]:items-center @max-[560px]:gap-x-3 @max-[560px]:rounded-[var(--r-card)] @max-[560px]:py-1.5"
            >
              <span className="t-caption text-[var(--ink-2)] @max-[560px]:t-body @max-[560px]:col-start-1 @max-[560px]:row-start-1 @max-[560px]:text-[var(--ink)]">
                {l.title}
              </span>
              <span className="[font:600_20px/28px_var(--mono)] tabular-nums group-disabled:text-[var(--ink-3)] @max-[560px]:col-start-2 @max-[560px]:row-span-2 @max-[560px]:row-start-1 @max-[560px]:[font:600_16px/24px_var(--mono)]">
                {inLane.length}
              </span>
              <span className={`t-tag ${NOTE[note.tone]} @max-[560px]:col-start-1 @max-[560px]:row-start-2`}>{note.text}</span>
            </button>
          );
        })}
      </div>

      <div aria-hidden className={`t-caption mx-[var(--pad)] grid ${DEAL_COLS} gap-x-3 border-b border-[var(--line)] pb-1.5 text-[var(--ink-3)] @max-[640px]:hidden`}>
        <span className="col-start-2">Закупка</span>
        <span>Что сейчас</span>
        <span>До подачи</span>
      </div>
      <ul className="grid gap-0.5 px-2 pb-2 pt-1">
        {shown.map((p) => (
          <li key={p.id}>
            <Link href={`/p/${p.id}`} className={`grid ${DEAL_COLS} items-center gap-x-3 gap-y-1.5 rounded-[var(--r-ctl)] p-2 hover:bg-[var(--hover)]`}>
              <LawBadge purchase={p} />
              <span className="grid min-w-0 gap-0.5">
                <span className="t-strong line-clamp-2">{titleOf(p)}</span>
                <span className="t-caption truncate text-[var(--ink-3)]">{[p.sample ? "пример" : "", p.customer].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="contents @max-[640px]:col-start-2 @max-[640px]:flex @max-[640px]:flex-wrap @max-[640px]:gap-1.5">
                <Badge {...stageBadge(p)} className="justify-self-start" />
                <Badge {...dueBadge(p)} className="justify-self-start" />
              </span>
              <CaretRightIcon className="size-4 text-[var(--ink-3)] @max-[640px]:col-start-3 @max-[640px]:row-start-1" />
            </Link>
          </li>
        ))}
      </ul>
      {lane && (
        <p className="t-caption flex flex-wrap items-center gap-x-3 gap-y-1 px-[var(--pad)] pb-3 text-[var(--ink-3)]">
          Показан этап «{LANES.find((l) => l.key === lane)!.title}».
          <button type="button" onClick={() => setPicked(null)} className="link link-quiet">
            Показать все закупки
          </button>
        </p>
      )}
    </>
  );
}

function DataIcon({ icon: Icon }: { icon: IconComponent }) {
  return (
    <span aria-hidden className={`law law-icon ${ROW_LEAD}`}>
      <Icon className="size-4" />
    </span>
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

type Me = { filled: number; docs: number; tp: number };

// Главная — рабочий стол в одну колонку, три острова по важности: самое срочное дело, закупки по этапам,
// данные компании. Новому пользователю — «С чего начать» вместо пустых списков. Вопросы — в «Спросить про тендер».
export default function HomePage() {
  const router = useRouter();
  const { purchases, error } = usePurchases();
  const [me, setMe] = useState<Me | null>(null);
  const [scans, setScans] = useState<Record<string, string[]>>({});
  const [sampleError, setSampleError] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all([getProfile(), countMyDocumentKinds()]).then(
        ([profile, docs]) => alive && setMe({ filled: filledCount(profile), docs: docs.total, tp: docs.kinds.tp ?? 0 }),
        () => alive && setMe({ filled: 0, docs: 0, tp: 0 })
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
  const missing = me ? total - me.filled : 0;
  const fresh = purchases?.length === 0;
  const tasks = purchases && !fresh ? tasksOf(purchases, scans) : null;
  const next = purchases?.map((p) => ({ p, due: dueLine(p.deadline, false) })).find(({ due }) => due && due.days >= 0);
  const sub = !purchases
    ? ""
    : next
      ? `Ближайший срок подачи ${next.due!.days === 0 ? "сегодня" : `через ${daysText(next.due!.days)}`}: ${titleOf(next.p)}`
      : fresh
        ? "Начните с документов первой закупки"
        : "Сроков подачи впереди нет";
  // Заливная кнопка на экране одна: пока в содержимом есть своя — у дела или «С чего начать», — «Новая закупка» с обводкой.
  const quiet = !tasks || tasks.length > 0;

  return (
    <>
      <PageHeader
        title="Главная"
        sub={sub}
        actions={
          // Уже 1024 px «Новая закупка» — плюсом в шапке каркаса, второй раз её не ставим
          <Link href="/new" className={`btn ${quiet ? "btn-line" : ""} max-lg:hidden`}>
            <PlusIcon />
            Новая закупка
          </Link>
        }
      />
      <PageBody>
        <div className="grid max-w-[1040px] gap-2">
          {(error || sampleError) && (
            <Note tone="warn" icon={WarningIcon}>
              {error ?? STORAGE_ERROR}
            </Note>
          )}

          {fresh && <Start onSample={() => void sample()} />}

          {tasks && (
            <Island id="now-title" title="Сейчас важно" count={tasks.length || undefined} className="@container">
              <Now tasks={tasks} />
            </Island>
          )}

          {purchases && purchases.length > 0 && (
            <Island
              id="deals-title"
              title="Закупки по этапам"
              count={purchases.length}
              sub="Нажмите на этап — останутся только его закупки"
              className="@container"
              action={
                <Link href="/purchases" className="link t-caption">
                  Все закупки
                </Link>
              }
            >
              <Deals purchases={purchases} />
            </Island>
          )}

          <Island id="mine-title" title="Данные компании" sub="Вписываются один раз и сами подставляются в анкету, декларацию и цену" className="@container">
            <ul className={ROWS}>
              <Row
                href="/me/profile"
                lead={<DataIcon icon={UserIcon} />}
                title="Реквизиты"
                sub={me ? `Заполнено ${me.filled} из ${total}` : "…"}
                badge={
                  !me
                    ? { tone: "calm", text: "…" }
                    : missing
                      ? { tone: "warn", text: `не хватает ${missing} ${plural(missing, "поля", "полей", "полей")}`, icon: "pen" }
                      : { tone: "ok", text: "заполнены", icon: "check" }
                }
              >
                <span aria-hidden className="mt-1 h-1 max-w-[240px] overflow-hidden rounded-[var(--r-pill)] bg-[var(--paper-3)]">
                  <span className="block h-full rounded-[inherit] bg-primary" style={{ width: `${me ? Math.round((me.filled / total) * 100) : 0}%` }} />
                </span>
              </Row>
              <Row
                href="/me/documents"
                lead={<DataIcon icon={FolderIcon} />}
                title="Образцы и реквизиты"
                sub={
                  !me
                    ? "…"
                    : me.docs
                      ? `${me.docs} ${plural(me.docs, "документ", "документа", "документов")} · по ним пишутся новые`
                      : "Прошлые заявки — чтобы писать в вашем стиле"
                }
                badge={
                  !me
                    ? { tone: "calm", text: "…" }
                    : me.tp
                      ? { tone: "ok", text: `ТП: ${me.tp}`, icon: "check" }
                      : { tone: "warn", text: "нет образцов ТП", icon: "alert" }
                }
              />
            </ul>
          </Island>
        </div>

        <p className="t-caption mt-3 max-w-[90ch] px-[var(--pad)] text-[var(--ink-3)]">
          Закупки хранятся в этом браузере. Ответы ИИ не являются юридической консультацией — проверяйте нормы по первоисточнику.
        </p>
      </PageBody>
    </>
  );
}
