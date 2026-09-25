"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  FileTextIcon,
  LandmarkIcon,
  MessageSquareIcon,
  PanelRightIcon,
  PaperclipIcon,
  RussianRubleIcon,
  ScaleIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { Note } from "@/components/note";
import { DueChip, LawBadge } from "@/components/purchase-bits";
import { usePurchase } from "@/components/purchase-provider";
import { WorkingSteps } from "@/components/working-steps";
import { dueLine } from "@/lib/deadline";
import { extractRequirements, fromRequirements, titleOf, type Purchase } from "@/lib/purchase";
import { ACCEPTED_FILES, readDocuments, type SentDocument } from "@/lib/read-documents";
import { stepsOf, TONE_TEXT, type Step, type StepKey } from "@/lib/steps";

const ADDING_STEPS = [
  "Читаю новые документы…",
  "Перечитываю закупку целиком…",
  "Обновляю требования и сроки…",
  "Сверяю цитаты с документами…",
];

// Тело шага: текст с одного края с названием закупки, строка не шире 760.
export function TabBody({ children }: { children: ReactNode }) {
  return <div className="w-full max-w-[760px] px-[var(--gutter)] pb-6 pt-4">{children}</div>;
}

const DOT = {
  done: "bg-[var(--ok-tint)] text-[var(--ok)]",
  fix: "bg-[var(--warn-tint)] text-[var(--warn)]",
  todo: "bg-card text-[var(--ink-3)] shadow-[inset_0_0_0_1px_var(--edge-2)]",
};

// Шаг подготовки заявки: номер или галочка, название и что на нём сейчас — словами.
// Где панель узкая, название короче («ТП», «Проверка»); диктор всегда читает полное.
function StepLink({ step, current }: { step: Step; current: boolean }) {
  const dot = step.state === "fix" && step.tone === "bad" ? "bg-[color-mix(in_srgb,var(--danger)_12%,var(--card))] text-destructive" : DOT[step.state];
  const full = step.key === "tp" ? "sr-only @min-[840px]:not-sr-only" : "sr-only @min-[760px]:not-sr-only";
  const short = step.key === "tp" ? "@min-[840px]:hidden" : "@min-[760px]:hidden";
  return (
    <Link
      href={step.href}
      aria-current={current ? "page" : undefined}
      className={`-mb-px flex flex-none items-center gap-2 border-b-2 px-2 py-1.5 ${
        current ? "border-primary" : "border-transparent hover:bg-[var(--hover)]"
      }`}
    >
      <span aria-hidden className={`grid size-5 flex-none place-items-center rounded-full font-mono text-xs font-bold ${dot}`}>
        {step.state === "done" ? <CheckIcon className="size-3" strokeWidth={3} /> : step.n}
      </span>
      <span className="grid text-left">
        <span className={current ? "t-strong" : "t-label text-[var(--ink-2)]"}>
          <span className="sr-only">Шаг {step.n}: </span>
          {step.short === step.title ? (
            step.title
          ) : (
            <>
              <span className={full}>{step.title}</span>
              <span aria-hidden className={short}>
                {step.short}
              </span>
            </>
          )}
        </span>
        <span className={`t-caption whitespace-nowrap ${TONE_TEXT[step.tone]}`}>{step.status}</span>
      </span>
    </Link>
  );
}

// Что делать дальше — в конце шага, чтобы путь по закупке был виден без подсказок.
export function NextStep({ from }: { from: StepKey }) {
  const { purchase } = usePurchase();
  const [, tp, check] = stepsOf(purchase);
  const due = dueLine(purchase.deadline, true);

  let next: { label: string; title: string; text: string; href?: string; action?: string } | null = null;
  if (from === "req" && tp.state !== "done") {
    next = {
      label: "Дальше — шаг 2 из 3",
      title: "Техническое предложение",
      text:
        tp.state === "todo"
          ? "Составлю черновик по ТЗ: товары с характеристиками и предложение по каждому пункту. Вам останется вписать своё."
          : `Черновик готов — осталось вписать свои данные: ${tp.status.replace(/^впишите /, "")}.`,
      href: tp.href,
      action: tp.state === "todo" ? "Составить ТП" : "Открыть ТП",
    };
  } else if (from !== "check" && check.state === "todo") {
    next = {
      label: "Дальше — шаг 3 из 3",
      title: "Проверка заявки",
      text: "Соберите заявку и загрузите её перед подачей — сверю с извещением и ТЗ по каждому пункту.",
      href: check.href,
      action: "Проверить заявку",
    };
  } else if (check.state === "done") {
    next = {
      label: "Готово к подаче",
      title: "Подайте заявку на электронной площадке",
      text: due ? `${due.head}${due.left ? ` — ${due.left}` : ""}.` : "Срок подачи — в извещении о закупке.",
    };
  }
  if (!next) return null;

  return (
    <section
      aria-label={next.label}
      className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-[var(--r-card)] border border-[var(--line)] bg-[var(--paper-2)] px-4 py-3"
    >
      <div className="grid min-w-0 gap-0.5">
        <p className={`t-over ${next.href ? "text-[var(--ink-3)]" : "text-[var(--ok)]"}`}>{next.label}</p>
        <p className="t-section">{next.title}</p>
        <p className="text-[var(--ink-2)]">{next.text}</p>
      </div>
      {next.href && (
        <Link href={next.href} className="btn">
          {next.action}
          <ArrowRightIcon />
        </Link>
      )}
    </section>
  );
}

