"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ChevronDownIcon,
  ClockIcon,
  FileTextIcon,
  LandmarkIcon,
  PanelRightIcon,
  PaperclipIcon,
  RussianRubleIcon,
  ScaleIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { Note } from "@/components/note";
import { DueChip, LawBadge, TpMark } from "@/components/purchase-bits";
import { usePurchase } from "@/components/purchase-provider";
import { WorkingSteps } from "@/components/working-steps";
import { dueLine } from "@/lib/deadline";
import { extractRequirements, fromRequirements, titleOf, type Purchase } from "@/lib/purchase";
import { ACCEPTED_FILES, readDocuments, type SentDocument } from "@/lib/read-documents";
import { REQ_GROUP_KEYS } from "@/lib/requirements";

const ADDING_STEPS = [
  "Читаю новые документы…",
  "Перечитываю закупку целиком…",
  "Обновляю требования и сроки…",
  "Сверяю цитаты с документами…",
];

// Тело вкладки: текст с одного края с заголовком закупки, строка не шире 840.
export function TabBody({ children }: { children: ReactNode }) {
  return <div className="w-full max-w-[840px] px-[var(--gutter)] pb-8 pt-[var(--gutter)]">{children}</div>;
}

function Tab({ href, current, label, extra }: { href: string; current: boolean; label: string; extra?: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`-mb-px inline-flex h-12 flex-none items-center gap-2 whitespace-nowrap border-b-2 px-3 ${
        current ? "t-strong border-primary text-foreground" : "t-label border-transparent text-[var(--ink-3)] hover:text-foreground"
      }`}
    >
      {label}
      {extra}
    </Link>
  );
}

const tabCount = (n: number, current: boolean) => (
  <span className={`count rounded-md px-1.5 ${current ? "bg-[var(--brand-tint)] text-primary" : "bg-[var(--paper-2)]"}`}>{n}</span>
);

function Fold({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border-b border-[var(--line)]">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="t-section flex min-h-14 w-full items-center gap-2 px-[var(--pad)] py-4 text-left"
        >
          {title}
          {count !== undefined && <span className="count">{count}</span>}
          <ChevronDownIcon className={`ml-auto size-[18px] text-[var(--ink-3)] transition-transform ${open ? "" : "-rotate-90"}`} />
        </button>
      </h3>
      {open && <div className="grid gap-4 px-[var(--pad)] pb-[var(--pad)]">{children}</div>}
    </section>
  );
}

function Fact({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[20px_minmax(0,1fr)] gap-3">
      <Icon className="mt-px size-[18px] text-[var(--ink-3)]" />
      <div className="grid">
        <span className="t-caption text-[var(--ink-3)]">{label}</span>
        {children}
      </div>
    </div>
  );
}

