"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  AttachIcon,
  CalculatorIcon,
  BankIcon,
  CaretDownIcon,
  ChatIcon,
  CheckIcon,
  ClockIcon,
  CrossIcon,
  DocumentIcon,
  DownloadIcon,
  PackageCheckIcon,
  PanelRightIcon,
  RubleIcon,
  ScalesIcon,
  ScanSearchIcon,
  SearchIcon,
  ShieldAlertIcon,
  UploadIcon,
  WarningIcon,
  type IconComponent,
} from "@/components/icons";
import { Note } from "@/components/note";
import { DueChip, LawBadge } from "@/components/purchase-bits";
import { usePurchase } from "@/components/purchase-provider";
import { WorkingSteps } from "@/components/working-steps";
import { lawText, procedureHint, procedureOf } from "@/lib/dashboard";
import { dueLine } from "@/lib/deadline";
import { plural } from "@/lib/plural";
import { extractRequirements, fromRequirements, titleOf, type Purchase } from "@/lib/purchase";
import { ACCEPTED_FILES, readDocuments, type SentDocument } from "@/lib/read-documents";
import { stepsOf, type Step, type StepKey } from "@/lib/steps";

const ADDING_STEPS = [
  "Читаю новые документы…",
  "Перечитываю закупку целиком…",
  "Обновляю требования и сроки…",
  "Сверяю цитаты с документами…",
];

// Тело шага — стопка островов под шапкой закупки, по 8 px между ними.
export function TabBody({ children }: { children: ReactNode }) {
  return <div className="grid content-start gap-2">{children}</div>;
}

// Пояснение к шагу — прямо на холсте, по краю текста в островах.
export function StepIntro({ children }: { children: ReactNode }) {
  return <p className="max-w-[80ch] px-[var(--pad)] py-1 text-[var(--ink-2)]">{children}</p>;
}

// Значок шага, как в прототипе: загрузка, анализ, цена, проверка, пакет.
const STEP_ICON: Record<StepKey, IconComponent> = {
  upload: UploadIcon,
  analysis: ScanSearchIcon,
  price: CalculatorIcon,
  review: ShieldAlertIcon,
  package: PackageCheckIcon,
};

// Шаг подготовки заявки: значок (у пройденного — галочка) и название. Что на шаге сейчас — в подсказке и для диктора.
function StepPill({ step, current }: { step: Step; current: boolean }) {
  const Icon = STEP_ICON[step.key];
  const bubble =
    step.state === "done"
      ? "bg-primary text-[var(--on-brand)]"
      : step.state === "fix"
        ? step.tone === "bad"
          ? "bg-[var(--danger-tint)] text-[var(--danger)]"
          : "bg-[var(--warn-tint)] text-[var(--warn)]"
        : "bg-[var(--paper-2)] text-[var(--ink-3)]";
  return (
    <Link
      href={step.href}
      aria-current={current ? "page" : undefined}
      title={`${step.title}: ${step.status}`}
      className={`flex flex-none items-center gap-2 rounded-[var(--r-ctl)] px-2.5 py-1.5 ${
        current ? "t-strong bg-[var(--select)]" : "t-label text-[var(--ink-2)] hover:bg-[var(--hover)]"
      }`}
    >
      <span aria-hidden className={`grid size-6 flex-none place-items-center rounded-full ${bubble}`}>
        {step.state === "done" ? <CheckIcon className="size-3.5" strokeWidth={3} /> : <Icon className="size-3.5" />}
      </span>
      <span>
        <span className="sr-only">Шаг {step.n}: </span>
        {step.title}
        <span className="sr-only">. {step.status}</span>
      </span>
    </Link>
  );
}

// Что делать дальше — в конце шага: первый несделанный шаг после этого, чтобы путь по закупке был виден
// без подсказок. Всё сделано — как подать заявку.
const NEXT_TEXT: Record<Exclude<StepKey, "upload" | "analysis">, (p: Purchase, step: Step) => { title: string; text: string; action: string }> = {
  price: () => ({
    title: "Цена — до какой цены снижаться",
    text: "Посчитаю, до какой цены можно снижаться без убытка, и поставлю вашу цену в заявку.",
    action: "Рассчитать цену",
  }),
  review: (p, step) =>
    !p.tp
      ? {
          title: "Проверка — документы заявки",
          text: "Составлю ТП и другие документы по форме заказчика. Вам останется вписать то, что знаете только вы.",
          action: "Составить документы",
        }
      : {
          title: "Проверка — дописать заявку",
          text: `Осталось в заявке: ${step.status.replace(/^впишите /, "вписать ").replace(/^исправьте /, "исправить ")}.`,
          action: "Открыть проверку",
        },
  package: (p, step) => ({
    title: "Пакет — документы заявки",
    text:
      step.state === "fix"
        ? `Скачайте файлы Word и отметьте, что из списка заказчика собрано: ${step.status.replace(/^соберите /, "осталось ")}.`
        : "Скачайте файлы Word по одному или архивом.",
    action: "Открыть пакет",
  }),
};