function Fold({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border-b border-[var(--line)]">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="t-section flex min-h-11 w-full items-center gap-2 px-[var(--pad)] py-3 text-left"
        >
          {title}
          {count !== undefined && <span className="count">{count}</span>}
          <ChevronDownIcon className={`ml-auto size-4 text-[var(--ink-3)] transition-transform ${open ? "" : "-rotate-90"}`} />
        </button>
      </h3>
      {open && <div className="grid gap-3 px-[var(--pad)] pb-4">{children}</div>}
    </section>
  );
}

function Fact({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[16px_minmax(0,1fr)] gap-2.5">
      <Icon className="mt-0.5 size-4 text-[var(--ink-3)]" />
      <div className="grid">
        <span className="t-caption text-[var(--ink-3)]">{label}</span>
        {children}
      </div>
    </div>
  );
}

function FileRow({ name, meta, warn }: { name: string; meta: string; warn: boolean }) {
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-2.5">
      <span
        className={`grid size-7 place-items-center rounded-md ${warn ? "bg-[var(--warn-tint)] text-[var(--warn)]" : "bg-[var(--paper-2)] text-[var(--ink-3)]"}`}
      >
        {warn ? <AlertTriangleIcon className="size-3.5" /> : <FileTextIcon className="size-3.5" />}
      </span>
      <span className="grid min-w-0">
        <span className="t-label truncate" title={name}>
          {name}
        </span>
        <span className={warn ? "t-tag text-[var(--warn)]" : "t-caption text-[var(--ink-3)]"}>{meta}</span>
      </span>
    </li>
  );
}