function FileRow({ name, meta, warn }: { name: string; meta: string; warn: boolean }) {
  return (
    <li className="grid grid-cols-[32px_minmax(0,1fr)] items-center gap-3">
      <span
        className={`grid size-8 place-items-center rounded-lg ${warn ? "bg-[var(--warn-tint)] text-[var(--warn)]" : "bg-[var(--paper-2)] text-[var(--ink-3)]"}`}
      >
        {warn ? <AlertTriangleIcon className="size-4" /> : <FileTextIcon className="size-4" />}
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

// Сведения о закупке: срок, заказчик, цена, закон; документы с пометками; удаление.
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
      <div className="relative grid justify-items-center gap-2 border-b border-[var(--line)] px-[var(--pad)] pb-5 pt-6 text-center">
        <button ref={closeButton} type="button" onClick={onClose} aria-label="Скрыть сведения" className="icon-btn absolute right-3 top-3 wide:hidden">
          <XIcon className="size-[18px]" />
        </button>
        <LawBadge purchase={purchase} big />
        <p className="t-section mt-1 text-balance">{purchase.subject || titleOf(purchase)}</p>
        <DueChip due={dueLine(purchase.deadline, false)} />
        {purchase.sample && (
          <p className="t-caption text-[var(--ink-3)]">Пример на вымышленной закупке — нажимайте на всё, ничего не сломается.</p>
        )}
      </div>

      <Fold title="Сведения">
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
          <p className="t-body text-[var(--ink-3)]">В документах не нашлось ни срока, ни заказчика, ни цены.</p>
        )}
      </Fold>

      <Fold title="Документы" count={purchase.files.length + purchase.unreadable.length}>
        <ul className="grid gap-3">
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

      <div className="px-[var(--pad)] pb-6 pt-[var(--pad)]">
        {deleteError && (
          <Note tone="warn" className="mb-3">
            Не получилось удалить закупку — попробуйте ещё раз.
          </Note>
        )}
        {confirmDelete ? (
          <div className="grid gap-3 rounded-[var(--r-card)] bg-[var(--paper-2)] p-4">
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

// Открытая закупка: шапка со сроком, вкладки, тело вкладки и сведения. От 1560 px сведения — третьей
// панелью, уже — поверх закупки по кнопке.
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
  const reqCount = REQ_GROUP_KEYS.reduce((n, key) => n + purchase.requirements[key].length, 0);
  const asked = purchase.chat?.filter((m) => m.role === "user").length ?? 0;
  const sub = [purchase.kind, purchase.sample ? "пример" : ""].filter(Boolean).join(" · ");

  return (
    <div className="relative flex min-h-0 flex-1">
      <section aria-labelledby="pd-title" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex min-h-20 flex-none items-center gap-3 py-4 pl-[var(--gutter)] pr-4 max-split:pl-2 max-sm:min-h-[72px] max-sm:gap-2">
          <Link href="/purchases" aria-label="Все закупки" className="icon-btn split:hidden">
            <ArrowLeftIcon className="size-[18px]" />
          </Link>
          <span className="contents max-sm:hidden">
            <LawBadge purchase={purchase} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="pd-title" className="t-title truncate max-sm:t-section max-sm:line-clamp-2 max-sm:whitespace-normal">
              {titleOf(purchase)}
            </h2>
            {sub && <p className="t-caption truncate text-[var(--ink-3)]">{sub}</p>}
          </div>
          <div className="flex flex-none items-center gap-1">
            <DueChip due={dueLine(purchase.deadline, false)} className="mr-2 max-sm:hidden" />
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={adding}
              aria-label="Добавить документы"
              title="Добавить документы"
              className="icon-btn disabled:opacity-60"
            >
              <PaperclipIcon className="size-[18px]" />
            </button>
            <button
              ref={infoToggle}
              type="button"
              onClick={() => toggleInfo(!infoOpen)}
              aria-controls="ws-info"
              aria-expanded={infoOpen}
              aria-label="Сведения о закупке"
              title="Сведения о закупке"
              className="icon-btn wide:hidden"
            >
              <PanelRightIcon className="size-[18px]" />
            </button>
          </div>
        </div>

        <nav aria-label="Разделы закупки" className="flex flex-none gap-1 overflow-x-auto border-y border-[var(--line)] px-[calc(var(--gutter)-12px)] [scrollbar-width:none]">
          <Tab href={base} current={pathname === base} label="Требования" extra={tabCount(reqCount, pathname === base)} />
          <Tab href={`${base}/tp`} current={pathname === `${base}/tp`} label="Техническое предложение" extra={<TpMark purchase={purchase} />} />
          <Tab
            href={`${base}/chat`}
            current={pathname === `${base}/chat`}
            label="Вопросы"
            extra={asked ? tabCount(asked, pathname === `${base}/chat`) : null}
          />
        </nav>

        <div data-scroll-root className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          {adding ? (
            <TabBody>
              <WorkingSteps steps={ADDING_STEPS} />
            </TabBody>
          ) : (
            <>
              {error && (
                <div className="w-full max-w-[840px] px-[var(--gutter)] pt-[var(--gutter)]">
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
        className={`flex w-[var(--info-w)] flex-none flex-col border-l border-[var(--line)] bg-card max-wide:absolute max-wide:inset-y-0 max-wide:right-0 max-wide:z-10 max-wide:w-[min(340px,100%)] max-wide:shadow-[var(--lift-lg)] ${
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