export function NextStep({ from }: { from: StepKey }) {
  const { purchase } = usePurchase();
  const steps = stepsOf(purchase);
  const after = steps.slice(steps.findIndex((s) => s.key === from) + 1);
  const target = after.find((s) => s.state !== "done" && s.key in NEXT_TEXT);
  const due = dueLine(purchase.deadline, true);

  let next: { label: string; title: string; text: string; href?: string; action?: string };
  if (target) {
    const t = NEXT_TEXT[target.key as keyof typeof NEXT_TEXT](purchase, target);
    next = { label: `Дальше — шаг ${target.n} из ${steps.length}`, ...t, href: target.href };
  } else if (steps.at(-1)!.state === "done") {
    next = {
      label: "Готово к подаче",
      title: "Подайте заявку на электронной площадке",
      text: `${due ? `${due.head}${due.left ? ` — ${due.left}` : ""}.` : "Срок подачи — в извещении о закупке."} Подпишите файлы электронной подписью.`,
      ...(from !== "package" && { href: steps.at(-1)!.href, action: "Открыть пакет" }),
    };
  } else return null;

  return (
    <section aria-label={next.label} className="island flex flex-wrap items-center justify-between gap-3 px-[var(--pad)] py-3">
      <div className="grid min-w-0 gap-0.5">
        <p className={`t-over ${target ? "text-[var(--ink-3)]" : "text-[var(--ok)]"}`}>{next.label}</p>
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

// Остров сведений, который можно свернуть по названию.
function Fold({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="island">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="t-section flex min-h-10 w-full items-center gap-2 rounded-[var(--r-island)] px-[var(--pad)] py-2.5 text-left"
        >
          {title}
          {count !== undefined && <span className="count">{count}</span>}
          <CaretDownIcon className={`ml-auto size-4 text-[var(--ink-3)] transition-transform ${open ? "" : "-rotate-90"}`} />
        </button>
      </h3>
      {open && <div className="grid gap-3 px-[var(--pad)] pb-4 pt-0.5">{children}</div>}
    </section>
  );
}

function Fact({ icon: Icon, label, children }: { icon: IconComponent; label: string; children: ReactNode }) {
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
        {warn ? <WarningIcon className="size-3.5" /> : <DocumentIcon className="size-3.5" />}
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

// Документы закупки с пометками: прочитан, со скана, не прочитан. В «Сведениях» и на шаге «Загрузка».
export function PurchaseFiles({ purchase, documents }: { purchase: Purchase; documents: SentDocument[] }) {
  const scans = new Set(documents.filter((d) => d.scan).map((d) => d.name));
  return (
    <ul className="grid gap-2.5">
      {purchase.files.map((name) => {
        const scan = scans.has(name);
        const ext = name.includes(".") ? name.split(".").pop()!.toUpperCase() : "";
        return (
          <FileRow key={name} name={name} warn={scan} meta={scan ? "со скана — сверьте цифры" : [ext, "прочитан"].filter(Boolean).join(" · ")} />
        );
      })}
      {purchase.unreadable.map((f) => (
        <FileRow key={f.name} name={f.name} warn meta={`не прочитан: ${f.reason}`} />
      ))}
    </ul>
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

  async function deleteIt() {
    try {
      await remove();
      router.replace("/");
    } catch {
      setConfirmDelete(false);
      setDeleteError(true);
    }
  }

  return (
    <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto overscroll-contain pb-2 pl-px pt-1 wide:-mr-2 wide:-mt-1 wide:pr-2 wide:[scrollbar-gutter:stable] max-wide:p-2">
      <div className="island relative grid justify-items-center gap-1.5 px-[var(--pad)] pb-4 pt-5 text-center">
        <button ref={closeButton} type="button" onClick={onClose} aria-label="Скрыть сведения" className="icon-btn absolute right-2 top-2 wide:hidden">
          <CrossIcon className="size-4" />
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
          <Fact icon={BankIcon} label="Заказчик">
            <b className="t-strong break-words">{purchase.customer}</b>
          </Fact>
        )}
        {purchase.price && (
          <Fact icon={RubleIcon} label="Начальная цена">
            <b className="t-strong">{purchase.price}</b>
            <Link href={`/p/${purchase.id}/price`} className="link t-caption justify-self-start">
              До какой цены снижаться
            </Link>
          </Fact>
        )}
        {purchase.kind && (
          <Fact icon={ScalesIcon} label="Закон и способ">
            <b className="t-strong">{purchase.kind}</b>
          </Fact>
        )}
        {!due && !purchase.customer && !purchase.price && !purchase.kind && (
          <p className="text-[var(--ink-3)]">В документах не нашлось ни срока, ни заказчика, ни цены.</p>
        )}
      </Fold>

      <Fold title="Документы закупки" count={purchase.files.length + purchase.unreadable.length}>
        <PurchaseFiles purchase={purchase} documents={documents} />
        <button type="button" onClick={onAdd} className="link justify-self-start">
          Добавить документы
        </button>
      </Fold>

      {deleteError && <Note tone="warn">Не получилось удалить закупку — попробуйте ещё раз.</Note>}
      {confirmDelete ? (
        <div className="island grid gap-2.5 p-3">
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
        <button type="button" onClick={() => setConfirmDelete(true)} className="link link-quiet link-del mx-[var(--pad)] my-1 justify-self-start">
          Удалить закупку
        </button>
      )}
    </div>
  );
}

// Открытая закупка: остров-шапка со сроком и шагами подготовки заявки, под ним острова шага, справа сведения.
// От 1560 px сведения — третьим столбиком, уже — листом поверх закупки по кнопке «Сведения».
// «Добавить документы» — и в шапке закупки, и на шаге «Загрузка»: одно и то же окно выбора файлов.
// Без аргументов открывает окно выбора файлов, с файлами — читает их сразу (перетаскивание на шаге «Загрузка»).
const AddDocuments = createContext<(files?: File[]) => void>(() => {});
export const useAddDocuments = () => useContext(AddDocuments);

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
      const result = await extractRequirements(all, purchase.id);
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
  const onSearch = pathname === `${base}/search`;
  // Документы закупки лежат в «Сведениях»: на кнопке — значок файла и их число, а если файл не прочитан —
  // янтарный значок внимания и число таких файлов. Словами — во всплывающей подсказке и для диктора.
  const docs = purchase.files.length + purchase.unreadable.length;
  const unread = purchase.unreadable.length;
  const infoLabel = `Сведения о закупке: ${docs} ${plural(docs, "документ", "документа", "документов")}${
    unread ? `, ${unread} ${plural(unread, "не прочитан", "не прочитаны", "не прочитаны")}` : ""
  }`;

  return (
    <div className="relative flex min-h-0 flex-1 gap-2">
      <section aria-labelledby="pd-title" className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Шапка закупки — остров над шагом. Место под полосу прокрутки справа у шапки и у тела одно и то же,
            поэтому острова шага встают ровно под ней. */}
        <div className="-mx-2 -mt-1 flex-none overflow-hidden px-2 pb-1.5 pt-1 [scrollbar-gutter:stable]">
          <div className="island @container grid gap-3 p-[var(--pad)] max-sm:p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link href="/" aria-label="Мои закупки" title="Мои закупки" className="btn btn-line btn-xs">
                <ArrowLeftIcon />
                Мои закупки
              </Link>
              <div className="flex flex-wrap items-center gap-1.5">
                <Link href={`${base}/package`} aria-label="Скачать заявку: пакет документов Word" title="Пакет — все файлы заявки Word" className="btn btn-line btn-xs">
                  <DownloadIcon />
                  <span className="@max-[560px]:hidden">Скачать заявку</span>
                </Link>
                <button
                  type="button"
                  onClick={() => input.current?.click()}
                  disabled={adding}
                  aria-label="Добавить документы закупки"
                  title="Добавить документы закупки"
                  className="btn btn-line btn-xs"
                >
                  <AttachIcon />
                  <span className="@max-[560px]:hidden">Добавить документы</span>
                </button>
                <button
                  ref={infoToggle}
                  type="button"
                  onClick={() => toggleInfo(!infoOpen)}
                  aria-controls="ws-info"
                  aria-expanded={infoOpen}
                  aria-label={infoLabel}
                  title={infoLabel}
                  className="btn btn-line btn-xs wide:hidden"
                >
                  <PanelRightIcon className={docs ? "@max-[460px]:hidden" : ""} />
                  <span className="@max-[460px]:hidden">Сведения</span>
                  {docs > 0 && (
                    <span
                      className={`t-num -mr-1.5 inline-flex h-5 items-center gap-0.5 rounded-md pl-1 pr-1.5 @max-[460px]:m-0 @max-[460px]:bg-transparent @max-[460px]:p-0 ${
                        unread ? "bg-[var(--warn-tint)] text-[var(--warn)]" : "bg-[var(--paper-2)] text-[var(--ink-2)]"
                      }`}
                    >
                      {unread ? <WarningIcon className="size-3.5 flex-none" /> : <DocumentIcon className="size-3.5 flex-none" />}
                      {unread || docs}
                    </span>
                  )}
                </button>
              </div>
            </div>

            <div className="grid gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                {procedureOf(purchase) && (
                  <span className="t-tag rounded-[var(--r-pill)] border border-[var(--line)] bg-[var(--paper-2)] px-2 py-0.5">{procedureOf(purchase)}</span>
                )}
                {purchase.sample && <span className="t-tag rounded-[var(--r-pill)] bg-[var(--paper-2)] px-2 py-0.5 text-[var(--ink-2)]">пример</span>}
                {lawText(purchase) && <span className="font-mono text-[11px] text-[var(--ink-3)]">{lawText(purchase)}</span>}
              </div>
              <h2 id="pd-title" className="t-title text-pretty">
                {titleOf(purchase)}
              </h2>
              {procedureHint(purchase) && <p className="t-caption text-[var(--ink-3)]">{procedureHint(purchase)}</p>}
              {/* Срок — главная цифра экрана: переносится, а не обрезается */}
              <p className="t-caption text-pretty text-[var(--ink-3)]">
                {due ? (
                  <>
                    {due.head}
                    {due.left && (
                      <>
                        {"\u00a0· "}
                        <span className={due.tone === "soon" ? "t-tag text-[var(--warn)]" : ""}>{due.left}</span>
                      </>
                    )}
                  </>
                ) : (
                  "Срок подачи не найден в документах"
                )}
              </p>
            </div>

            {/* Шаги подготовки заявки по порядку, как в прототипе; «Поиск» и «Вопросы» — не шаги, а инструменты, стоят справа */}
            <nav aria-label="Подготовка заявки" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-[var(--line)] pt-2.5">
              <ol className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
                {steps.map((step, i) => (
                  <li key={step.key} className="flex flex-none items-center gap-1">
                    {i > 0 && <span aria-hidden className="h-px w-3 flex-none bg-[var(--edge-2)]" />}
                    <StepPill step={step} current={step.paths.includes(pathname)} />
                  </li>
                ))}
              </ol>
              <div className="flex flex-none items-center gap-0.5">
                <Link
                  href={`${base}/search`}
                  aria-current={onSearch ? "page" : undefined}
                  className={`item flex-none ${onSearch ? "t-strong" : "t-label text-[var(--ink-2)]"}`}
                >
                  <SearchIcon className="size-4 text-[var(--ink-3)]" />
                  <span className="@max-[560px]:sr-only">
                    Поиск<span className="sr-only"> по документам</span>
                  </span>
                </Link>
                <Link
                  href={`${base}/chat`}
                  aria-current={onChat ? "page" : undefined}
                  className={`item flex-none ${onChat ? "t-strong" : "t-label text-[var(--ink-2)]"}`}
                >
                  <ChatIcon className="size-4 text-[var(--ink-3)]" />
                  <span className="@max-[560px]:sr-only">Вопросы</span>
                  {asked > 0 && <span className="count rounded-md bg-[var(--paper-2)] px-1.5">{asked}</span>}
                </Link>
              </div>
            </nav>
          </div>
        </div>

        <div
          data-scroll-root
          className="-mx-2 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-2 pb-2 pt-0.5 [scrollbar-gutter:stable]"
        >
          {adding ? (
            <TabBody>
              <div className="island px-[var(--pad)]">
                <WorkingSteps steps={ADDING_STEPS} />
              </div>
            </TabBody>
          ) : (
            <>
              {error && (
                <Note tone="warn" icon={WarningIcon} className="mb-2">
                  {error}
                </Note>
              )}
              <AddDocuments value={(files) => (files?.length ? void addFiles(files) : input.current?.click())}>{children}</AddDocuments>
            </>
          )}
        </div>
      </section>

      {/* Сведения: от 1560 px — столбик островов справа, уже — лист поверх закупки с теми же островами */}
      <aside
        id="ws-info"
        aria-label="Сведения о закупке"
        className={`flex w-[var(--info-w)] flex-none flex-col max-wide:absolute max-wide:inset-y-0 max-wide:right-0 max-wide:z-10 max-wide:w-[min(320px,100%)] max-wide:overflow-hidden max-wide:rounded-[var(--r-island)] max-wide:bg-[var(--canvas)] max-wide:shadow-[var(--float)] ${
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