// Сведения о закупке: срок, заказчик, цена, закон; документы закупки с пометками; удаление.
function InfoPane({ purchase, documents, onAdd, onClose, closeButton }: {
  purchase: Purchase;
  documents: SentDocument[];
  onAdd: () => void;
  onClose: () => void;
  closeButton: RefObject<HTMLButtonElement | null>;
}) {
  const { remove } = usePurchase();
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const due = dueLine(purchase.deadline, true);
  const scans = new Set(documents.filter((d) => d.scan).map((d) => d.name));

  async function deleteIt() {
    try {
      await remove();
      router.replace("/purchases");
    } catch {
      setConfirmDelete(false);
      setDeleteError(true);
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="relative grid justify-items-center gap-1.5 border-b border-[var(--line)] px-[var(--pad)] pb-4 pt-5 text-center">
        <button ref={closeButton} type="button" onClick={onClose} aria-label="Скрыть сведения" className="icon-btn absolute right-2 top-2 wide:hidden">
          <XIcon className="size-4" />
        </button>
        <LawBadge purchase={purchase} big />
        <p className="t-section mt-1 text-balance">{purchase.subject || titleOf(purchase)}</p>
        <DueChip due={dueLine(purchase.deadline, false)} />
        {purchase.sample && (
          <p className="t-caption text-[var(--ink-3)]">Пример на вымышленной закупке — нажимайте на всё, ничего не сломается.</p>
        )}
      </div>

      <Fold title="О закупке">
        {due && (
          <Fact icon={ClockIcon} label="Срок подачи">
            <b className="t-strong">{due.head.replace(/^Подать /, "").replace(/^Приём заявок /, "")}</b>
            {due.left && <span className={due.tone === "soon" ? "t-strong text-[var(--warn)]" : "text-[var(--ink-3)]"}>{due.left}</span>}
          </Fact>
        )}
        {purchase.customer && (
          <Fact icon={LandmarkIcon} label="Заказчик">
            <b className="t-strong break-words">{purchase.customer}</b>
          </Fact>
        )}
        {purchase.price && (
          <Fact icon={RussianRubleIcon} label="Начальная цена">
            <b className="t-strong">{purchase.price}</b>
          </Fact>
        )}
        {purchase.kind && (
          <Fact icon={ScaleIcon} label="Закон и способ">
            <b className="t-strong">{purchase.kind}</b>
          </Fact>
        )}
        {!due && !purchase.customer && !purchase.price && !purchase.kind && (
          <p className="text-[var(--ink-3)]">В документах не нашлось ни срока, ни заказчика, ни цены.</p>
        )}
      </Fold>

      <Fold title="Документы закупки" count={purchase.files.length + purchase.unreadable.length}>
        <ul className="grid gap-2.5">
          {purchase.files.map((name) => {
            const scan = scans.has(name);
            const ext = name.includes(".") ? name.split(".").pop()!.toUpperCase() : "";
            return (
              <FileRow
                key={name}
                name={name}
                warn={scan}
                meta={scan ? "со скана — сверьте цифры" : [ext, "прочитан"].filter(Boolean).join(" · ")}
              />
            );
          })}
          {purchase.unreadable.map((f) => (
            <FileRow key={f.name} name={f.name} warn meta={`не прочитан: ${f.reason}`} />
          ))}
        </ul>
        <button type="button" onClick={onAdd} className="link justify-self-start">
          Добавить документы
        </button>
      </Fold>

      <div className="px-[var(--pad)] pb-5 pt-4">
        {deleteError && (
          <Note tone="warn" className="mb-3">
            Не получилось удалить закупку — попробуйте ещё раз.
          </Note>
        )}
        {confirmDelete ? (
          <div className="grid gap-2.5 rounded-[var(--r-card)] bg-[var(--paper-2)] p-3">
            <p className="t-strong">Удалить закупку вместе с документами, черновиком и вопросами? Вернуть её не получится.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void deleteIt()} className="btn btn-danger btn-xs">
                Удалить
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="btn btn-line btn-xs">
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)} className="link link-quiet link-del">
            Удалить закупку
          </button>
        )}
      </div>
    </div>
  );
}

// Открытая закупка: шапка со сроком, шаги подготовки заявки, тело шага и сведения.
// От 1560 px сведения — третьей панелью, уже — поверх закупки по кнопке «Сведения».
export function PurchaseView({ children }: { children: ReactNode }) {
  const { purchase, documents, replaceDocuments } = usePurchase();
  const pathname = usePathname();
  const [infoOpen, setInfoOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const infoToggle = useRef<HTMLButtonElement>(null);
  const infoClose = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);

  // Сведения поверх закупки: открыли — фокус на крестик, закрыли — обратно на кнопку.
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (infoOpen ? infoClose : infoToggle).current?.focus();
    if (!infoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || window.matchMedia("(min-width: 97.5rem)").matches) return;
      moveFocus.current = true;
      setInfoOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [infoOpen]);

  const toggleInfo = (open: boolean) => {
    moveFocus.current = true;
    setInfoOpen(open);
  };

  // Новый файл может поменять всё — сроки, цену, требования, — поэтому закупка перечитывается целиком.
  // Если модель не ответила, документы не добавляются: требования не должны расходиться с файлами.
  async function addFiles(files: File[]) {
    setAdding(true);
    setError(null);
    setInfoOpen(false);
    try {
      const { documents: added, failed } = await readDocuments(files);
      const addedNames = new Set(added.map((d) => d.name));
      const failedNames = new Set(failed.map((f) => f.name));
      const all = [...documents.filter((d) => !addedNames.has(d.name)), ...added];
      const result = await extractRequirements(all);
      await replaceDocuments(all, {
        ...fromRequirements(result),
        files: all.map((d) => d.name),
        unreadable: [
          ...purchase.unreadable.filter((f) => !addedNames.has(f.name) && !failedNames.has(f.name)),
          ...failed,
        ],
      });
    } catch (e) {
      setError(`Документы не добавлены. ${(e as Error).message}`);
    } finally {
      setAdding(false);
    }
  }

  const base = `/p/${purchase.id}`;
  const steps = stepsOf(purchase);
  const asked = purchase.chat?.filter((m) => m.role === "user").length ?? 0;
  const due = dueLine(purchase.deadline, true);
  const onChat = pathname === `${base}/chat`;

  return (
    <div className="relative flex min-h-0 flex-1">
      <section aria-labelledby="pd-title" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="@container flex min-h-14 flex-none items-center gap-2.5 py-2 pl-[var(--gutter)] pr-3 max-split:pl-1.5">
          <Link href="/purchases" aria-label="Все закупки" className="icon-btn split:hidden">
            <ArrowLeftIcon className="size-4" />
          </Link>
          <span className="contents max-sm:hidden">
            <LawBadge purchase={purchase} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="pd-title" className="t-title truncate max-sm:line-clamp-2 max-sm:whitespace-normal">
              {titleOf(purchase)}
            </h2>
            <p className="t-caption truncate text-[var(--ink-3)]">
              {due ? (
                <>
                  {due.head}
                  {due.left && (
                    <>
                      {" · "}
                      <span className={due.tone === "soon" ? "t-tag text-[var(--warn)]" : ""}>{due.left}</span>
                    </>
                  )}
                </>
              ) : (
                "Срок подачи не найден в документах"
              )}
              {purchase.sample && " · пример"}
            </p>
          </div>
          <div className="flex flex-none items-center gap-1.5">
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={adding}
              aria-label="Добавить документы закупки"
              title="Добавить документы закупки"
              className="btn btn-line btn-xs"
            >
              <PaperclipIcon />
              <span className="@max-[560px]:hidden">Добавить документы</span>
            </button>
            <button
              ref={infoToggle}
              type="button"
              onClick={() => toggleInfo(!infoOpen)}
              aria-controls="ws-info"
              aria-expanded={infoOpen}
              aria-label="Сведения о закупке"
              title="Сведения о закупке"
              className="btn btn-line btn-xs wide:hidden"
            >
              <PanelRightIcon />
              <span className="@max-[460px]:hidden">Сведения</span>
            </button>
          </div>
        </div>

        {/* Шаги подготовки заявки по порядку; «Вопросы» — не шаг, стоят отдельно справа */}
        <nav
          aria-label="Подготовка заявки"
          className="@container flex flex-none items-stretch overflow-x-auto border-y border-[var(--line)] px-[calc(var(--gutter)-8px)] [scrollbar-width:none]"
        >
          <ol className="flex items-stretch">
            {steps.map((step, i) => (
              <li key={step.key} className="flex items-stretch">
                {i > 0 && <ChevronRightIcon aria-hidden className="mx-0.5 my-auto size-3.5 flex-none text-[var(--ink-3)] opacity-60" />}
                <StepLink step={step} current={pathname === step.href} />
              </li>
            ))}
          </ol>
          <Link
            href={`${base}/chat`}
            aria-current={onChat ? "page" : undefined}
            className={`-mb-px ml-auto flex flex-none items-center gap-2 border-b-2 px-2 ${
              onChat ? "t-strong border-primary" : "t-label border-transparent text-[var(--ink-2)] hover:bg-[var(--hover)]"
            }`}
          >
            <MessageSquareIcon className="size-4 text-[var(--ink-3)]" />
            <span className="@max-[660px]:sr-only">Вопросы</span>
            {asked > 0 && <span className="count rounded-md bg-[var(--paper-2)] px-1.5">{asked}</span>}
          </Link>
        </nav>

        <div data-scroll-root className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          {adding ? (
            <TabBody>
              <WorkingSteps steps={ADDING_STEPS} />
            </TabBody>
          ) : (
            <>
              {error && (
                <div className="w-full max-w-[760px] px-[var(--gutter)] pt-4">
                  <Note tone="warn" icon={AlertTriangleIcon}>
                    {error}
                  </Note>
                </div>
              )}
              {children}
            </>
          )}
        </div>
      </section>

      <aside
        id="ws-info"
        aria-label="Сведения о закупке"
        className={`flex w-[var(--info-w)] flex-none flex-col border-l border-[var(--line)] bg-card max-wide:absolute max-wide:inset-y-0 max-wide:right-0 max-wide:z-10 max-wide:w-[min(320px,100%)] max-wide:shadow-[var(--lift-lg)] ${
          infoOpen ? "" : "max-wide:hidden"
        }`}
      >
        <InfoPane
          purchase={purchase}
          documents={documents}
          onAdd={() => input.current?.click()}
          onClose={() => toggleInfo(false)}
          closeButton={infoClose}
        />
      </aside>

      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPTED_FILES}
        className="hidden"
        onChange={(e) => {
          const files = e.currentTarget.files ? [...e.currentTarget.files] : [];
          e.currentTarget.value = "";
          if (files.length) void addFiles(files);
        }}
      />
    </div>
  );
}
